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
import AppSettings from '../models/AppSettings.js';
import { isDbReady } from '../db/connect.js';
import { authRequired, isOwnerUsername } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { getBackendBuildIdentifier } from '../utils/buildIdentifier.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';
import { buildInventoryUpdate, buildStoreInventoryQuery } from '../utils/receiptInventory.js';
import { calculateRetail, calculatePerUnitCost, normalizeQuantity } from '../utils/pricing.js';
import {
  getReceiptLineNormalizedName,
  normalizeReceiptLineUpc,
  resolveReceiptLineProduct
} from '../utils/receiptLineResolver.js';

/**
 * Receipt approval/review contract (this router):
 * - review queue reads and job-detail reads for parser output
 * - explicit approve/reject endpoints to finalize operator decisions
 *
 * Capture/parse job lifecycle endpoints intentionally live under /api/driver
 * in routes/receipt-prices.js to preserve capture -> parse trigger invariants.
 */

const router = express.Router();

const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER' || isOwnerUsername(user.username);
};

const normalizeBarcode = normalizeReceiptLineUpc;
const APPROVAL_ERROR_CODES = {
  INVALID_UNIT_PRICE: 'INVALID_UNIT_PRICE',
  CREATE_PRODUCT_NOT_ALLOWED: 'CREATE_PRODUCT_NOT_ALLOWED',
  PRICE_LOCKED: 'PRICE_LOCKED',
  UPC_CONFLICT: 'UPC_CONFLICT',
  APPLY_FAILED: 'APPLY_FAILED',
  NO_PERSISTED_CHANGES: 'NO_PERSISTED_CHANGES'
};

const isReceiptParseDebugEnabled = () => {
  const rawValue = process.env.RECEIPT_PARSE_DEBUG;
  return /^(1|true|yes|on)$/i.test(String(rawValue || '').trim());
};
export const toNumber = value => {
  return sanitizeOcrCurrencyNumber(value);
};

const sanitizeNumericCandidate = raw => {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/[oO]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
};

const extractLikelyPriceToken = raw => {
  const rawValue = String(raw || '').trim();
  if (!rawValue) return null;

  const slashParts = rawValue.split('/').map(part => part.trim()).filter(Boolean);
  if (slashParts.length > 1) {
    const slashCandidate = slashParts[slashParts.length - 1];
    if (/\d/.test(slashCandidate)) return slashCandidate;
  }

  const multiBuyMatch = rawValue.match(/\d+\s*[xX]\s*([$]?[\d.,]+)/);
  if (multiBuyMatch?.[1]) {
    return multiBuyMatch[1];
  }

  return rawValue;
};

export const sanitizeOcrCurrencyNumber = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  let cleaned = sanitizeNumericCandidate(extractLikelyPriceToken(value));
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
  const parsedUnit = sanitizeOcrCurrencyNumber(item?.unitPrice);
  const parsedTotal = sanitizeOcrCurrencyNumber(item?.totalPrice);
  const parsedQuantity = sanitizeOcrCurrencyNumber(item?.quantity);

  return calculatePerUnitCost({
    unitPrice: parsedUnit,
    totalPrice: parsedTotal,
    quantity: parsedQuantity
  });
};

