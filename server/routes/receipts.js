// DEFENSIVE DEFAULT: All sensitive actions default to deny unless explicitly allowed by role check above.
// SECURITY NOTE: For production, add express-rate-limit or similar middleware to limit receipt submissions and approvals per user/IP.
// IMAGE VALIDATION: Ensure uploaded images are validated for type, size, and content before processing.
import express from 'express';
import mongoose from 'mongoose';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import UnmappedProduct from '../models/UnmappedProduct.js';
import PriceObservation from '../models/PriceObservation.js';
import { isDbReady } from '../db/connect.js';
import { authRequired, isOwnerUsername } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { generateSku } from '../utils/sku.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';

const router = express.Router();

const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const normalizeBarcode = value => String(value || '').replace(/\D/g, '');
const normalizeReceiptName = value =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/gi, '');

const resolveUnitPrice = item => {
  const parsedUnit = Number(item?.unitPrice);
  if (Number.isFinite(parsedUnit) && parsedUnit > 0) return parsedUnit;
  const total = Number(item?.totalPrice);
  const qty = Number(item?.quantity) || 1;
  if (Number.isFinite(total) && total > 0 && Number.isFinite(qty) && qty > 0) {
    return total / qty;
  }
  return null;
};

const buildStoreCandidate = (capture, parseJob, body) => {
  if (body?.storeCandidate) return body.storeCandidate;
  if (parseJob?.storeCandidate) return parseJob.storeCandidate;
  const name = body?.storeName || capture?.storeName;
  const storeId = body?.storeId || capture?.storeId;
  if (!name && !storeId) return null;
  return {
    name,
    storeId,
    address: body?.storeAddress,
    phone: body?.storePhone,
    phoneNormalized: normalizePhone(body?.storePhone),
    storeNumber: normalizeStoreNumber(body?.storeNumber || parseJob?.storeCandidate?.storeNumber),
    storeType: body?.storeType || parseJob?.storeCandidate?.storeType
  };
};

// GET /api/receipts?status=NEEDS_REVIEW
// Role-neutral endpoint for fetching receipt parse jobs
router.get('/', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  // Only OWNER/MANAGER can see all receipts; drivers only see their own
  const isDriver = req.user?.role === 'DRIVER';
  if (!canApproveReceipts(req.user) && !isDriver) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // Support status as comma-separated or repeated query params
  // Input validation
  let statusList = [];
  if (req.query.status) {
    if (Array.isArray(req.query.status)) {
      statusList = req.query.status.flatMap(s => String(s).split(',').map(x => x.trim()).filter(Boolean));
    } else if (typeof req.query.status === 'string') {
      statusList = String(req.query.status).split(',').map(x => x.trim()).filter(Boolean);
    }
    // Only allow known statuses
    const allowedStatuses = ['QUEUED', 'PARSING', 'PARSED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'];
    statusList = statusList.filter(s => allowedStatuses.includes(s));
  }
  let limit = 100;
  if (req.query.limit) {
    const parsedLimit = Number(req.query.limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    limit = parsedLimit;
  }
  let baseQuery = {};
  if (statusList.length === 1) {
    baseQuery.status = statusList[0];
  } else if (statusList.length > 1) {
    baseQuery.status = { $in: statusList };
  }

  // Add orderId filter if provided
  if (req.query.orderId) {
    const orderId = String(req.query.orderId);
    if (!/^[a-zA-Z0-9_-]{6,}$/.test(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }
    baseQuery.orderId = orderId;
  }

  // Role-based filtering: drivers see only their captures
  const query = isDriver && req.user?.id
    ? { ...baseQuery, createdByUserId: req.user.id }
    : baseQuery;

  try {
    const jobs = await ReceiptParseJob.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    if (!jobs || jobs.length === 0) {
      // Explicit empty state message for review queues
      return res.json({ ok: true, jobs: [], message: 'No receipts found for the current filter. If you expect work, check for stuck or failed parses.' });
    }
    res.json({ ok: true, jobs });
  } catch (err) {
    console.error('Error fetching receipts:', {
      user: req.user?.username,
      query: req.query,
      error: err.message
    });
    await recordAuditLog({
      type: 'receipt_query_error',
      actorId: req.user?.username || 'unknown',
      details: `query=${JSON.stringify(req.query)} error=${err.message}`
    });
    res.status(500).json({ error: 'Failed to fetch receipts', message: 'Review queue unavailable. Please try again or contact support.' });
  }
});

// GET /api/receipts/:jobId
// Role-neutral endpoint for fetching a single receipt parse job
router.get('/:jobId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  // Only OWNER/MANAGER can see all jobs; drivers only see their own
  const isDriver = req.user?.role === 'DRIVER';
  if (!canApproveReceipts(req.user) && !isDriver) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const job = await ReceiptParseJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, job });
  } catch (err) {
    console.error('Error fetching receipt job:', {
      user: req.user?.username,
      jobId: req.params.jobId,
      error: err.message
    });
    await recordAuditLog({
      type: 'receipt_job_query_error',
      actorId: req.user?.username || 'unknown',
      details: `jobId=${req.params.jobId} error=${err.message}`
    });
    res.status(500).json({ error: 'Failed to fetch receipt job' });
  }
});

