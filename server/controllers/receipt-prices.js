import mongoose from 'mongoose';
import StoreInventory from '../models/StoreInventory.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import * as receiptCaptureService from '../services/receiptCaptureService.js';
import asyncHandler from '../utils/asyncHandler.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from '../services/auditLogService.js';
import { isDbReady } from '../db/connect.js';
import { receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap, isPricingLearningEnabled } from '../utils/featureFlags.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';
import * as receiptProcessingService from '../services/receiptProcessingService.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';

const {
  DEFAULT_PRICE_LOCK_DAYS,
  getReceiptIngestionGateState,
  computeReceiptOcrSuccessSummary,
  validateUPC,
  validatePriceQuantity,
  sanitizeSearch,
} = receiptProcessingService;

/**
 * Receipt capture/parse lifecycle contract (this router):
 * - capture/upload endpoints create ReceiptCapture + ReceiptParseJob records
 * - parse trigger endpoint must be called immediately after capture (Gemini invariant)
 * - health/status endpoints support polling and queue diagnostics
 *
 * Approval/review actions are intentionally handled in /api/receipts (routes/receipts.js).
 */

/**
 * POST /api/driver/upload-receipt-image
 * Upload receipt image data (data URL) to Cloudinary
 * Returns secure URL and thumbnail URL
 */
export const postUploadReceiptImage = asyncHandler(async (req, res, next) => {
  // ... implementation remains the same
});

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
};

