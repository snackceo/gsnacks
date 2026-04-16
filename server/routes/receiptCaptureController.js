import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import Store from '../models/Store.js';
import { isDbReady } from '../db/connect.js';
import { recordAuditLog } from '../utils/audit.js';
import { isOwnerUsername, isDriverUsername, driverCanAccessStore } from '../utils/helpers.js';
import { receiptIngestionMode, getReceiptIngestionGateState, ensureIngestionAllowed } from '../utils/featureFlags.js';
import * as receiptProcessingService from '../services/receiptProcessingService.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber } from '../utils/storeMatcher.js';
import { transitionReceiptParseJobStatus } from '../utils/receiptParseJobStatus.js';
import { enqueueReceiptJob, getReceiptQueueWorkerHealth, isReceiptQueueEnabled } from '../queues/receiptQueue.js';
import { executeReceiptParse } from '../utils/receiptParseHelper.js';
import { resolveReceiptLineProduct } from '../utils/receiptLineResolver.js';
import { buildPriceObservationPayload } from '../utils/receiptObservation.js';
import UnmappedProduct from '../models/UnmappedProduct.js';
import PriceObservation from '../models/PriceObservation.js';

const {
  handleReceiptImageUpload,
  MAX_RECEIPT_IMAGE_BYTES,
  ALLOWED_IMAGE_MIMES,
  isAllowedImageDataUrl,
  hasCloudinary,
  isCloudinaryUrl,
  fetchExternalReceiptImage,
  ensureGeminiReady,
  mapReceiptItemsForResponse,
  attemptAutoCommit,
} = receiptProcessingService;

/**
 * @deprecated Legacy combined upload path.
 * Sunset plan: migrate remaining callers to upload-receipt-image + receipt-capture + receipt-parse,
 * then remove after 2026-09-30.
 */