// POST /api/receipts/:jobId/approve
router.post('/:jobId/approve', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  // Only OWNER/MANAGER can approve
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized to approve receipts' });
  }

  const session = await mongoose.startSession();
  let transactionStarted = false;
  try {
    const { jobId } = req.params;
    const {
      mode,
      selectedIndices,
      lockDurationDays,
      idempotencyKey,
      forceUpcOverride,
      finalStoreId,
      approvalDraft
    } = req.body || {};
    const username = req.user?.username || 'unknown';

    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Valid jobId required' });
    }

    if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }


    const parseJob = await ReceiptParseJob.findById(jobId).session(session);
    if (!parseJob) {
      return res.status(404).json({ error: 'Receipt parse job not found' });
    }

    if (parseJob.status === 'REJECTED') {
      return res.status(409).json({ error: 'Cannot approve a rejected job' });
    }
    if (parseJob.status === 'APPROVED') {
      // Idempotent success
      return res.json({ ok: true, idempotent: true, jobId });
    }

    if (!parseJob.captureId) {
      return res.status(400).json({ error: 'Parse job missing captureId' });
    }

    const capture = await ReceiptCapture.findById(parseJob.captureId).session(session);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found for job' });
    }

    // Enforce orderId context: if parseJob or capture has orderId, require them to match if both exist
    if (parseJob.orderId && capture.orderId && String(parseJob.orderId) !== String(capture.orderId)) {
      return res.status(400).json({ error: 'OrderId mismatch between parse job and capture' });
    }
    // Optionally, require orderId to be present for certain approval modes (e.g., if your business logic requires it)

    if (!['PARSED', 'NEEDS_REVIEW'].includes(parseJob.status)) {
      return res.status(409).json({ error: 'Job not in approvable status' });
    }

    if (capture.status === 'committed') {
      return res.json({ ok: true, captureId, status: capture.status, idempotent: true });
    }

    const normalizedMode = mode || 'safe';
    if (!['safe', 'selected', 'locked', 'all'].includes(normalizedMode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    if (normalizedMode === 'selected' && (!Array.isArray(selectedIndices) || selectedIndices.length === 0)) {
      return res.status(400).json({ error: 'selectedIndices required for selected mode' });
    }

    // Safe mode: only apply high-confidence items (no warnings, has match.productId)
    const SAFE_CONFIDENCE = 0.8;

    const selectedSet = Array.isArray(selectedIndices)
      ? new Set(selectedIndices.map(Number))
      : null;

    if (!session.inTransaction()) {
      await session.startTransaction();
      transactionStarted = true;
    }
    const storeCandidate = buildStoreCandidate(capture, parseJob, req.body);

    let store = null;
    const effectiveStoreId = finalStoreId || storeCandidate?.storeId;
    if (effectiveStoreId && mongoose.Types.ObjectId.isValid(effectiveStoreId)) {
      store = await Store.findById(effectiveStoreId).session(session);
    } else if (storeCandidate) {
      store = await Store.findById(storeCandidate.storeId).session(session);
    }

    if (!store && storeCandidate) {
      const matchResult = await matchStoreCandidate(storeCandidate);
      // Require explicit selection if ambiguous/low confidence
      if (matchResult?.ambiguous || (matchResult?.confidence !== undefined && matchResult.confidence < 0.7)) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Ambiguous storeCandidate; provide finalStoreId' });
      }
      if (matchResult?.match?._id) {
        store = await Store.findById(matchResult.match._id).session(session);
      }
    }

    let storeCreated = false;
    if (!store) {
      const candidateName = storeCandidate?.name || capture.storeName;
      if (!candidateName) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Store name is required to approve receipt' });
      }
      const allowAutoCreate = shouldAutoCreateStore(storeCandidate);
      if (!allowAutoCreate && !req.body.confirmStoreCreate) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Store creation requires explicit confirmation (confirmStoreCreate)' });
      }
      try {
        store = await Store.create([
          {
            name: candidateName,
            phone: storeCandidate?.phone || '',
            phoneNormalized: normalizePhone(storeCandidate?.phoneNormalized || storeCandidate?.phone),
            storeNumber: normalizeStoreNumber(storeCandidate?.storeNumber),
            address: storeCandidate?.address || {},
            storeType: storeCandidate?.storeType || 'other',
            isActive: false,
            createdFrom: 'receipt_upload'
          }
        ], { session });
        store = store[0];
        storeCreated = true;
      } catch (err) {
        if (err?.code === 11000) {
          store = await Store.findOne({ name: candidateName }).session(session);
        }
        if (!store) {
          throw err;
        }
      }
    }

    if (!store) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Unable to resolve store for receipt' });
    }

    capture.storeId = store._id;
    capture.storeName = store.name;
    if (parseJob?.storeCandidate) {
      parseJob.storeCandidate.storeId = store._id;
    }

    if (storeCreated) {
      await recordAuditLog({
        type: 'store_created_from_receipt',
        actorId: username,
        details: `captureId=${capture._id.toString()} storeId=${store._id.toString()} name=${store.name}`
      });
    }

    const createdProducts = [];
    const matchedProducts = [];
    const inventoryUpdates = [];
    const errors = [];
    const approvalItems = new Map();
    if (approvalDraft?.items && Array.isArray(approvalDraft.items)) {
      for (const entry of approvalDraft.items) {
        if (typeof entry?.lineIndex === 'number') {
          approvalItems.set(entry.lineIndex, entry);
        }
      }
    }
    const priceObservations = [];

    const itemsToApprove = capture.draftItems.filter(item => {
      if (normalizedMode === 'selected') {
        return selectedSet?.has(item.lineIndex);
      }
      if (normalizedMode === 'safe') {
        const jobItem = (parseJob.items || []).find(i => Number(i.lineIndex) === Number(item.lineIndex));
        const confidence = Number(jobItem?.match?.confidence || item.matchConfidence || 0);
        const hasWarnings = Array.isArray(jobItem?.warnings) && jobItem.warnings.length > 0;
        const hasProduct = Boolean(jobItem?.match?.productId || item.boundProductId || item.suggestedProduct?.id);
        return !hasWarnings && hasProduct && confidence >= SAFE_CONFIDENCE;
      }
      return true; // 'all' and 'locked' default to everything
    });

    for (const item of itemsToApprove) {
      try {
        const unitPrice = resolveUnitPrice(item);
        if (!unitPrice) {
          errors.push({ lineIndex: item.lineIndex, error: 'Invalid unit price' });
          continue;
        }

        const approvalItem = approvalItems.get(item.lineIndex) || {};
        const action = approvalItem.action || null;
        const normalizedUpc = normalizeBarcode(
          approvalItem.upc || item.boundUpc || item.suggestedProduct?.upc
        );

        let product = null;
        if (approvalItem.productId && mongoose.Types.ObjectId.isValid(approvalItem.productId)) {
          product = await Product.findById(approvalItem.productId).session(session);
        }

        if (!product && item.boundProductId && mongoose.Types.ObjectId.isValid(item.boundProductId)) {
          product = await Product.findById(item.boundProductId).session(session);
        }

        if (!product && item.suggestedProduct?.id && mongoose.Types.ObjectId.isValid(item.suggestedProduct.id)) {
          product = await Product.findById(item.suggestedProduct.id).session(session);
        }

        if (!product && normalizedUpc) {
          const upcEntry = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (upcEntry?.productId) {
            product = await Product.findById(upcEntry.productId).session(session);
          }
        }

        let productCreated = false;
        if (!product && action === 'CREATE_PRODUCT') {
          const sku = await generateSku();
          const name = approvalItem.createProduct?.name || item.receiptName || item.normalizedName || 'Receipt Item';
          const price = Number(approvalItem.createProduct?.price) || unitPrice;
          const created = await Product.create([
            {
              frontendId: sku,
              sku,
              name,
              price,
              deposit: 0,
              stock: 0,
              sizeOz: 0,
              isTaxable: true,
              category: 'DRINK',
              brand: item.tokens?.brand || '',
              productType: '',
              storageZone: '',
              storageBin: '',
              isGlass: false,
              isHeavy: false,
              store: store._id
            }
          ], { session });
          product = created[0];
          productCreated = true;
          createdProducts.push({
            id: product._id,
            sku: product.sku,
            name: product.name,
            lineIndex: item.lineIndex
          });

          await recordAuditLog({
            type: 'product_created_from_receipt',
            actorId: username,
            details: `captureId=${capture._id.toString()} productId=${product._id.toString()} sku=${product.sku} name=${product.name}`
          });
        }

        if (product && !productCreated) {
          matchedProducts.push({
            id: product._id,
            sku: product.sku,
            name: product.name,
            lineIndex: item.lineIndex
          });
        }

        if (action === 'IGNORE') {
          if (!product) {
            const normalizedName = item.normalizedName || normalizeReceiptName(item.receiptName);
            const rawName = item.receiptName || normalizedName || 'Receipt Item';
            const now = new Date();
            const unmapped = await UnmappedProduct.findOneAndUpdate(
              { storeId: store._id, normalizedName },
              {
                $setOnInsert: {
                  storeId: store._id,
                  rawName,
                  normalizedName,
                  firstSeenAt: now,
                  status: 'NEW'
                },
                $set: {
                  rawName,
                  lastSeenAt: now
                }
              },
              { new: true, upsert: true, session }
            );
            priceObservations.push({
              unmappedProductId: unmapped._id,
              storeId: store._id,
              price: unitPrice,
              observedAt: now,
              receiptCaptureId: capture._id
            });
          }
          continue;
        }

        if (!product) {
          const normalizedName = item.normalizedName || normalizeReceiptName(item.receiptName);
          const rawName = item.receiptName || normalizedName || 'Receipt Item';
          const now = new Date();
          const unmapped = await UnmappedProduct.findOneAndUpdate(
            { storeId: store._id, normalizedName },
            {
              $setOnInsert: {
                storeId: store._id,
                rawName,
                normalizedName,
                firstSeenAt: now
              },
              $set: {
                rawName,
                lastSeenAt: now
              }
            },
            { new: true, upsert: true, session }
          );
          priceObservations.push({
            unmappedProductId: unmapped._id,
            storeId: store._id,
            price: unitPrice,
            observedAt: now,
            receiptCaptureId: capture._id
          });
          continue;
        }

        item.boundProductId = product._id;
        if (normalizedUpc) {
          item.boundUpc = normalizedUpc;
        }
        item.confirmedAt = item.confirmedAt || new Date();
        item.confirmedBy = item.confirmedBy || username;
        item.needsReview = false;

        // Concurrency guard: insert apply ledger; skip if duplicate
        const { default: ReceiptApplyLedger } = await import('../models/ReceiptApplyLedger.js');
        try {
          await ReceiptApplyLedger.create([
            {
              captureId: capture._id.toString(),
              lineIndex: Number(item.lineIndex),
              productId: product._id,
              storeId: store._id,
              idempotencyKey: String(idempotencyKey)
            }
          ], { session });
        } catch (dupeErr) {
          if (dupeErr?.code === 11000) {
            // Already applied for this line; skip
            matchedProducts.push({ id: product._id, sku: product.sku, name: product.name, lineIndex: item.lineIndex });
            continue;
          }
          throw dupeErr;
        }

        // Check if price is locked
        const existingInventory = await StoreInventory.findOne({
          storeId: store._id,
          productId: product._id
        }).session(session);

        const isLocked = existingInventory?.priceLockUntil && new Date(existingInventory.priceLockUntil) > new Date();
        if (isLocked) {
          errors.push({
            lineIndex: item.lineIndex,
            error: 'Price locked',
            lockedUntil: existingInventory.priceLockUntil
          });
          continue;
        }

        const inventory = await StoreInventory.findOneAndUpdate(
          { storeId: store._id, productId: product._id },
          {
            $set: {
              sku: product.sku,
              observedPrice: unitPrice,
              observedAt: new Date(),
              lastVerified: new Date(),
              available: true,
              stockLevel: 'in-stock'
            },
            $setOnInsert: {
              cost: unitPrice,
              markup: 1.2
            },
            $push: {
              priceHistory: {
                price: unitPrice,
                observedAt: new Date(),
                storeId: store._id,
                captureId: capture._id.toString(),
                orderId: capture.orderId,
                quantity: Number(item.quantity || 1),
                receiptImageUrl: capture.images?.[0]?.url,
                receiptThumbnailUrl: capture.images?.[0]?.thumbnailUrl,
                matchMethod: item.matchMethod || 'manual_confirm',
                matchConfidence: item.matchConfidence,
                confirmedBy: username,
                priceType: item.priceType || 'unknown',
                promoDetected: item.promoDetected || false,
                workflowType: productCreated ? 'new_product' : 'update_price'
              }
            },
            $addToSet: {
              appliedCaptures: {
                captureId: capture._id.toString(),
                lineIndex: item.lineIndex,
                appliedAt: new Date()
              }
            }
          },
          { new: true, upsert: true, session }
        );

        if (normalizedMode === 'locked') {
          const lockDays = Number(lockDurationDays) || 7;
          const lockUntil = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
          await StoreInventory.findByIdAndUpdate(
            inventory._id,
            { $set: { priceLockUntil: lockUntil } },
            { session }
          );
        }

        inventoryUpdates.push({
          storeId: store._id,
          productId: product._id,
          price: unitPrice,
          inventoryId: inventory._id,
          lineIndex: item.lineIndex
        });

        priceObservations.push({
          productId: product._id,
          storeId: store._id,
          price: unitPrice,
          observedAt: new Date(),
          receiptCaptureId: capture._id
        });

        // UPC linking to productId, with conflict handling
        if (normalizedUpc) {
          const existingUpc = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (existingUpc && existingUpc.productId && String(existingUpc.productId) !== String(product._id)) {
            if (!forceUpcOverride) {
              errors.push({ lineIndex: item.lineIndex, error: 'UPC already linked to different product', upc: normalizedUpc });
            } else {
              await UpcItem.updateOne(
                { upc: normalizedUpc },
                { $set: { productId: product._id, name: product.name } },
                { session }
              );
              await recordAuditLog({
                type: 'upc_linked_from_receipt',
                actorId: username,
                details: `captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()} override=true`
              });
            }
          } else {
            await UpcItem.findOneAndUpdate(
              { upc: normalizedUpc },
              { $set: { productId: product._id, name: product.name } },
              { new: true, upsert: true, setDefaultsOnInsert: true, session }
            );
            await recordAuditLog({
              type: 'upc_linked_from_receipt',
              actorId: username,
              details: `captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()}`
            });
          }
        }
      } catch (itemError) {
        errors.push({ lineIndex: item.lineIndex, error: itemError.message });
      }
    }

    const previousCommitted = Number(capture.itemsCommitted || 0);
    capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + itemsToApprove.length);
    capture.itemsConfirmed = capture.draftItems.filter(entry => entry.boundProductId).length;
    capture.itemsNeedingReview = capture.draftItems.filter(entry => entry.needsReview).length;
    capture.committedBy = username;
    capture.committedAt = new Date();
    if (normalizedMode === 'safe') {
      capture.status = 'committed';
      capture.reviewExpiresAt = undefined;
    }

    await capture.save({ session });

    if (parseJob) {
      parseJob.status = 'APPROVED';
      parseJob.metadata = {
        ...parseJob.metadata,
        approvedBy: username,
        approvedAt: new Date(),
        storeId: store._id,
        createdProducts,
        matchedProducts,
        inventoryUpdates,
        approvalPayload: req.body || null
      };
      await parseJob.save({ session });
    }

    if (priceObservations.length > 0) {
      await PriceObservation.insertMany(priceObservations, { session });
    }

    if (transactionStarted) {
      await session.commitTransaction();
    }

    await recordAuditLog({
      type: 'receipt_approved',
      actorId: username,
      details: `jobId=${jobId} captureId=${capture._id.toString()} storeId=${store._id.toString()} productsCreated=${createdProducts.length} inventoryUpdates=${inventoryUpdates.length} mode=${normalizedMode}`
    });

    res.json({
      ok: true,
      jobId,
      captureId: capture._id.toString(),
      storeId: store._id,
      createdProducts,
      matchedProducts,
      inventoryUpdates,
      errors: errors.length ? errors : undefined
    });
  } catch (error) {
    if (transactionStarted) {
      await session.abortTransaction();
    }
    console.error('Error approving receipt:', error);
    res.status(500).json({ error: 'Failed to approve receipt' });
  } finally {
    await session.endSession();
  }
});

