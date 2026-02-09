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
import { getBackendBuildIdentifier } from '../utils/buildIdentifier.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';
import { buildInventoryUpdate, buildStoreInventoryQuery } from '../utils/receiptInventory.js';

const router = express.Router();

const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const normalizeBarcode = value => String(value || '').replace(/\D/g, '');
const APPROVAL_ERROR_CODES = {
  INVALID_UNIT_PRICE: 'INVALID_UNIT_PRICE',
  CREATE_PRODUCT_NOT_ALLOWED: 'CREATE_PRODUCT_NOT_ALLOWED',
  PRICE_LOCKED: 'PRICE_LOCKED',
  UPC_CONFLICT: 'UPC_CONFLICT',
  APPLY_FAILED: 'APPLY_FAILED',
  NO_PERSISTED_CHANGES: 'NO_PERSISTED_CHANGES'
};
const normalizeReceiptName = value =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/gi, '');

export const toNumber = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  let cleaned = raw
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    if (decimalSeparator === '.') {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    const parts = cleaned.split(',');
    const decimalLike = commaCount === 1 && parts[1]?.length > 0 && parts[1].length <= 2;
    cleaned = decimalLike ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      const parts = cleaned.split('.');
      const decimalPart = parts.pop();
      cleaned = `${parts.join('')}.${decimalPart}`;
    }
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const resolveUnitPrice = item => {
  const parsedUnit = toNumber(item?.unitPrice);
  if (parsedUnit) return parsedUnit;

  const total = toNumber(item?.totalPrice);
  const qty = toNumber(item?.quantity) || 1;
  if (total && qty) {
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

// Helper to normalize draft items from parseJob/capture into a consistent shape
const normalizeDraftItem = (raw) => {
  const lineIndex = typeof raw?.lineIndex === 'number'
    ? raw.lineIndex
    : (typeof raw?.index === 'number' ? raw.index : 0);

  const receiptName =
    raw?.receiptName ||
    raw?.nameCandidate ||
    raw?.rawLine ||
    raw?.rawLineText ||
    'Receipt Item';

  return {
    lineIndex,
    receiptName,
    normalizedName: raw?.normalizedName || normalizeReceiptName(receiptName),
    quantity: raw?.quantity ?? 1,
    unitPrice: raw?.unitPrice ?? null,
    totalPrice: raw?.totalPrice ?? raw?.lineTotal ?? null,
    boundUpc: raw?.upc || raw?.upcCandidate || '',
    boundProductId: raw?.boundProductId || raw?.productId || raw?.match?.productId || null,
    suggestedProduct: raw?.suggestedProduct || null,
    matchConfidence: raw?.matchConfidence ?? raw?.match?.confidence ?? null,
    matchMethod: raw?.matchMethod || 'parse',
    needsReview: true,
  };
};
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
      ignorePriceLocks,
      forceUpcOverride,
      finalStoreId,
      approvalDraft
    } = req.body || {};
    const username = req.user?.username || 'unknown';
    const shouldIgnorePriceLocks = Boolean(ignorePriceLocks);
    const canIgnorePriceLocks = req.user?.role === 'MANAGER' || req.user?.role === 'OWNER' || isOwnerUsername(req.user?.username);

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

    if (shouldIgnorePriceLocks && !canIgnorePriceLocks) {
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=ignore_price_locks_not_allowed ignorePriceLocks=${shouldIgnorePriceLocks}`
      });
      return res.status(403).json({ error: 'Not authorized to ignore price locks' });
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
      return res.json({ ok: true, captureId: capture._id.toString(), status: capture.status, idempotent: true });
    }

    const rawRequestMode = mode;
    if (rawRequestMode === undefined || rawRequestMode === null || String(rawRequestMode).trim().length === 0) {
      return res.status(400).json({ error: 'mode is required: safe|selected|locked|all' });
    }

    const normalizedMode = String(rawRequestMode).trim().toLowerCase();
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
    const lineOutcomeByIndex = new Map();
    const approvalItems = new Map();
    if (approvalDraft?.items && Array.isArray(approvalDraft.items)) {
      for (const entry of approvalDraft.items) {
        if (typeof entry?.lineIndex === 'number') {
          approvalItems.set(entry.lineIndex, entry);
        }
      }
    }
    const priceObservations = [];


    // Normalize draft items from either capture or parseJob
    const draftItems = Array.isArray(capture.draftItems)
      ? capture.draftItems
      : (Array.isArray(parseJob?.structured?.draftItems) ? parseJob.structured.draftItems : []);

    if (draftItems.length === 0) {
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=no_draft_items ignorePriceLocks=${shouldIgnorePriceLocks}`
      });
      return res.status(400).json({ error: 'No draft items available to apply' });
    }

    const normalizedDraftItems = draftItems.map(normalizeDraftItem);
    const validDraftItems = normalizedDraftItems.filter(
      item => typeof item.lineIndex === 'number' && item.receiptName
    );

    if (validDraftItems.length === 0) {
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=invalid_draft_items ignorePriceLocks=${shouldIgnorePriceLocks}`
      });
      return res.status(400).json({ error: 'No draft items available to apply' });
    }

    // Persist normalized items so you don’t keep drifting between schemas
    if (!Array.isArray(capture.draftItems) || capture.draftItems.length === 0) {
      capture.draftItems = validDraftItems;
      capture.totalItems = validDraftItems.length;
    }

    const itemsToApprove = validDraftItems.filter(item => {
      if (normalizedMode === 'selected') return selectedSet?.has(item.lineIndex);
      if (normalizedMode === 'safe') {
        const jobItem = (parseJob.items || []).find(i => Number(i.lineIndex) === Number(item.lineIndex));
        const confidence = Number(jobItem?.match?.confidence || item.matchConfidence || 0);
        const hasWarnings = Array.isArray(jobItem?.warnings) && jobItem.warnings.length > 0;
        const hasProduct = Boolean(jobItem?.match?.productId || item.boundProductId || item.suggestedProduct?.id);
        return !hasWarnings && hasProduct && confidence >= SAFE_CONFIDENCE;
      }
      return true;
    });

    if (itemsToApprove.length === 0) {
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=no_items_to_approve modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} ignorePriceLocks=${shouldIgnorePriceLocks}`
      });
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return res.status(400).json({ error: 'No items eligible to approve in this mode. Use mode=all or fix matches/warnings.' });
    }

    for (const item of itemsToApprove) {
      if (!lineOutcomeByIndex.has(item.lineIndex)) {
        lineOutcomeByIndex.set(item.lineIndex, {
          lineIndex: item.lineIndex,
          inventoryPersisted: false,
          priceObservationPersisted: false,
          priceLockOverridden: false,
          priceLockOverrideDetail: null,
          errors: []
        });
      }

      const lineOutcome = lineOutcomeByIndex.get(item.lineIndex);
      try {
        const unitPrice = resolveUnitPrice(item);
        if (!unitPrice) {
          const lineError = { lineIndex: item.lineIndex, error: 'Invalid unit price', code: APPROVAL_ERROR_CODES.INVALID_UNIT_PRICE };
          errors.push(lineError);
          lineOutcome.errors.push(lineError);
          continue;
        }

        const approvalItem = approvalItems.get(item.lineIndex) || {};
        const action = approvalItem.action || null;
        const normalizedUpc = normalizeBarcode(
          approvalItem.upc || item.boundUpc || item.suggestedProduct?.upc
        );

        if (action === 'CREATE_PRODUCT') {
          const lineError = {
            lineIndex: item.lineIndex,
            error: 'Receipt-driven product creation is not allowed',
            code: APPROVAL_ERROR_CODES.CREATE_PRODUCT_NOT_ALLOWED
          };
          errors.push(lineError);
          lineOutcome.errors.push(lineError);
          continue;
        }

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
        let unmapped = null;
        let inventory = null;
        let inventoryForUnmapped = false;
        let inventoryProductId = null;
        let inventoryUnmappedProductId = null;

        if (!product) {
          // Always create or update UnmappedProduct for raw/unknown items
          const normalizedName = item.normalizedName || normalizeReceiptName(item.receiptName);
          const rawName = item.receiptName || normalizedName || 'Receipt Item';
          const now = new Date();
          unmapped = await UnmappedProduct.findOneAndUpdate(
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
            receiptCaptureId: capture._id,
            lineIndex: item.lineIndex,
            matchMethod: item.matchMethod || 'unmapped',
            workflowType: item.workflowType || 'unmapped'
          });
          lineOutcome.priceObservationPersisted = true;
          // Only set flags for shared inventory upsert
          inventoryUnmappedProductId = unmapped._id;
          inventoryForUnmapped = true;
        }

        if (product && !productCreated) {
          matchedProducts.push({
            id: product._id,
            sku: product.sku,
            name: product.name,
            lineIndex: item.lineIndex
          });
        }

        const inventoryMatchMethod = item.matchMethod || (product ? 'manual_confirm' : 'unmapped');
        const inventoryWorkflowType = item.workflowType || (product ? 'update_price' : 'unmapped');

        // Always create or update StoreInventory for this store and product/unmapped
        let storeInventoryQuery;
        if (product) {
          inventoryProductId = product._id;
        } else if (inventoryForUnmapped && unmapped) {
          inventoryUnmappedProductId = unmapped._id;
        }
        storeInventoryQuery = buildStoreInventoryQuery({
          storeId: store._id,
          productId: inventoryProductId,
          unmappedProductId: inventoryUnmappedProductId
        });
        if (storeInventoryQuery) {
          const existingInventory = await StoreInventory.findOne(storeInventoryQuery).session(session);
          if (existingInventory?.priceLockUntil && new Date(existingInventory.priceLockUntil) > new Date()) {
            if (!shouldIgnorePriceLocks) {
              const lineError = {
                lineIndex: item.lineIndex,
                error: 'Price locked',
                code: APPROVAL_ERROR_CODES.PRICE_LOCKED,
                lockedUntil: existingInventory.priceLockUntil
              };
              errors.push(lineError);
              lineOutcome.errors.push(lineError);
              continue;
            }

            lineOutcome.priceLockOverridden = true;
            lineOutcome.priceLockOverrideDetail = `priceLockUntil=${new Date(existingInventory.priceLockUntil).toISOString()}`;
          }

          inventory = await StoreInventory.findOneAndUpdate(
            storeInventoryQuery,
            {
              $set: {
                sku: product?.sku || undefined,
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
                  matchMethod: inventoryMatchMethod,
                  matchConfidence: item.matchConfidence,
                  confirmedBy: username,
                  priceType: item.priceType || 'unknown',
                  promoDetected: item.promoDetected || false,
                  workflowType: productCreated ? 'new_product' : inventoryWorkflowType
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
          if (inventory) {
            lineOutcome.inventoryPersisted = true;
          }
        }

        if (normalizedMode === 'locked' && inventory) {
          const lockDays = Number(lockDurationDays) || 7;
          const lockUntil = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
          await StoreInventory.findByIdAndUpdate(
            inventory._id,
            { $set: { priceLockUntil: lockUntil } },
            { session }
          );
        }

        if (inventoryProductId || inventoryUnmappedProductId) {
          inventoryUpdates.push(
            buildInventoryUpdate({
              storeId: store._id,
              productId: inventoryProductId,
              unmappedProductId: inventoryUnmappedProductId,
              price: unitPrice,
              inventoryId: inventory?._id,
              lineIndex: item.lineIndex
            })
          );
        }

        if (product) {
          priceObservations.push({
            productId: product._id,
            storeId: store._id,
            price: unitPrice,
            observedAt: new Date(),
            receiptCaptureId: capture._id,
            lineIndex: item.lineIndex,
            matchMethod: item.matchMethod || 'manual_confirm',
            workflowType: item.workflowType || 'update_price'
          });
          lineOutcome.priceObservationPersisted = true;
        }

        // UPC linking to productId, with conflict handling
        if (product && normalizedUpc) {
          const existingUpc = await UpcItem.findOne({ upc: normalizedUpc }).session(session);
          if (existingUpc && existingUpc.productId && String(existingUpc.productId) !== String(product._id)) {
            if (!forceUpcOverride) {
              const lineError = {
                lineIndex: item.lineIndex,
                error: 'UPC already linked to different product',
                code: APPROVAL_ERROR_CODES.UPC_CONFLICT,
                upc: normalizedUpc
              };
              errors.push(lineError);
              lineOutcome.errors.push(lineError);
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
        const lineError = { lineIndex: item.lineIndex, error: itemError.message, code: APPROVAL_ERROR_CODES.APPLY_FAILED };
        errors.push(lineError);
        lineOutcome.errors.push(lineError);
      }
    }

    let createdPriceObservations = [];
    if (priceObservations.length > 0) {
      createdPriceObservations = await PriceObservation.insertMany(priceObservations, { session });
    }

    const inventoryAppliedLineIndexes = new Set(
      inventoryUpdates
        .map(entry => (typeof entry?.lineIndex === 'number' ? entry.lineIndex : null))
        .filter(lineIndex => lineIndex !== null)
    );
    const observationAppliedLineIndexes = new Set(
      createdPriceObservations
        .map(entry => (typeof entry?.lineIndex === 'number' ? entry.lineIndex : null))
        .filter(lineIndex => lineIndex !== null)
    );

    const lineOutcomes = Array.from(lineOutcomeByIndex.values()).map(entry => ({
      ...entry,
      inventoryPersisted: inventoryAppliedLineIndexes.has(entry.lineIndex),
      priceObservationPersisted: observationAppliedLineIndexes.has(entry.lineIndex),
      applied: inventoryAppliedLineIndexes.has(entry.lineIndex) || observationAppliedLineIndexes.has(entry.lineIndex)
    }));
    const priceLockOverrideCount = lineOutcomes.filter(entry => entry.priceLockOverridden).length;
    const appliedCount = inventoryUpdates.length + createdPriceObservations.length;
    const skippedCount = Math.max(itemsToApprove.length - appliedCount, 0);
    const errorsByLine = lineOutcomes
      .filter(entry => entry.errors.length > 0)
      .reduce((acc, entry) => {
        acc[entry.lineIndex] = entry.errors;
        return acc;
      }, {});

    if (appliedCount < 1) {
      const reason = errors.length > 0
        ? 'No receipt lines were applied. All selected lines were skipped due to validation or mapping errors.'
        : 'No receipt lines were applied. Verify product mappings and unit prices, then retry.';
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=no_lines_applied modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} selected=${itemsToApprove.length} ignorePriceLocks=${shouldIgnorePriceLocks} priceLockOverrides=${priceLockOverrideCount}`
      });
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return res.status(400).json({
        error: reason,
        reasonCode: APPROVAL_ERROR_CODES.NO_PERSISTED_CHANGES,
        reasonDetail: {
          code: APPROVAL_ERROR_CODES.NO_PERSISTED_CHANGES,
          message: reason
        },
        appliedCount,
        skippedCount,
        errors,
        errorsByLine,
        lineOutcomes,
        inventoryWriteCount: inventoryUpdates.length,
        priceObservationWriteCount: createdPriceObservations.length
      });
    }

    const previousCommitted = Number(capture.itemsCommitted || 0);
    capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + appliedCount);
    capture.itemsConfirmed = validDraftItems.filter(entry => entry.boundProductId).length;
    capture.itemsNeedingReview = validDraftItems.filter(entry => entry.needsReview).length;
    capture.committedBy = username;
    capture.committedAt = new Date();
    // Mark committed only when at least one line actually applied.
    if (appliedCount > 0) {
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
        appliedCount,
        skippedCount,
        lineOutcomes,
        errorsByLine,
        inventoryWriteCount: inventoryUpdates.length,
        priceObservationWriteCount: createdPriceObservations.length,
        ignorePriceLocks: shouldIgnorePriceLocks,
        priceLockOverrideCount,
        inventoryUpdates,
        approvalPayload: req.body || null
      };
      await parseJob.save({ session });
    }

    if (transactionStarted) {
      await session.commitTransaction();
    }

    const backendBuildId = getBackendBuildIdentifier();

    await recordAuditLog({
      type: 'receipt_approved',
      actorId: username,
      details: `jobId=${jobId} captureId=${capture._id.toString()} storeId=${store._id.toString()} productsCreated=${createdProducts.length} inventoryUpdates=${inventoryUpdates.length} modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} ignorePriceLocks=${shouldIgnorePriceLocks} priceLockOverrides=${priceLockOverrideCount} backendBuildId=${backendBuildId}`
    });

    res.json({
      ok: true,
      jobId,
      captureId: capture._id.toString(),
      storeId: store._id,
      appliedCount,
      skippedCount,
      lineOutcomes,
      errorsByLine,
      createdProducts,
      matchedProducts,
      inventoryWriteCount: inventoryUpdates.length,
      priceObservationWriteCount: createdPriceObservations.length,
      backendBuildId,
      inventoryUpdates,
      errors
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