export const postReceiptUpload = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image data required' });
    }

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    if (receiptIngestionMode() === 'disabled') {
      const gate = await getReceiptIngestionGateState({ storeId });
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout', gate });
    }

    if (storeId) {
      const ingestionCheck = await ensureIngestionAllowed(storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > MAX_RECEIPT_IMAGE_BYTES) {
      const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
      return res.status(413).json({ error: `Image too large: ${sizeMB}MB (max 5MB)` });
    }

    const result = await handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error.message);
    // Return specific error messages so frontend can debug
    res.status(500).json({ 
      error: error.message || 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * POST /api/driver/upload-receipt-image
 * Upload receipt image data (data URL) to Cloudinary
 * Returns secure URL and thumbnail URL
 */
export const postUploadReceiptImage = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    if (!image) {
      return res.status(400).json({ error: 'Image data required' });
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > MAX_RECEIPT_IMAGE_BYTES) {
      const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
      return res.status(413).json({ error: `Image too large: ${sizeMB}MB (max 5MB)` });
    }

    const result = await handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error.message);
    // Return specific error messages so frontend can debug
    res.status(500).json({ 
      error: error.message || 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
 */
export const postReceiptCapture = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, storeName, orderId, images, captureRequestId, source: requestedSource } = req.body;
    const username = req.user?.username;
    const userId = req.user?.id || req.user?.userId;
    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const normalizedStoreName =
      typeof storeName === 'string' && storeName.trim().length > 0 ? storeName.trim() : undefined;

    // Authorization check
    const isOwner = isOwnerRole || isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    const isManagement = isOwner || isManagerRole;
    const createdByRole = isOwner ? 'OWNER' : isManagerRole ? 'MANAGER' : isDriver ? 'DRIVER' : undefined;
    const source = requestedSource === 'email_import' && isManagement
      ? 'email_import'
      : isManagement
      ? 'management_upload'
      : isDriver
      ? 'driver_camera'
      : undefined;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to upload receipts' });
    }

    // Idempotency: check if this captureRequestId already exists
    if (captureRequestId && typeof captureRequestId === 'string' && captureRequestId.length >= 8) {
      const existingCapture = await ReceiptCapture.findOne({ 
        captureRequestId,
        createdBy: username
      });
      if (existingCapture) {
        // Return existing capture (idempotent)
        return res.json({
          ok: true,
          captureId: existingCapture._id.toString(),
          status: existingCapture.status,
          imageCount: existingCapture.images.length,
          idempotent: true
        });
      }
    } else if (!captureRequestId) {
      return res.status(400).json({ error: 'captureRequestId required (UUID recommended)' });
    }

    // Validation
    if (receiptIngestionMode() === 'disabled') {
      const gate = await getReceiptIngestionGateState({ storeId });
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout', gate });
    }
    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }
    if (!images || !Array.isArray(images) || images.length === 0 || images.length > 3) {
      return res.status(400).json({ error: 'images array required (1-3 photos)' });
    }

    let store = null;
    if (storeId) {
      // Find store by id
      store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    }

    // Enforce driver-store binding
    if (store && isDriver && !driverCanAccessStore(username, store._id.toString())) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    if (store) {
      const ingestionCheck = await ensureIngestionAllowed(store._id.toString());
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    // Validate image URLs and sizes
    const normalizedImages = [];
    for (const img of images) {
      if (!img.url || typeof img.url !== 'string') {
        return res.status(400).json({ error: 'Each image must have a url' });
      }
      // Validate data URL size (max 5MB per image)
      if (img.url.startsWith('data:')) {
        const sizeMB = img.url.length / (1024 * 1024);
        if (sizeMB > 5) {
          return res.status(400).json({ error: `Image too large: ${sizeMB.toFixed(1)}MB (max 5MB)` });
        }

        const mimeMatch = img.url.match(/^data:([^;]+);base64,/i);
        const mime = mimeMatch?.[1] || '';
        if (!ALLOWED_IMAGE_MIMES.includes(mime.toLowerCase())) {
          return res.status(400).json({ error: `Unsupported image type: ${mime || 'unknown'}` });
        }

        if (!isAllowedImageDataUrl(img.url)) {
          return res.status(400).json({ error: 'Image content failed validation (corrupt or unsupported)' });
        }

        if (!hasCloudinary) {
          return res.status(503).json({ error: 'Cloudinary not configured for receipt image uploads' });
        }

        const uploaded = await handleReceiptImageUpload(img.url);
        normalizedImages.push({
          url: uploaded.url,
          thumbnailUrl: uploaded.thumbnailUrl
        });
      } else {
        // Non-data URLs must be valid image URLs (HTTPS, allowed hosts, content-type check)
        if (!/^https?:\/\//i.test(img.url)) {
          console.warn('Receipt capture rejected image URL with unsupported scheme', {
            url: img.url,
            captureRequestId
          });
          await recordAuditLog({
            type: 'receipt_capture_reject',
            actorId: username || 'unknown',
            details: `reason=unsupported_scheme url=${img.url} captureRequestId=${captureRequestId || 'none'}`
          });
          return res.status(400).json({ error: 'Image URLs must use HTTP(S)' });
        }
        if (!img.url.startsWith('https://')) {
          console.warn('Receipt capture rejected non-HTTPS image URL', {
            url: img.url,
            captureRequestId
          });
          await recordAuditLog({
            type: 'receipt_capture_reject',
            actorId: username || 'unknown',
            details: `reason=non_https url=${img.url} captureRequestId=${captureRequestId || 'none'}`
          });
          return res.status(400).json({ error: 'Image URLs must use HTTPS' });
        }

        const isCloudinaryHost = isCloudinaryUrl(img.url);
        if (!isCloudinaryHost) {
          if (!hasCloudinary) {
            return res.status(503).json({ error: 'Cloudinary not configured for receipt image uploads' });
          }
          try {
            const dataUrl = await fetchExternalReceiptImage(img.url);
            const uploaded = await handleReceiptImageUpload(dataUrl);
            normalizedImages.push({
              url: uploaded.url,
              thumbnailUrl: uploaded.thumbnailUrl
            });
          } catch (uploadErr) {
            return res.status(400).json({ error: uploadErr.message || 'Failed to re-upload receipt image' });
          }
        } else {
          // Verify content-type by HEAD request
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const headResp = await fetch(img.url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            const ct = (headResp.headers.get('content-type') || '').toLowerCase();
            if (!isAllowedReceiptMime(ct)) {
              return res.status(400).json({ error: `Unsupported content-type: ${ct || 'unknown'}` });
            }
          } catch (headErr) {
            console.warn('HEAD request failed for image URL:', img.url, headErr.message);
            return res.status(400).json({ error: 'Unable to validate receipt image URL' });
          }

          const thumbnailUrl = img.thumbnailUrl && isCloudinaryUrl(img.thumbnailUrl)
            ? img.thumbnailUrl
            : img.url;
          normalizedImages.push({
            url: img.url,
            thumbnailUrl
          });
        }
      }
    }

    // Create ReceiptCapture record
    const capture = new ReceiptCapture({
      captureRequestId, // For idempotency
      storeId: store?._id?.toString(),
      storeName: store?.name || normalizedStoreName,
      orderId: orderId || undefined,
      images: normalizedImages.map((img, idx) => ({
        url: img.url,
        thumbnailUrl: img.thumbnailUrl || img.url,
        uploadedAt: new Date(),
        sequence: idx + 1
      })),
      status: 'pending_parse',
      createdBy: username || 'unknown',
      createdByUserId: userId || undefined,
      createdByRole: createdByRole || undefined,
      source: source || undefined
    });

    await capture.save();

    // Attempt store matching for receipt proposals (optional, for management review)
    try {
      const matchPayload = store
        ? {
            name: store.name,
            address: store.address,
            phone: store.phone,
            storeType: store.storeType
          }
        : normalizedStoreName
          ? { name: normalizedStoreName }
          : null;
      const matchResult = matchPayload ? await matchStoreCandidate(matchPayload) : null;

      // Create a draft ReceiptParseJob even before parsing with store candidate info
      await transitionReceiptParseJobStatus({
        captureId: capture._id.toString(),
        actor: username || 'unknown',
        status: 'CREATED',
        updates: {
          storeCandidate: {
            name: store?.name || normalizedStoreName || 'Unknown Store',
            address: store?.address || {},
            phone: store?.phone,
            phoneNormalized: normalizePhone(store?.phoneNormalized || store?.phone),
            storeNumber: store?.storeNumber,
            storeType: store?.storeType,
            confidence: matchResult?.confidence || 0,
            storeId: matchResult?.match?._id || undefined
          }
        }
      });
    } catch (matchErr) {
      console.warn('Failed to create ReceiptParseJob with store candidate:', matchErr?.message);
    }

    await recordAuditLog({
      type: 'receipt_capture_create',
      actorId: username || 'unknown',
      details: `store=${store?._id?.toString() || 'none'} storeName=${store?.name || normalizedStoreName || 'unknown'} images=${capture.images.length} capture=${capture._id.toString()}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      imageCount: capture.images.length
    });

  } catch (error) {
    console.error('Error creating receipt capture:', error);
    res.status(500).json({ error: 'Failed to create receipt capture' });
  }
};

/**
 * GET /api/driver/receipt-capture/:captureId
 * Get receipt capture status and parsed items
 */
export const getReceiptCapture = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.storeId) {
      const ingestionCheck = await ensureIngestionAllowed(capture.storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    res.json({
      ok: true,
      capture: {
        _id: capture._id,
        storeId: capture.storeId,
        storeName: capture.storeName,
        orderId: capture.orderId,
        status: capture.status,
        images: capture.images,
        draftItems: capture.draftItems,
        stats: {
          totalItems: capture.totalItems,
          itemsNeedingReview: capture.itemsNeedingReview,
          itemsConfirmed: capture.itemsConfirmed,
          itemsCommitted: capture.itemsCommitted
        },
        parseError: capture.parseError,
        createdByUserId: capture.createdByUserId,
        createdByRole: capture.createdByRole,
        source: capture.source,
        createdAt: capture.createdAt,
        reviewExpiresAt: capture.reviewExpiresAt
      }
    });

  } catch (error) {
    console.error('Error fetching receipt capture:', error);
    res.status(500).json({ error: 'Failed to fetch receipt capture' });
  }
};

/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
export const postReceiptParse = async (req, res) => {
  const { captureId } = req.body;
  console.log('[receipt-parse] start', captureId);
  if (!captureId) {
    return res.status(400).json({ error: 'Missing captureId' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  // Use canonical queue logic
  if (isReceiptQueueEnabled()) {
    const queueHealth = await getReceiptQueueWorkerHealth();
    if (queueHealth.workerOffline) {
      try {
        const parseJob = await executeReceiptParse(captureId, req.user?._id || 'api', { bypassQueue: true });
        const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
        return res.status(202).json({
          ok: true,
          queued: false,
          fallbackSync: true,
          warning: 'Queue enabled, worker offline. Parsed synchronously as fallback.',
          queueHealth,
          job: parseJob,
          autoCommit
        });
      } catch (syncErr) {
        return res.status(503).json({
          error: 'Queue enabled, worker offline. Start receipt worker or disable queue before retrying.',
          queueHealth,
          details: syncErr?.message || 'Synchronous fallback failed'
        });
      }
    }

    try {
      const result = await enqueueReceiptJob('receipt-parse', { captureId, actor: req.user?._id || 'api' });
      if (result.ok) {
        await transitionReceiptParseJobStatus({
          captureId: capture._id.toString(),
          actor: req.user?._id || 'api',
          status: 'QUEUED'
        });
        return res.json({ ok: true, queued: true, jobId: result.jobId, queueHealth });
      } else {
        return res.status(500).json({ error: 'Failed to enqueue receipt parse job', ...result });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to enqueue receipt parse job' });
    }
  }

  // Otherwise, run the parse pipeline directly (synchronous)
  try {
    const parseJob = await executeReceiptParse(captureId, req.user?._id || 'api');
    const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
    return res.json({ ok: true, queued: false, job: parseJob, autoCommit });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Receipt parse failed' });
  }
};

/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
export const postReceiptParseFrame = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;
    
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Valid base64 image required' });
    }

    const apiReady = ensureGeminiReady();
    if (!apiReady.ok) {
      return res.status(503).json({ error: apiReady.error });
    }

    // Extract base64 from data URL
    let imageBase64 = image;
    let mimeType = 'image/jpeg';
    
    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageBase64 = match[2];
      }
    }

    // Call Gemini with items extraction prompt
    const prompt = `Extract ALL product line items from this receipt image ONLY. Return ONLY JSON:
[
  {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
  {"receiptName": "LAYS CHIPS", "quantity": 1, "totalPrice": 3.99}
]

Rules: Extract product lines only (skip store, date, tax, total). Return empty [] if unclear. ONLY JSON, no explanation.`;

    let response;
    try {
      const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
      response = await ai.models.generateContent({
        model: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: imageBase64, mimeType } }
            ]
          }
        ],
        generationConfig: { temperature: 0.1 }
      });
    } catch (geminiErr) {
      console.error('Gemini parse error:', geminiErr.message);
      return res.json({ ok: true, items: [] }); // Non-blocking
    }

    const rawText = response?.text?.trim?.() ?? '';
    let items = [];
    
    try {
      const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonText);
      
      if (Array.isArray(parsed)) {
        items = parsed.filter(item => 
          item.receiptName && 
          Number.isFinite(item.quantity) && 
          Number.isFinite(item.totalPrice) &&
          item.totalPrice > 0 &&
          item.quantity > 0
        ).slice(0, 20); // Limit to 20 items per frame
      }
    } catch (e) {
      // Silent fail for parsing
    }

    const enrichedItems = await receiptProcessingService.enrichReceiptFrameItems(items, storeId);

    res.json({ ok: true, items: enrichedItems });

  } catch (error) {
    console.error('Receipt frame parse error:', error);
    res.json({ ok: true, items: [] });
  }
};

/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
export const postReceiptParseLive = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, items } = req.body;
    
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    const isOwner = isOwnerUsername(req.user?.username);
    if (!isOwner && capture.createdBy !== req.user?.username) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Convert live items to draft items for manual UPC binding
    const draftItems = items.map((item, idx) => {
      const normalizedName = receiptProcessingService.normalizeReceiptName(item.receiptName); // eslint-disable-line
      const tokens = receiptProcessingService.extractTokens(normalizedName); // eslint-disable-line
      return {
        lineIndex: idx,
        receiptName: item.receiptName,
        normalizedName,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        unitPrice: item.totalPrice / item.quantity,
        tokens: receiptProcessingService.summarizeTokens(tokens), // eslint-disable-line
        priceDelta: undefined,
        matchHistory: [],
        suggestedProduct: null,
        matchMethod: 'live_scan',
        matchConfidence: undefined,
        needsReview: false,
        workflowType: 'new_product'
      };
    });

    capture.markParsed(draftItems);
    await capture.save();

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      itemCount: draftItems.length
    });

  } catch (error) {
    console.error('Receipt parse live error:', error);
    res.status(500).json({ error: 'Failed to save items' });
  }
};

/**
 * GET /api/driver/receipt-parse-jobs
 * Fetch receipt parse jobs (used by management review UI)
 */
/**
 * @deprecated Legacy queue list endpoint.
 * Sunset plan: migrate queue reads to GET /api/receipts, then remove after 2026-09-30.
 */
export const getReceiptParseJobs = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const jobs = await ReceiptParseJob.find(query)
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ ok: true, jobs });
  } catch (error) {
    console.error('Error fetching receipt parse jobs:', error);
    res.status(500).json({ error: 'Failed to fetch parse jobs' });
  }
};

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/approve
 * Approve store candidate from parse job proposal
 */
/**
 * @deprecated Legacy approve-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/approve and remove after 2026-09-30.
 */
export const postReceiptParseJobsApprove = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const { storeId, storeName, address, phone, storeType, storeNumber } = req.body;
    const username = req.user?.username || 'unknown';

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (!storeId && !storeName) {
      return res.status(400).json({ error: 'storeId or storeName required' });
    }

    let store = null;
    if (storeId) {
      store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    } else if (storeName) {
      store = await Store.findOne({ name: storeName });
      if (!store) {
        store = await Store.create({
          name: storeName,
          address: address || {},
          phone,
          phoneNormalized: normalizePhone(phone),
          storeNumber: normalizeStoreNumber(storeNumber),
          storeType
        });
      }
    }


    capture.storeId = store._id;
    capture.storeName = store.name;
    await capture.save();

    await ReceiptParseJob.findOneAndUpdate(
      { captureId },
      { 'storeCandidate.storeId': store._id, 'storeCandidate.confidence': 1 },
      { new: true }
    );

    // --- UnmappedProduct & PriceObservation logic ---
    // Only run if capture has draftItems
    try {
      const UnmappedProduct = (await import('../models/UnmappedProduct.js')).default;
      const PriceObservation = (await import('../models/PriceObservation.js')).default;
      const draftItems = capture.draftItems || [];
      const now = new Date();
      const rejectedLines = [];
      for (const item of draftItems) {
        const resolution = await resolveReceiptLineProduct({
          line: item,
          normalizedName: item.normalizedName || item.receiptName,
          upc: item.boundUpc || item.upc,
          fallback: 'unmapped'
        });
        const product = resolution.product;
        const normalizedName = resolution.normalizedName;

        if (!product && item.receiptName) {
          // Find or create UnmappedProduct
          let unmapped = await UnmappedProduct.findOne({ storeId: store._id, normalizedName });
          if (!unmapped) {
            unmapped = await UnmappedProduct.create({
              storeId: store._id,
              rawName: item.receiptName,
              normalizedName,
              firstSeenAt: now,
              lastSeenAt: now,
              status: 'NEW'
            });
          } else {
            unmapped.lastSeenAt = now;
            await unmapped.save();
          }
          // Write PriceObservation
          const observation = buildPriceObservationPayload({
            item,
            storeId: store._id,
            receiptCaptureId: capture._id,
            unmappedProductId: unmapped._id,
            observedAt: now
          });
          if (observation.ok) {
            await PriceObservation.create(observation.payload);
          } else {
            rejectedLines.push({ lineIndex: item?.lineIndex, reason: observation.reason });
          }
        } else if (product) {
          // Write PriceObservation for resolved product
          const observation = buildPriceObservationPayload({
            item,
            storeId: store._id,
            receiptCaptureId: capture._id,
            productId: product._id,
            observedAt: now
          });
          if (observation.ok) {
            await PriceObservation.create(observation.payload);
          } else {
            rejectedLines.push({ lineIndex: item?.lineIndex, reason: observation.reason });
          }
        } else {
          rejectedLines.push({ lineIndex: item?.lineIndex, reason: 'missing_mapping' });
        }
      }
      if (rejectedLines.length > 0) {
        const reasonCounts = rejectedLines.reduce((acc, entry) => {
          const key = entry.reason || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        await recordAuditLog({
          type: 'receipt_observation_rejected_lines',
          actorId: username,
          details: `captureId=${captureId} route=receipt-prices rejected=${rejectedLines.length} reasons=${JSON.stringify(reasonCounts)}`
        });
      }
    } catch (err) {
      console.error('UnmappedProduct/PriceObservation error:', err);
    }
    // --- End UnmappedProduct logic ---

    await recordAuditLog({
      type: 'receipt_store_confirm',
      actorId: username,
      details: `captureId=${captureId} storeId=${store._id}`
    });

    res.json({ ok: true, store });

  } catch (error) {
    console.error('Error approving store candidate:', error);
    res.status(500).json({ error: 'Failed to approve store candidate' });
  }
};

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/reject
 * Reject store candidate (keeps capture store null)
 */
/**
 * @deprecated Legacy reject-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/reject and remove after 2026-09-30.
 */
export const postReceiptParseJobsReject = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username || 'unknown';

    await transitionReceiptParseJobStatus({
      captureId,
      actor: username,
      status: 'REJECTED'
    });

    await recordAuditLog({
      type: 'receipt_store_reject',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error rejecting store candidate:', error);
    res.status(500).json({ error: 'Failed to reject store candidate' });
  }
};

/**
 * GET /api/driver/receipt-capture/:captureId/items
 * Fetch receipt capture items for review (convenience route)
 */
export const getReceiptCaptureItems = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId).lean();
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    let draftItems = Array.isArray(capture.draftItems) ? capture.draftItems : [];
    if (draftItems.length === 0) {
      const parseJob = await ReceiptParseJob.findOne({ captureId })
        .sort({ createdAt: -1 })
        .select('structured.draftItems')
        .lean();

      if (Array.isArray(parseJob?.structured?.draftItems) && parseJob.structured.draftItems.length > 0) {
        draftItems = parseJob.structured.draftItems;
      }
    }

    res.json({
      ok: true,
      items: mapReceiptItemsForResponse(draftItems)
    });
  } catch (error) {
    console.error('Error fetching receipt items:', error);
    res.status(500).json({ error: 'Failed to fetch receipt items' });
  }
};

/**
 * POST /api/driver/receipt-capture/:captureId/expire
 * Manually expire a receipt capture (admin only)
 */
export const postReceiptCaptureExpire = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username || 'unknown';
    const isOwner = isOwnerUsername(username);
    if (!isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    await ReceiptCapture.findByIdAndUpdate(captureId, {
      reviewExpiresAt: new Date(Date.now() - 1000)
    });

    await recordAuditLog({
      type: 'receipt_capture_expire',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error expiring receipt capture:', error);
    res.status(500).json({ error: 'Failed to expire receipt capture' });
  }
};