const buildNormalizedPriceInput = item => {
  const parsedUnitPrice = sanitizeOcrCurrencyNumber(item?.unitPrice);
  const parsedTotalPrice = sanitizeOcrCurrencyNumber(item?.totalPrice);
  const parsedQuantity = sanitizeOcrCurrencyNumber(item?.quantity);
  const resolvedUnitPrice = resolveUnitPrice(item);
  return {
    raw: {
      unitPrice: item?.unitPrice ?? null,
      totalPrice: item?.totalPrice ?? null,
      quantity: item?.quantity ?? null
    },
    normalized: {
      unitPrice: parsedUnitPrice,
      totalPrice: parsedTotalPrice,
      quantity: parsedQuantity,
      resolvedUnitPrice
    }
  };
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
    normalizedName: getReceiptLineNormalizedName(raw?.normalizedName || receiptName),
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

const buildApprovalMetadata = ({
  existingMetadata,
  username,
  storeId,
  requestBody,
  shouldIgnorePriceLocks,
  priceLockOverrideCount,
  createdProducts,
  matchedProducts,
  appliedCount,
  skippedCount,
  lineOutcomes,
  priceNormalizationByLine,
  errorsByLine,
  inventoryUpdates,
  createdPriceObservations,
  approvalType,
  stageMetrics
}) => ({
  ...existingMetadata,
  approvedBy: username,
  approvedAt: new Date(),
  storeId,
  approvalPayload: requestBody || null,
  ignorePriceLocks: shouldIgnorePriceLocks,
  priceLockOverrideCount,
  createdProducts,
  matchedProducts,
  appliedCount,
  skippedCount,
  lineOutcomes,
  priceNormalizationByLine,
  errorsByLine,
  inventoryWriteCount: inventoryUpdates.length,
  priceObservationWriteCount: createdPriceObservations.length,
  approvalType,
  stageMetrics,
  autoCommit: approvalType === 'auto',
  inventoryUpdates
});

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
    const allowedStatuses = ['CREATED', 'QUEUED', 'PARSING', 'PARSED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'];
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
export const approveReceiptJobHandler = async (req, res) => {
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
      approvalDraft,
      strictValidation,
      autoCommit
    } = req.body || {};
    const username = req.user?.username || 'unknown';
    const shouldIgnorePriceLocks = Boolean(ignorePriceLocks);
    const isAutoCommit = Boolean(autoCommit);
    const enforceStrictValidation = Boolean(strictValidation);
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
      if (matchResult?.ambiguous || (matchResult?.confidence !== undefined && matchResult.confidence < 0.7)) {
        await session.abortTransaction();
        return res.status(409).json({
          error: 'Store candidate requires resolution before approval',
          reasonCode: 'STORE_AMBIGUOUS',
          needsStoreResolution: true,
          storeResolution: {
            matchReason: matchResult?.matchReason || 'ambiguous_candidates',
            confidence: matchResult?.confidence ?? 0,
            candidates: Array.isArray(matchResult?.topCandidates) ? matchResult.topCandidates : []
          }
        });
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
      parseJob.storeCandidate.confidence = 1;
      parseJob.storeCandidate.matchReason = 'resolved_by_operator';
    }

    if (storeCreated) {
      await recordAuditLog({
        type: 'store_created_from_receipt',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} storeId=${store._id.toString()} name=${store.name}`
      });
    }

    const settingsDoc = await AppSettings.findOne({ key: 'default' }).lean();
    const allowCreateProductApproval = Boolean(settingsDoc?.allowReceiptApprovalCreateProduct);
    const autoUpdateProductPriceFromReceipt = Boolean(settingsDoc?.autoUpdateProductPriceFromReceipt);

    const createdProducts = [];
    const matchedProducts = [];
    const inventoryUpdates = [];
    const errors = [];
    let fatalLineError = null;
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
    const captureIdString = capture._id.toString();
    const parseStageMetrics = parseJob?.metadata?.stageMetrics || {};
    const approvalStageMetrics = {
      ocrLinesExtracted: Number(parseStageMetrics.ocrLinesExtracted || 0),
      linesWithValidQtyPrice: Number(parseStageMetrics.linesWithValidQtyPrice || 0),
      upcResolvedCount: Number(parseStageMetrics.upcResolvedCount || 0),
      nameResolvedCount: Number(parseStageMetrics.nameResolvedCount || 0),
      unmatchedCount: Number(parseStageMetrics.unmatchedCount || 0),
      observationWritesCount: 0
    };
    const linePersistenceCache = new Map();

    const getPersistedLineState = async (lineIndex) => {
      if (linePersistenceCache.has(lineIndex)) {
        return linePersistenceCache.get(lineIndex);
      }

      const inventoryPersisted = await StoreInventory.exists({
        storeId: store._id,
        appliedCaptures: {
          $elemMatch: {
            captureId: captureIdString,
            lineIndex
          }
        }
      }).session(session);

      const priceObservationPersisted = await PriceObservation.exists({
        receiptCaptureId: capture._id,
        lineIndex
      }).session(session);

      const state = {
        inventoryPersisted: Boolean(inventoryPersisted),
        priceObservationPersisted: Boolean(priceObservationPersisted)
      };

      linePersistenceCache.set(lineIndex, state);
      return state;
    };


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
        const normalizedPriceInput = buildNormalizedPriceInput(item);
        const retailPrice = calculateRetail(unitPrice);
        lineOutcome.normalizedPriceInput = normalizedPriceInput;
        lineOutcome.retailPrice = retailPrice;
        if (!unitPrice) {
          const lineError = { lineIndex: item.lineIndex, error: 'Invalid unit price', code: APPROVAL_ERROR_CODES.INVALID_UNIT_PRICE };
          errors.push(lineError);
          lineOutcome.errors.push(lineError);
          continue;
        }

        const approvalItem = approvalItems.get(item.lineIndex) || {};
        const action = approvalItem.action || null;
        const effectiveAction = action || (item.boundProductId || item.suggestedProduct?.id ? 'LINK_UPC_TO_PRODUCT' : 'CAPTURE_UNMAPPED');
        const normalizedUpc = normalizeBarcode(
          approvalItem.upc || item.boundUpc || item.suggestedProduct?.upc
        );
        lineOutcome.effectiveAction = effectiveAction;

        if (effectiveAction === 'IGNORE') {
          continue;
        }

        const persistedLineState = await getPersistedLineState(item.lineIndex);
        if (persistedLineState.inventoryPersisted || persistedLineState.priceObservationPersisted) {
          lineOutcome.inventoryPersisted = persistedLineState.inventoryPersisted;
          lineOutcome.priceObservationPersisted = persistedLineState.priceObservationPersisted;
          lineOutcome.appliedState = 'already_persisted';
          continue;
        }

        if (effectiveAction === 'CREATE_PRODUCT' && !allowCreateProductApproval) {
          const lineError = {
            lineIndex: item.lineIndex,
            error: 'Receipt-driven product creation is not allowed by policy',
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

        const normalizedName = getReceiptLineNormalizedName(item);
        const rawName = item.receiptName || normalizedName || 'Receipt Item';

        if (!product) {
          const resolved = await resolveReceiptLineProduct({
            line: item,
            upc: normalizedUpc,
            normalizedName,
            session,
            fallback: 'unmapped'
          });
          product = resolved.product;
        }

        let productCreated = false;
        let unmapped = null;
        let inventory = null;
        let inventoryForUnmapped = false;
        let inventoryProductId = null;
        let inventoryUnmappedProductId = null;

        if (effectiveAction === 'CREATE_PRODUCT') {
          const createProductPersistedState = await getPersistedLineState(item.lineIndex);
          if (createProductPersistedState.inventoryPersisted || createProductPersistedState.priceObservationPersisted) {
            lineOutcome.inventoryPersisted = createProductPersistedState.inventoryPersisted;
            lineOutcome.priceObservationPersisted = createProductPersistedState.priceObservationPersisted;
            lineOutcome.appliedState = 'already_persisted';
            continue;
          }

          // Resolver order for each receipt line:
          // 1) UPC mapping (UpcItem -> Product)
          // 2) normalized-name match
          // 3) if unresolved + policy allows, create receipt-origin stub product
          if (!product) {
            try {
              const resolved = await resolveReceiptLineProduct({
                line: item,
                upc: normalizedUpc,
                normalizedName,
                session,
                fallback: 'stub',
                createProductStub: async () => {
                  const createdProduct = await Product.createReceiptProductStub({
                    name: rawName,
                    unitPrice,
                    storeId: store._id,
                    session
                  });
                  productCreated = true;
                  return createdProduct;
                }
              });
              product = resolved.product;
            } catch (productCreateError) {
              if (productCreateError?.code === 11000) {
                const resolved = await resolveReceiptLineProduct({
                  line: item,
                  upc: normalizedUpc,
                  normalizedName,
                  session,
                  fallback: 'unmapped'
                });
                product = resolved.product;
              }
              if (!product) throw productCreateError;
            }
          }

          if (productCreated) {
            createdProducts.push({
              id: product._id,
              sku: product.sku,
              name: product.name,
              lineIndex: item.lineIndex,
              effectiveAction: 'CREATE_PRODUCT'
            });
            await recordAuditLog({
              type: 'product_created_from_receipt',
              actorId: username,
              details: `jobId=${jobId} captureId=${captureIdString} lineIndex=${item.lineIndex} productId=${product._id.toString()} sku=${product.sku}`
            });
          }
        }

        if (effectiveAction === 'CAPTURE_UNMAPPED') {
          product = null;
        }

        if (!product) {
          // Always create or update UnmappedProduct for raw/unknown items
          const now = new Date();

          unmapped = await UnmappedProduct.findOne({
            storeId: store._id,
            normalizedName
          }).session(session);

          if (unmapped) {
            await UnmappedProduct.updateOne(
              { _id: unmapped._id },
              {
                $set: {
                  lastSeenAt: now,
                  lastSeenRawName: rawName
                }
              },
              { session }
            );
          } else {
            const created = await UnmappedProduct.create([
              {
                storeId: store._id,
                rawName,
                normalizedName,
                firstSeenAt: now,
                lastSeenAt: now,
                lastSeenRawName: rawName,
                status: 'NEW'
              }
            ], { session });
            unmapped = created[0];
          }

          priceObservations.push({
            unmappedProductId: unmapped._id,
            storeId: store._id,
            price: unitPrice,
            cost: unitPrice,
            quantity: normalizeQuantity(item.quantity),
            source: 'receipt',
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

        lineOutcome.productCreated = productCreated;
        if (productCreated && product) {
          lineOutcome.createdProduct = {
            id: product._id,
            sku: product.sku,
            name: product.name
          };
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
                ...(retailPrice ? { retailPrice } : {}),
                observedAt: new Date(),
                lastCost: unitPrice,
                cost: unitPrice,
                lastCostAt: new Date(),
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
                  quantity: normalizeQuantity(item.quantity),
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
          const productUpdate = {
            lastCost: unitPrice,
            lastCostAt: new Date()
          };
          if (autoUpdateProductPriceFromReceipt && retailPrice) {
            productUpdate.price = retailPrice;
          }
          await Product.findByIdAndUpdate(product._id, { $set: productUpdate }, { session });
          await recordAuditLog({
            type: 'product_updated_from_receipt',
            actorId: username,
            details: `jobId=${jobId} captureId=${captureIdString} lineIndex=${item.lineIndex} productId=${product._id.toString()} auto_price_update=${autoUpdateProductPriceFromReceipt && Boolean(retailPrice)}`
          });
        }

        if (product) {
          priceObservations.push({
            productId: product._id,
            storeId: store._id,
            price: unitPrice,
            cost: unitPrice,
            quantity: normalizeQuantity(item.quantity),
            source: 'receipt',
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
                details: `jobId=${jobId} captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()} override=true`
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
              details: `jobId=${jobId} captureId=${capture._id.toString()} upc=${normalizedUpc} productId=${product._id.toString()}`
            });
          }
        }
      } catch (itemError) {
        const lineError = { lineIndex: item.lineIndex, error: itemError.message, code: APPROVAL_ERROR_CODES.APPLY_FAILED };
        errors.push(lineError);
        lineOutcome.errors.push(lineError);
        if (!fatalLineError) fatalLineError = lineError;
        throw itemError;
      }
    }

    let createdPriceObservations = [];
    if (priceObservations.length > 0) {
      createdPriceObservations = await PriceObservation.insertMany(priceObservations, { session });
    }
    approvalStageMetrics.observationWritesCount = createdPriceObservations.length;

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
      inventoryPersisted: entry.inventoryPersisted || inventoryAppliedLineIndexes.has(entry.lineIndex),
      priceObservationPersisted: entry.priceObservationPersisted || observationAppliedLineIndexes.has(entry.lineIndex),
      applied: Boolean(
        entry.inventoryPersisted
        || entry.priceObservationPersisted
        || inventoryAppliedLineIndexes.has(entry.lineIndex)
        || observationAppliedLineIndexes.has(entry.lineIndex)
      )
    }));
    for (const lineOutcome of lineOutcomes) {
      if (lineOutcome.appliedState === 'already_persisted') continue;
      lineOutcome.appliedState = lineOutcome.applied ? 'newly_applied' : 'not_applied';
    }
    const priceLockOverrideCount = lineOutcomes.filter(entry => entry.priceLockOverridden).length;
    const newlyAppliedCount = inventoryUpdates.length + createdPriceObservations.length;
    const appliedCount = lineOutcomes.filter(entry => entry.applied).length;
    const skippedCount = Math.max(itemsToApprove.length - appliedCount, 0);
    const backendBuildId = getBackendBuildIdentifier();
    const errorsByLine = lineOutcomes
      .filter(entry => entry.errors.length > 0)
      .reduce((acc, entry) => {
        acc[entry.lineIndex] = entry.errors;
        return acc;
      }, {});

    console.info('Receipt approval summary.', {
      captureId: captureIdString,
      jobId,
      stageMetrics: approvalStageMetrics,
      selectedLineCount: itemsToApprove.length,
      appliedCount,
      skippedCount,
      inventoryWriteCount: inventoryUpdates.length,
      priceObservationWriteCount: createdPriceObservations.length
    });

    if (isReceiptParseDebugEnabled()) {
      console.info('Receipt approval debug line outcomes.', {
        captureId: captureIdString,
        jobId,
        lineOutcomes
      });
    }

    if (enforceStrictValidation && Object.keys(errorsByLine).length > 0) {
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=strict_validation_failed modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} auto_commit=${isAutoCommit}`
      });
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return res.status(400).json({
        error: 'Strict validation failed. Resolve line-level errors before approval.',
        reasonCode: APPROVAL_ERROR_CODES.NO_PERSISTED_CHANGES,
        errorsByLine,
        lineOutcomes,
        backendBuildId
      });
    }

    if (appliedCount < 1) {
      const reason = errors.length > 0
        ? 'No receipt lines were applied. All selected lines were skipped due to validation or mapping errors.'
        : 'No receipt lines were applied. Verify product mappings and unit prices, then retry.';
      await recordAuditLog({
        type: 'receipt_approval_failed',
        actorId: username,
        details: `jobId=${jobId} captureId=${capture._id.toString()} reason=no_lines_applied modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} selected=${itemsToApprove.length} ignorePriceLocks=${shouldIgnorePriceLocks} priceLockOverrides=${priceLockOverrideCount} backendBuildId=${backendBuildId}`
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
        newlyAppliedCount,
        skippedCount,
        errors,
        errorsByLine,
        lineOutcomes,
        inventoryWriteCount: inventoryUpdates.length,
        priceObservationWriteCount: createdPriceObservations.length,
        backendBuildId
      });
    }

    const previousCommitted = Number(capture.itemsCommitted || 0);
    capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + newlyAppliedCount);
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
      parseJob.metadata = buildApprovalMetadata({
        existingMetadata: parseJob.metadata,
        username,
        storeId: store._id,
        requestBody: req.body,
        shouldIgnorePriceLocks,
        priceLockOverrideCount,
        createdProducts,
        matchedProducts,
        appliedCount,
        skippedCount,
        lineOutcomes,
        priceNormalizationByLine: lineOutcomes.reduce((acc, entry) => {
          acc[entry.lineIndex] = entry.normalizedPriceInput || null;
          return acc;
        }, {}),
        errorsByLine,
        inventoryUpdates,
        createdPriceObservations,
        approvalType: isAutoCommit ? 'auto' : 'manual',
        stageMetrics: approvalStageMetrics
      });
      await parseJob.save({ session });
    }

    if (transactionStarted) {
      await session.commitTransaction();
    }

    await recordAuditLog({
      type: 'receipt_approved',
      actorId: username,
      details: `jobId=${jobId} captureId=${capture._id.toString()} storeId=${store._id.toString()} productsCreated=${createdProducts.length} inventoryUpdates=${inventoryUpdates.length} modeRaw=${String(rawRequestMode)} modeNormalized=${normalizedMode} ignorePriceLocks=${shouldIgnorePriceLocks} priceLockOverrides=${priceLockOverrideCount} backendBuildId=${backendBuildId} auto_commit=${isAutoCommit} approval_type=${isAutoCommit ? 'auto' : 'manual'} ocrLinesExtracted=${approvalStageMetrics.ocrLinesExtracted} linesWithValidQtyPrice=${approvalStageMetrics.linesWithValidQtyPrice} upcResolvedCount=${approvalStageMetrics.upcResolvedCount} nameResolvedCount=${approvalStageMetrics.nameResolvedCount} unmatchedCount=${approvalStageMetrics.unmatchedCount} observationWritesCount=${approvalStageMetrics.observationWritesCount}`
    });

    res.json({
      ok: true,
      jobId,
      captureId: capture._id.toString(),
      storeId: store._id,
      appliedCount,
      newlyAppliedCount,
      skippedCount,
      lineOutcomes,
      errorsByLine,
      createdProducts,
      matchedProducts,
      inventoryWriteCount: inventoryUpdates.length,
      priceObservationWriteCount: createdPriceObservations.length,
      stageMetrics: approvalStageMetrics,
      backendBuildId,
      inventoryUpdates,
      errors
    });
  } catch (error) {
    if (transactionStarted) {
      await session.abortTransaction();
    }
    console.error('Error approving receipt:', error);
    const firstLineError = fatalLineError || errors[0] || null;
    res.status(500).json({
      error: 'Failed to approve receipt',
      reasonCode: APPROVAL_ERROR_CODES.APPLY_FAILED,
      ...(firstLineError
        ? {
            reasonDetail: {
              code: firstLineError.code || APPROVAL_ERROR_CODES.APPLY_FAILED,
              message: firstLineError.error,
              lineIndex: firstLineError.lineIndex
            },
            firstLineError,
            firstFailingLineIndex: firstLineError.lineIndex,
            firstFailingCode: firstLineError.code || APPROVAL_ERROR_CODES.APPLY_FAILED
          }
        : {})
    });
  } finally {
    await session.endSession();
  }
};

router.post('/:jobId/approve', authRequired, approveReceiptJobHandler);

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