// POST /api/receipts/:jobId/reject
// Role-neutral endpoint for rejecting a receipt parse job
router.post('/:jobId/reject', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  // Only OWNER/MANAGER can reject
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const session = await mongoose.startSession();
  let transactionStarted = false;
  try {
    if (!session.inTransaction()) {
      await session.startTransaction();
      transactionStarted = true;
    }
    const job = await ReceiptParseJob.findById(req.params.jobId).session(session);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status === 'APPROVED') {
      return res.status(409).json({ error: 'Cannot reject an approved job' });
    }
    const alreadyRejected = job.status === 'REJECTED';
    job.status = 'REJECTED';
    job.metadata = {
      ...job.metadata,
      rejectedBy: req.user?.username,
      rejectedAt: new Date(),
      rejectionReason: req.body?.reason || 'unspecified'
    };
    await job.save({ session });

    if (!alreadyRejected) {
      await recordAuditLog({
        type: 'receipt_rejected',
        actorId: req.user?.username || 'unknown',
        details: `jobId=${job._id} reason=${req.body?.reason || 'unspecified'}`
      });
    }
    if (transactionStarted) {
      await session.commitTransaction();
    }
    res.json({ ok: true });
  } catch (err) {
    if (transactionStarted) {
      await session.abortTransaction();
    }
    res.status(500).json({ error: 'Failed to reject receipt' });
  } finally {
    await session.endSession();
  }
});