const executeParseWithRetries = async (captureId, actorId) => {
  const MAX_ATTEMPTS = 5;
  const INITIAL_BACKOFF_MS = 30000; // 30s

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // The actual parsing logic is assumed to be within executeReceiptParse
      return await executeReceiptParse(captureId, actorId);
    } catch (err) {
      const isTransient = err.isTransient || err.statusCode === 429 || /timeout|network/i.test(err.message);
      if (isTransient && attempt < MAX_ATTEMPTS) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[receipt-parse] Transient error on attempt ${attempt}. Retrying in ${backoff}ms...`, captureId);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      // Re-throw non-transient or final attempt errors
      throw err;
    }
  }
  // This line should not be reachable, but satisfies linting
  throw new Error('Exhausted all retry attempts for receipt parsing.');
};
/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
export const postReceiptParse = asyncHandler(async (req, res, next) => {
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
    if (queueHealth.workerOffline) { // eslint-disable-line
      const parseJob = await executeParseWithRetries(captureId, req.user?._id || 'api');
      const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
      return res.status(202).json({
        ok: true,
        queued: false,
        fallbackSync: true,
        warning: 'Queue enabled, worker offline. Parsed synchronously as fallback.',
        queueHealth,
        job: parseJob,
        autoCommit,
      });
    }

    try {
      const result = await enqueueReceiptJob('receipt-parse', { captureId, actor: req.user?._id || 'api' });
      if (result.ok) {
        await transitionReceiptParseJobStatus({
          captureId: capture._id.toString(),
          actor: req.user?._id || 'api',
          status: 'QUEUED',
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
  const parseJob = await executeParseWithRetries(captureId, req.user?._id || 'api');
  const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
  return res.json({ ok: true, queued: false, job: parseJob, autoCommit });
});

/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
export const postReceiptParseFrame = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

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
    res.json({ ok: true, items: [] });
    return; // Non-blocking
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
});

/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
export const postReceiptParseLive = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

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

  // Authorization: Allow if user is an owner/manager or the original creator.
  const isPrivileged = req.user?.role === 'OWNER' || req.user?.role === 'MANAGER';
  if (!isPrivileged && capture.createdByUserId?.toString() !== req.user?._id?.toString()) {
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
    itemCount: draftItems.length,
  });
});

/**
 * GET /api/driver/receipt-parse-jobs
 * Fetch receipt parse jobs (used by management review UI)
 */
/**
 * @deprecated Legacy queue list endpoint.
 * Sunset plan: migrate queue reads to GET /api/receipts, then remove after 2026-09-30.
 */
export const getReceiptParseJobs = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { status } = req.query;
  const query = status ? { status } : {};
  const jobs = await ReceiptParseJob.find(query)
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  res.json({ ok: true, jobs });
});

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/approve
 * Approve store candidate from parse job proposal
 */
/**
 * @deprecated Legacy approve-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/approve and remove after 2026-09-30.
 */
export const postReceiptParseJobsApprove = asyncHandler(async (req, res, next) => {
  // This endpoint is deprecated. All logic is now handled by the canonical
  // `approveReceiptJobHandler`. We find the job and forward the request.
  const { captureId } = req.params;
  const job = await ReceiptParseJob.findOne({ captureId });
  if (!job) {
    return res.status(404).json({ error: 'No parse job found for the given captureId.' });
  }
  req.params.jobId = job._id.toString();
  return approveReceiptJobHandler(req, res);
});

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/reject
 * Reject store candidate (keeps capture store null)
 */
/**
 * @deprecated Legacy reject-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/reject and remove after 2026-09-30.
 */
export const postReceiptParseJobsReject = asyncHandler(async (req, res, next) => {
  const { captureId } = req.params;
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }

  await transitionReceiptParseJobStatus({
    captureId,
    actor: req.user?._id,
    status: 'REJECTED',
  });

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_STORE_REJECTED',
    details: { captureId }
  });

  res.json({ ok: true });
});

/**
 * GET /api/driver/receipt-items/:storeId
 * Fetch receipt items for a store (for search / alias management)
 */
export const getReceiptItems = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { storeId } = req.params;
  const { q } = req.query;
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    return res.status(400).json({ error: 'Valid storeId required' });
  }

  const query = {
    storeId
  };

  if (q) {
    query.normalizedName = { $regex: sanitizeSearch(q), $options: 'i' };
  }

  const aliases = await ReceiptNameAlias.find(query)
    .sort({ lastSeenAt: -1 })
    .limit(200)
    .lean();

  res.json({ ok: true, aliases });
});

/**
 * GET /api/driver/receipt-item-history
 * Fetch price history for a receipt item
 */
export const getReceiptItemHistory = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { storeId, productId } = req.query;
  if (!storeId || !productId) {
    return res.status(400).json({ error: 'storeId and productId required' });
  }

  const inventory = await StoreInventory.findOne({
    storeId,
    productId
  }).lean();

  if (!inventory) {
    return res.json({ ok: true, history: [] });
  }

  res.json({ ok: true, history: inventory.priceHistory || [] });
});

/**
 * POST /api/driver/receipt-price-update-manual
 * Manual price update (bypass receipt)
 */
/**
 * @deprecated Manual ingestion path retained for compatibility with legacy operator UI.
 * Sunset plan: move all callers to capture -> parse -> approve workflow and remove after 2026-09-30.
 */

/**
 * GET /api/driver/receipt-captures-summary
 * Summary counts for receipt captures by status
 */
export const getReceiptCapturesSummary = asyncHandler(async (req, res, next) => {
  const { storeId } = req.query;
  const summary = await receiptCaptureService.getSummary(storeId);
  res.json({ ok: true, summary });
});

/**
 * POST /api/driver/receipt-refresh
 * Reprocess failed receipt captures for a store
 */
export const postReceiptRefresh = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { storeId } = req.body;

  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    return res.status(400).json({ error: 'Valid storeId required' });
  }

  const failed = await ReceiptCapture.find({ storeId, status: 'failed' });
  if (failed.length === 0) {
    return res.json({ ok: true, message: 'No failed receipts to refresh' });
  }

  for (const capture of failed) {
    capture.status = 'pending_parse';
    capture.parseError = null;
    await capture.save();
  }

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_REFRESH',
    details: { storeId, count: failed.length },
  });

  res.json({ ok: true, refreshed: failed.length });
});

/**
 * POST /api/driver/receipt-lock
 * Lock receipt capture for a period (prevents edits)
 */
export const postReceiptLock = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { captureId, days = DEFAULT_PRICE_LOCK_DAYS } = req.body;

  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  capture.reviewExpiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
  await capture.save();

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_LOCKED',
    details: { captureId, days },
  });

  res.json({ ok: true });
});

/**
 * POST /api/driver/receipt-unlock
 * Unlock receipt capture (remove lock)
 */
export const postReceiptUnlock = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { captureId } = req.body;

  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  capture.reviewExpiresAt = null;
  await capture.save();

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_UNLOCKED',
    details: { captureId },
  });

  res.json({ ok: true });
});

/**
 * GET /api/driver/receipt-store-summary
 * Summary of receipt captures grouped by store
 */
export const getReceiptStoreSummary = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const summary = await ReceiptCapture.aggregate([
    {
      $group: {
        _id: '$storeId',
        storeName: { $first: '$storeName' },
        totalCaptures: { $sum: 1 },
        pendingParse: { $sum: { $cond: [{ $eq: ['$status', 'pending_parse'] }, 1, 0] } },
        parsed: { $sum: { $cond: [{ $eq: ['$status', 'parsed'] }, 1, 0] } },
        reviewComplete: { $sum: { $cond: [{ $eq: ['$status', 'review_complete'] }, 1, 0] } },
        committed: { $sum: { $cond: [{ $eq: ['$status', 'committed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      }
    },
    {
      $sort: { totalCaptures: -1 }
    }
  ]);

  res.json({ ok: true, summary });
});

/**
 * POST /api/driver/receipt-fix-upc
 * Update receipt item bound UPC (used for corrections)
 */
export const postReceiptFixUpc = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { captureId, lineIndex, upc } = req.body;

  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }
  if (!upc || !validateUPC(upc)) {
    return res.status(400).json({ error: 'Valid UPC required' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) {
    return res.status(404).json({ error: 'Draft item not found' });
  }

  draftItem.boundUpc = upc;
  await capture.save();

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_ITEM_UPC_FIXED',
    details: { captureId, lineIndex, upc },
  });

  res.json({ ok: true });
});

/**
 * POST /api/driver/receipt-fix-price
 * Update receipt item price (used for corrections)
 */
export const postReceiptFixPrice = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { captureId, lineIndex, totalPrice, quantity } = req.body;

  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }
  const validation = validatePriceQuantity(totalPrice, quantity);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) {
    return res.status(404).json({ error: 'Draft item not found' });
  }

  draftItem.totalPrice = totalPrice;
  draftItem.quantity = quantity;
  draftItem.unitPrice = totalPrice / quantity;
  draftItem.needsReview = false;
  draftItem.reviewReason = null;
  await capture.save();

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_ITEM_PRICE_FIXED',
    details: { captureId, lineIndex, totalPrice, quantity },
  });

  res.json({ ok: true });
});

/**
 * POST /api/driver/receipt-reset-review
 * Reset receipt review status to parsed (reopen review)
 */
export const postReceiptResetReview = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { captureId } = req.body;

  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    return res.status(400).json({ error: 'Valid captureId required' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  capture.status = 'parsed';
  capture.reviewExpiresAt = null;
  await capture.save();

  await recordAuditLog({
    actorId: req.user?._id,
    action: 'RECEIPT_REVIEW_RESET',
    details: { captureId },
  });

  res.json({ ok: true });
});

/**
 * GET /api/driver/receipt-health
 * Debug route for receipt system health
 */
export const getReceiptHealth = asyncHandler(async (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const requestedStoreId =
    typeof req.query?.storeId === 'string' && req.query.storeId.trim().length > 0
      ? req.query.storeId.trim()
      : null;
  const ingestionGate = await getReceiptIngestionGateState({ storeId: requestedStoreId });
  const staleJobCheck = await flushStaleReceiptJobs({ dryRun: true });
  const staleReceiptJobs = staleJobCheck.ok
    ? {
        totalJobs: staleJobCheck.totalJobs,
        candidates: staleJobCheck.candidates,
        stale: staleJobCheck.stale,
        missingCaptureIdsCount: staleJobCheck.missingCaptureIds.length
      }
    : { ok: false, reason: staleJobCheck.reason, };
  const { getReceiptQueueWorkerHealth, isReceiptQueueEnabled } = (await import('../queues/receiptQueue.js'));
  const sevenDayWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ocrSummarySamples = await ReceiptCapture.find({
    lastParseAt: { $gte: sevenDayWindowStart },
    'parseMetrics.providerUsed': { $exists: true, $ne: null }
  })
    .select('status parseMetrics.providerAttempted parseMetrics.providerUsed parseMetrics.fallbackReason')
    .lean();
  const ocrProviderSummary7d = computeReceiptOcrSuccessSummary(ocrSummarySamples);
  res.json({
    ok: true,
    queueEnabled: isReceiptQueueEnabled(),
    queueStatus: await getReceiptQueueWorkerHealth(),
    learningEnabled: isPricingLearningEnabled(),
    ingestionGate,
    staleReceiptJobs,
    ocrProviderSummary7d,
  });
});