// DELETE /api/receipts/:captureId
// Role-neutral endpoint for deleting both ReceiptParseJob and ReceiptCapture for a given captureId
router.delete('/:captureId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const { captureId } = req.params;
  if (!captureId) {
    return res.status(400).json({ error: 'captureId required' });
  }
  try {
    await ReceiptParseJob.deleteMany({ captureId });
    await ReceiptCapture.deleteOne({ _id: captureId });
    await flushStaleReceiptJobs({ captureIds: [captureId] });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete receipt and parse jobs:', err);
    res.status(500).json({ error: 'Failed to delete receipt and parse jobs' });
  }
});

// POST /api/receipts/cleanup-queue
// Admin endpoint to purge receipt queue jobs that reference missing captures
router.post('/cleanup-queue', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  if (!canApproveReceipts(req.user)) {
    return res.status(403).json({ error: 'Not authorized to clean receipt queue' });
  }
  const captureIds = Array.isArray(req.body?.captureIds) ? req.body.captureIds : null;
  const dryRun = Boolean(req.body?.dryRun);

  try {
    const result = await flushStaleReceiptJobs({ captureIds, dryRun });
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason || 'queue_unavailable' });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Failed to clean receipt queue:', err);
    res.status(500).json({ error: 'Failed to clean receipt queue' });
  }
});

export default router;
