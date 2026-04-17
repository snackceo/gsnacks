import mongoose from 'mongoose';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import Product from '../models/Product.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import UnmappedProduct from '../models/UnmappedProduct.js';
import PriceObservation from '../models/PriceObservation.js';
import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from './auditLogService.js';
import { getBackendBuildIdentifier } from '../utils/buildIdentifier.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';
import { buildInventoryUpdate, buildStoreInventoryQuery } from '../utils/receiptInventory.js';
import { calculateRetail, normalizeQuantity } from '../utils/pricing.js';
import {
  parseReceiptCurrency,
  resolveReceiptUnitPrice,
  buildNormalizedReceiptPriceInput,
  buildPriceObservationPayload
} from '../utils/receiptObservation.js';
import {
  getReceiptLineNormalizedName,
  normalizeReceiptLineUpc,
  resolveReceiptLineProduct
} from '../utils/receiptLineResolver.js';
import { checkDb } from './serviceUtils.js';
import * as receiptStoreService from './receiptStoreService.js'; // Assuming receiptStoreService.js is in the same directory

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


class ServiceError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || user.role === 'MANAGER';
};

const validateApprovalMode = (mode, selectedIndices) => {
  if (mode === undefined || mode === null || String(mode).trim().length === 0) {
    throw new ServiceError('mode is required: safe|selected|locked|all', 400);
  }

  const normalizedMode = String(mode).trim().toLowerCase();
  if (!['safe', 'selected', 'locked', 'all'].includes(normalizedMode)) {
    throw new ServiceError('Invalid mode', 400);
  }

  if (normalizedMode === 'selected' && (!Array.isArray(selectedIndices) || selectedIndices.length === 0)) {
    throw new ServiceError('selectedIndices required for selected mode', 400);
  }
  return normalizedMode;
};

const filterItemsToApprove = ({ validDraftItems, mode, selectedIndices, parseJob }) => {
  const SAFE_CONFIDENCE = 0.8;
  const selectedSet = Array.isArray(selectedIndices)
    ? new Set(selectedIndices.map(Number))
    : null;

  return validDraftItems.filter(item => {
    if (mode === 'selected') {
      return selectedSet?.has(item.lineIndex);
    }
    if (mode === 'safe') {
      const jobItem = (parseJob.items || []).find(i => Number(i.lineIndex) === Number(item.lineIndex));
      const confidence = Number(jobItem?.match?.confidence || item.matchConfidence || 0);
      const hasWarnings = Array.isArray(jobItem?.warnings) && jobItem.warnings.length > 0;
      const hasProduct = Boolean(jobItem?.match?.productId || item.boundProductId || item.suggestedProduct?.id);
      return !hasWarnings && hasProduct && confidence >= SAFE_CONFIDENCE;
    }
    return true; // 'all' or 'locked' mode
  });
};

/**
 * Processes a single line item during the receipt approval workflow.
 * This function is designed to be called within a MongoDB transaction.
 * @private
 */
async function _processLineItemForApproval({
  item,
  approvalItem,
  store,
  capture,
  jobId,
  session,
  settings,
  actorId,
  forceUpcOverride,
  shouldIgnorePriceLocks,
}) {
  const { allowCreateProductApproval, autoUpdateProductPriceFromReceipt } = settings;
  const lineOutcome = {
    lineIndex: item.lineIndex,
    inventoryPersisted: false,
    priceObservationPersisted: false,
    priceLockOverridden: false,
    priceLockOverrideDetail: null,
    errors: [],
  };

  const unitPrice = resolveReceiptUnitPrice(item);
  const normalizedPriceInput = buildNormalizedReceiptPriceInput(item);
  const retailPrice = calculateRetail(unitPrice);
  lineOutcome.normalizedPriceInput = normalizedPriceInput;
  lineOutcome.retailPrice = retailPrice;

  if (!unitPrice) {
    lineOutcome.errors.push({ lineIndex: item.lineIndex, error: 'Invalid unit price', code: APPROVAL_ERROR_CODES.INVALID_UNIT_PRICE });
    return { lineOutcome, priceObservation: null };
  }

  lineOutcome.effectiveAction = approvalItem.action || (item.boundProductId || item.suggestedProduct?.id ? 'LINK_UPC_TO_PRODUCT' : 'CAPTURE_UNMAPPED');
  const normalizedUpc = normalizeReceiptLineUpc(approvalItem.upc || item.boundUpc || item.suggestedProduct?.upc); // Use direct function

  if (lineOutcome.effectiveAction === 'IGNORE') {
    return { lineOutcome, priceObservation: null };
  }

  if (lineOutcome.effectiveAction === 'CREATE_PRODUCT' && !allowCreateProductApproval) {
    lineOutcome.errors.push({
      lineIndex: item.lineIndex,
      error: 'Receipt-driven product creation is not allowed by policy',
      code: APPROVAL_ERROR_CODES.CREATE_PRODUCT_NOT_ALLOWED,
    });
    return { lineOutcome, priceObservation: null };
  }

  const normalizedName = getReceiptLineNormalizedName(item);
  const rawName = item.receiptName || normalizedName || 'Receipt Item';
  let { product, productCreated } = await _resolveOrCreateProduct({
    item, approvalItem, store, session, settings, normalizedUpc, rawName, unitPrice, lineOutcome
  });
  let unmapped = null;
  let inventoryForUnmapped = false;
  let inventoryProductId = null;
  let inventoryUnmappedProductId = null;

  if (!product) {
    ({ unmapped, inventoryUnmappedProductId, inventoryForUnmapped } = await _handleUnmappedProduct({ storeId: store._id, normalizedName, rawName, session }));
  }

  lineOutcome.productCreated = productCreated;
  if (product) {
    lineOutcome.product = { id: product._id, sku: product.sku, name: product.name };
  }

  const inventoryMatchMethod = item.matchMethod || (product ? 'manual_confirm' : 'unmapped');
  const inventoryWorkflowType = item.workflowType || (product ? 'update_price' : 'unmapped');

  if (product) {
    inventoryProductId = product._id;
  }

  const storeInventoryQuery = buildStoreInventoryQuery({ storeId: store._id, productId: inventoryProductId, unmappedProductId: inventoryUnmappedProductId });

  if (storeInventoryQuery) {
    const existingInventory = await StoreInventory.findOne(storeInventoryQuery).session(session);
    if (existingInventory?.priceLockUntil && new Date(existingInventory.priceLockUntil) > new Date()) {
      if (!shouldIgnorePriceLocks) {
        lineOutcome.errors.push({ lineIndex: item.lineIndex, error: 'Price locked', code: APPROVAL_ERROR_CODES.PRICE_LOCKED, lockedUntil: existingInventory.priceLockUntil });
        return { lineOutcome, priceObservation: null };
      }
      lineOutcome.priceLockOverridden = true;
      lineOutcome.priceLockOverrideDetail = `priceLockUntil=${new Date(existingInventory.priceLockUntil).toISOString()}`;
    }

    const inventory = await StoreInventory.findOneAndUpdate(
      storeInventoryQuery,
      {
        $set: { sku: product?.sku || undefined, observedPrice: unitPrice, ...(retailPrice ? { retailPrice } : {}), observedAt: new Date(), lastCost: unitPrice, cost: unitPrice, lastCostAt: new Date(), lastVerified: new Date(), available: true, stockLevel: 'in-stock' },
        $setOnInsert: { cost: unitPrice, markup: 1.2 },
        $push: { priceHistory: { price: unitPrice, observedAt: new Date(), storeId: store._id, captureId: capture._id.toString(), orderId: capture.orderId, quantity: normalizeQuantity(item.quantity), receiptImageUrl: capture.images?.[0]?.url, receiptThumbnailUrl: capture.images?.[0]?.thumbnailUrl, matchMethod: inventoryMatchMethod, matchConfidence: item.matchConfidence, confirmedBy: actorId, priceType: item.priceType || 'unknown', promoDetected: item.promoDetected || false, workflowType: productCreated ? 'new_product' : inventoryWorkflowType } },
        $addToSet: { appliedCaptures: { captureId: capture._id.toString(), lineIndex: item.lineIndex, appliedAt: new Date() } },
      },
      { new: true, upsert: true, session }
    );

    if (inventory) {
      lineOutcome.inventoryPersisted = true;
      lineOutcome.inventoryUpdate = buildInventoryUpdate({ storeId: store._id, productId: inventoryProductId, unmappedProductId: inventoryUnmappedProductId, price: unitPrice, inventoryId: inventory?._id, lineIndex: item.lineIndex });
    }
  }

  if (product) {
    const productUpdate = { lastCost: unitPrice, lastCostAt: new Date() };
    if (autoUpdateProductPriceFromReceipt && retailPrice) {
      productUpdate.price = retailPrice;
    }
    await Product.findByIdAndUpdate(product._id, { $set: productUpdate }, { session });
  }

  let priceObservation = null;
  const observationPayload = buildPriceObservationPayload({ item, storeId: store._id, receiptCaptureId: capture._id, productId: product?._id, unmappedProductId: unmapped?._id, observedAt: new Date() });
  if (observationPayload.ok) {
    priceObservation = observationPayload.payload;
    lineOutcome.priceObservationPersisted = true;
  } else {
    lineOutcome.observationRejectedReason = observationPayload.reason;
  }

  if (product && normalizedUpc) await _handleUpcLinking({ product, normalizedUpc, forceUpcOverride, item, lineOutcome, session });
  return { lineOutcome, priceObservation };
}

/**
 * Collects and audits the results of processing a single line item.
 * @private
 */
async function _collectAndAuditLineItemResults({
  result,
  lineOutcomeByIndex,
  errors,
  observationRejectedLines,
  priceObservations,
  createdProducts,
  matchedProducts,
  inventoryUpdates,
  jobId,
  captureIdString,
  actorId,
  autoUpdateProductPriceFromReceipt,
  session // Pass session for audit logs if they need to be part of the transaction
}) {
  lineOutcomeByIndex.set(result.lineOutcome.lineIndex, result.lineOutcome);

  if (result.lineOutcome.errors.length > 0) {
    errors.push(...result.lineOutcome.errors);
  }

  if (result.lineOutcome.observationRejectedReason) {
    observationRejectedLines.push({ lineIndex: result.lineOutcome.lineIndex, reason: result.lineOutcome.observationRejectedReason });
  }

  if (result.priceObservation) {
    priceObservations.push(result.priceObservation);
  }

  if (result.lineOutcome.productCreated) {
    createdProducts.push({ ...result.lineOutcome.product, lineIndex: result.lineOutcome.lineIndex });
    await recordAuditLog({
      action: 'PRODUCT_CREATED_FROM_RECEIPT',
      actorId,
      details: { jobId, captureId: captureIdString, lineIndex: result.lineOutcome.lineIndex, productId: result.lineOutcome.product.id, sku: result.lineOutcome.product.sku },
      session // Pass session
    });
  } else if (result.lineOutcome.product) {
    matchedProducts.push({ ...result.lineOutcome.product, lineIndex: result.lineOutcome.lineIndex });
    await recordAuditLog({
      action: 'PRODUCT_UPDATED_FROM_RECEIPT',
      actorId,
      details: { jobId, captureId: captureIdString, lineIndex: result.lineOutcome.lineIndex, productId: result.lineOutcome.product.id, autoPriceUpdate: autoUpdateProductPriceFromReceipt && Boolean(result.lineOutcome.retailPrice) },
      session // Pass session
    });
  }

  if (result.lineOutcome.inventoryUpdate) {
    inventoryUpdates.push(result.lineOutcome.inventoryUpdate);
  }

  if (result.lineOutcome.upcLink) {
    await recordAuditLog({ action: 'UPC_LINKED_FROM_RECEIPT', actorId, details: { jobId, captureId: captureIdString, ...result.lineOutcome.upcLink }, session }); // Pass session
  }
}

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

/**
 * Updates the final state of the ReceiptCapture and ReceiptParseJob after approval processing.
 * @private
 */
async function _finalizeApprovalState({
  capture,
  parseJob,
  lineOutcomes,
  newlyAppliedCount,
  appliedCount,
  session,
  metadata
}) {
  const previousCommitted = Number(capture.itemsCommitted || 0);
  capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + newlyAppliedCount);
  capture.itemsConfirmed = lineOutcomes.filter(entry => entry.boundProductId).length;
  capture.itemsNeedingReview = lineOutcomes.filter(entry => entry.needsReview).length;
  capture.committedBy = metadata.username;
  capture.committedAt = new Date();

  if (appliedCount > 0) {
    capture.status = 'committed';
    capture.reviewExpiresAt = undefined;
  }

  await capture.save({ session });

  if (parseJob) {
    parseJob.status = 'APPROVED';
    parseJob.metadata = buildApprovalMetadata({
      existingMetadata: parseJob.metadata,
      ...metadata,
      lineOutcomes,
      priceNormalizationByLine: lineOutcomes.reduce((acc, entry) => {
        acc[entry.lineIndex] = entry.normalizedPriceInput || null;
        return acc;
      }, {}),
    });
    await parseJob.save({ session });
  }
}

/**
 * Builds a store candidate object based on various sources with a clear precedence.
 * Precedence: body.storeCandidate > parseJob.storeCandidate > body/capture data.
 * @private
 */
const buildStoreCandidate = (capture, parseJob, body) => { // Refactored for clarity and completeness
  const baseCandidate = {
    name: body?.storeName || capture?.storeName || 'Unknown Store',
    storeId: body?.storeId || capture?.storeId,
    address: body?.storeAddress || {},
    phone: body?.storePhone,
    storeType: body?.storeType,
    storeNumber: body?.storeNumber,
  };

  // Merge with parseJob.storeCandidate if available, then with body.storeCandidate
  const finalCandidate = { ...baseCandidate, ...parseJob?.storeCandidate, ...body?.storeCandidate };

  return finalCandidate.name ? finalCandidate : null; // Must have a name to be a valid candidate
};

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

export const getReceipts = async ({ user, query }) => {
  checkDb();
  // Only OWNER/MANAGER can see all receipts; drivers only see their own
  const isDriver = user?.role === 'DRIVER';
  if (!canApproveReceipts(user) && !isDriver) {
    throw new ServiceError('Not authorized', 403);
  }

  // Support status as comma-separated or repeated query params
  // Input validation
  let statusList = [];
  if (query.status) {
    if (Array.isArray(query.status)) {
      statusList = query.status.flatMap(s => String(s).split(',').map(x => x.trim()).filter(Boolean));
    } else if (typeof query.status === 'string') {
      statusList = String(query.status).split(',').map(x => x.trim()).filter(Boolean);
    }
    // Only allow known statuses
    const allowedStatuses = ['CREATED', 'QUEUED', 'PARSING', 'PARSED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'];
    statusList = statusList.filter(s => allowedStatuses.includes(s));
  }
  let limit = 100;
  if (query.limit) {
    const parsedLimit = Number(query.limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ServiceError('Invalid limit', 400);
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
  if (query.orderId) {
    const orderId = String(query.orderId);
    if (!/^[a-zA-Z0-9_-]{6,}$/.test(orderId)) {
      throw new ServiceError('Invalid orderId', 400);
    }
    baseQuery.orderId = orderId;
  }

  // Role-based filtering: drivers see only their captures
  const finalQuery = isDriver && user?.id
    ? { ...baseQuery, createdByUserId: user.id }
    : baseQuery;

  try {
    const jobs = await ReceiptParseJob.find(finalQuery).sort({ createdAt: -1 }).limit(limit).lean();
    if (!jobs || jobs.length === 0) {
      return { ok: true, jobs: [], message: 'No receipts found for the current filter. If you expect work, check for stuck or failed parses.' };
    }
    return { ok: true, jobs };
  } catch (err) {
    console.error('Error fetching receipts:', {
      user: user?.username,
      query: query,
      error: err.message
    });
    await recordAuditLog({
      action: 'RECEIPT_QUERY_ERROR',
      actorId: user?._id,
      details: { query, error: err.message }
    });
    throw new ServiceError('Failed to fetch receipts', 500, { message: 'Review queue unavailable. Please try again or contact support.' });
  }
};

export const getReceiptJob = async ({ user, jobId }) => {
  checkDb();
  const isDriver = user?.role === 'DRIVER';
  if (!canApproveReceipts(user) && !isDriver) {
    throw new ServiceError('Not authorized', 403);
  }
  try {
    const job = await ReceiptParseJob.findById(jobId).lean();
    if (!job) throw new ServiceError('Not found', 404);
    return { ok: true, job };
  } catch (err) {
    console.error('Error fetching receipt job:', {
      user: user?.username,
      jobId: jobId,
      error: err.message
    });
    await recordAuditLog({
      action: 'RECEIPT_JOB_QUERY_ERROR',
      actorId: user?._id,
      details: { jobId, error: err.message }
    });
    throw new ServiceError('Failed to fetch receipt job', 500);
  }
};

export const approveReceiptJob = async ({
  user,
  jobId,
  mode,
  selectedIndices,
  lockDurationDays,
  idempotencyKey,
  ignorePriceLocks,
  forceUpcOverride,
  finalStoreId,
  approvalDraft,
  strictValidation,
  autoCommit,
  body // The controller passes the whole req.body as 'body'
}) => {
  checkDb();
  if (!canApproveReceipts(user)) {
    throw new ServiceError('Not authorized to approve receipts', 403);
  }

  const session = await mongoose.startSession();
  let transactionStarted = false;
  try {
    const actorId = user?._id;
    const shouldIgnorePriceLocks = Boolean(ignorePriceLocks);
    const isAutoCommit = Boolean(autoCommit);
    const enforceStrictValidation = Boolean(strictValidation);
    const canIgnorePriceLocks = user?.role === 'MANAGER' || user?.role === 'OWNER';

    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ServiceError('Valid jobId required', 400);
    }

    if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
      throw new ServiceError('idempotencyKey is required', 400);
    }

    await session.startTransaction();
    transactionStarted = true;

    const parseJob = await ReceiptParseJob.findById(jobId).session(session);
    if (!parseJob) {
      throw new ServiceError('Receipt parse job not found', 404);
    }

    if (parseJob.status === 'REJECTED') {
      throw new ServiceError('Cannot approve a rejected job', 409);
    }
    if (parseJob.status === 'APPROVED') {
      return { ok: true, idempotent: true, jobId };
    }

    if (!parseJob.captureId) {
      throw new ServiceError('Parse job missing captureId', 400);
    }

    const capture = await ReceiptCapture.findById(parseJob.captureId).session(session);
    if (!capture) {
      await recordAuditLog({
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, reason: 'capture_not_found', captureId: parseJob.captureId }
      });
      throw new ServiceError('Receipt capture not found for job', 404);
    }

    if (shouldIgnorePriceLocks && !canIgnorePriceLocks) {
      await recordAuditLog({
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'ignore_price_locks_not_allowed', ignorePriceLocks: shouldIgnorePriceLocks }
      });
      throw new ServiceError('Not authorized to ignore price locks', 403);
    }

    if (parseJob.orderId && capture.orderId && String(parseJob.orderId) !== String(capture.orderId)) {
      throw new ServiceError('OrderId mismatch between parse job and capture', 400);
    }

    if (!['PARSED', 'NEEDS_REVIEW'].includes(parseJob.status)) {
      throw new ServiceError('Job not in approvable status', 409);
    }

    if (capture.status === 'committed') {
      return { ok: true, captureId: capture._id.toString(), status: capture.status, idempotent: true };
    }

    const normalizedMode = validateApprovalMode(mode, selectedIndices);

    let store = null;
    let storeCreated = false;
    const storeCandidate = buildStoreCandidate(capture, parseJob, body);
    if (storeCandidate) {
      const storeResult = await receiptStoreService.createStoreCandidate({ storeData: storeCandidate, user });
      store = storeResult.store || storeResult.existing;
      storeCreated = !!storeResult.store;
    }

    if (!store) {
      throw new ServiceError('Unable to resolve store for receipt', 400);
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
        action: 'STORE_CREATED_FROM_RECEIPT',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), storeId: store._id.toString(), name: store.name }
      });
    }

    const settingsDoc = await AppSettings.findOne({ key: 'default' }).lean();
    const allowCreateProductApproval = Boolean(settingsDoc?.allowReceiptApprovalCreateProduct);
    const autoUpdateProductPriceFromReceipt = Boolean(settingsDoc?.autoUpdateProductPriceFromReceipt);
    const settings = { allowCreateProductApproval, autoUpdateProductPriceFromReceipt };
    const createdProducts = [];
    const matchedProducts = [];
    const inventoryUpdates = [];
    const errors = [];
    const lineOutcomeByIndex = new Map();
    const observationRejectedLines = [];
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
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'no_draft_items', ignorePriceLocks: shouldIgnorePriceLocks }
      });
      throw new ServiceError('No draft items available to apply', 400);
    }

    const normalizedDraftItems = draftItems.map(normalizeDraftItem);
    const validDraftItems = normalizedDraftItems.filter(
      item => typeof item.lineIndex === 'number' && item.receiptName
    );

    if (validDraftItems.length === 0) {
      await recordAuditLog({
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'invalid_draft_items', ignorePriceLocks: shouldIgnorePriceLocks }
      });
      throw new ServiceError('No draft items available to apply', 400);
    }

    // Persist normalized items so you don’t keep drifting between schemas
    if (!Array.isArray(capture.draftItems) || capture.draftItems.length === 0) {
      capture.draftItems = validDraftItems;
      capture.totalItems = validDraftItems.length;
    }

    const itemsToApprove = filterItemsToApprove({
      validDraftItems,
      mode: normalizedMode,
      selectedIndices,
      parseJob
    });

    if (itemsToApprove.length === 0) {
      await recordAuditLog({
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'no_items_to_approve', mode: normalizedMode, ignorePriceLocks: shouldIgnorePriceLocks }
      });
      throw new ServiceError('No items eligible to approve in this mode. Use mode=all or fix matches/warnings.', 400);
    }

    const processingPromises = itemsToApprove.map(async (item) => { // Changed to Promise.allSettled below
      try {
        const persistedLineState = await getPersistedLineState(item.lineIndex);
        if (persistedLineState.inventoryPersisted || persistedLineState.priceObservationPersisted) {
          return {
            lineOutcome: {
              lineIndex: item.lineIndex,
              inventoryPersisted: persistedLineState.inventoryPersisted,
              priceObservationPersisted: persistedLineState.priceObservationPersisted,
              appliedState: 'already_persisted',
              errors: [],
            },
            priceObservation: null,
          };
        }
        return _processLineItemForApproval({
          item,
          approvalItem: approvalItems.get(item.lineIndex) || {},
          store,
          capture,
          jobId,
          session,
          settings,
          actorId,
          forceUpcOverride,
          shouldIgnorePriceLocks,
        });
      } catch (itemError) {
        // Collect errors but allow other promises to settle
        const lineError = { lineIndex: item.lineIndex, error: itemError.message, code: APPROVAL_ERROR_CODES.APPLY_FAILED };
        return { lineOutcome: { lineIndex: item.lineIndex, errors: [lineError] }, priceObservation: null, status: 'rejected', reason: itemError };
      }
    });

    const settledResults = await Promise.allSettled(processingPromises);
    const processingResults = settledResults.map(result => {
      if (result.status === 'rejected') {
        // The reason is already the object we want from the catch block
        return result.reason;
      }
      return result.value;
    });

    for (const result of processingResults) { // Collect and audit results for each line item
      await _collectAndAuditLineItemResults({
        result,
        lineOutcomeByIndex,
        errors,
        observationRejectedLines,
        priceObservations,
        createdProducts,
        matchedProducts,
        inventoryUpdates,
        jobId, captureIdString, actorId, autoUpdateProductPriceFromReceipt, session
      });
    }

    if (observationRejectedLines.length > 0) {
      const reasonCounts = observationRejectedLines.reduce((acc, entry) => {
        const key = entry.reason || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      await recordAuditLog({
        action: 'RECEIPT_OBSERVATION_REJECTED_LINES',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), rejectedCount: observationRejectedLines.length, reasons: reasonCounts }
      });
      approvalStageMetrics.observationRejectedLines = observationRejectedLines;
    }

    let createdPriceObservations = [];
    if (priceObservations.length > 0) {
      createdPriceObservations = await PriceObservation.insertMany(priceObservations, { session });
    }
    approvalStageMetrics.observationWritesCount = createdPriceObservations.length;

    const lineOutcomes = Array.from(lineOutcomeByIndex.values()).map(entry => ({
      ...entry,
      inventoryPersisted: entry.inventoryPersisted,
      priceObservationPersisted: entry.priceObservationPersisted,
      applied: Boolean(
        entry.inventoryPersisted
        || entry.priceObservationPersisted
      )
    }));
    for (const lineOutcome of lineOutcomes) {
      if (lineOutcome.appliedState === 'already_persisted') continue;
      lineOutcome.appliedState = lineOutcome.applied ? 'newly_applied' : 'not_applied';
    }

    const inventoryAppliedLineIndexes = new Set(
      lineOutcomes
        .map(entry => (typeof entry?.lineIndex === 'number' ? entry.lineIndex : null))
        .filter(lineIndex => lineIndex !== null)
    );
    const observationAppliedLineIndexes = new Set(
      createdPriceObservations
        .map(entry => (typeof entry?.lineIndex === 'number' ? entry.lineIndex : null))
        .filter(lineIndex => lineIndex !== null)
    );

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
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'strict_validation_failed', mode: normalizedMode, autoCommit: isAutoCommit }
      });
      throw new ServiceError('Strict validation failed. Resolve line-level errors before approval.', 400, {
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
      await recordAuditLog({ // username is not defined here
        action: 'RECEIPT_APPROVAL_FAILED',
        actorId: actorId,
        details: { jobId, captureId: capture._id.toString(), reason: 'no_lines_applied', mode: normalizedMode, selectedCount: itemsToApprove.length, ignorePriceLocks: shouldIgnorePriceLocks, priceLockOverrides: priceLockOverrideCount, backendBuildId }
      });
      throw new ServiceError(reason, 400, {
        reasonCode: APPROVAL_ERROR_CODES.NO_PERSISTED_CHANGES,
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

    await _finalizeApprovalState({
      capture,
      parseJob,
      lineOutcomes,
      newlyAppliedCount,
      appliedCount,
      session,
      metadata: {
        username: user.username,
        storeId: store._id,
        requestBody: body,
        shouldIgnorePriceLocks,
        priceLockOverrideCount,
        skippedCount,
        errorsByLine,
        inventoryUpdates,
        createdPriceObservations,
        approvalType: isAutoCommit ? 'auto' : 'manual',
        stageMetrics: approvalStageMetrics
      }
    });

    await session.commitTransaction();

    await recordAuditLog({
      action: 'RECEIPT_APPROVED',
      actorId: actorId,
      details: { jobId, captureId: capture._id.toString(), storeId: store._id.toString(), productsCreated: createdProducts.length, inventoryUpdates: inventoryUpdates.length, mode: normalizedMode, ignorePriceLocks: shouldIgnorePriceLocks, priceLockOverrides: priceLockOverrideCount, backendBuildId, autoCommit: isAutoCommit, ...approvalStageMetrics }
    });

    return {
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
    };
  } catch (error) {
    if (transactionStarted) {
      await session.abortTransaction();
    }
    console.error('Error approving receipt:', error);
    if (error instanceof ServiceError) {
      throw error;
    }
    // The detailed error is now part of the thrown ServiceError from the try/catch block
    // or a generic one is created if the error is not a ServiceError.
    throw new ServiceError('Failed to approve receipt', 500, { reasonCode: APPROVAL_ERROR_CODES.APPLY_FAILED });
  } finally {
    await session.endSession();
  }
};

export const rejectReceiptJob = async ({ user, jobId, reason }) => {
    checkDb();
    if (!canApproveReceipts(user)) {
        throw new ServiceError('Not authorized', 403);
    }
    const session = await mongoose.startSession();
    await session.startTransaction();
    try {
        const job = await ReceiptParseJob.findById(jobId).session(session);
        if (!job) throw new ServiceError('Not found', 404);
        if (job.status === 'APPROVED') {
            throw new ServiceError('Cannot reject an approved job', 409);
        }
        const alreadyRejected = job.status === 'REJECTED';
        job.status = 'REJECTED';
        job.metadata = {
            ...job.metadata,
            rejectedBy: user.username,
            rejectedAt: new Date(),
            rejectionReason: reason || 'unspecified'
        };
        await job.save({ session });

        if (!alreadyRejected) {
            await recordAuditLog({
                action: 'RECEIPT_REJECTED',
                actorId: user?._id,
                details: { jobId: job._id.toString(), reason: reason || 'unspecified' }
            });
        }
        await session.commitTransaction();
        return { ok: true };
    } catch (err) {
        await session.abortTransaction();
        if (err instanceof ServiceError) throw err;
        throw new ServiceError('Failed to reject receipt', 500);
    } finally {
        session.endSession();
    }
};

export const deleteReceipt = async ({ captureId, user }) => { // Added user for authorization
    checkDb();
    // Authorization check
    if (!canApproveReceipts(user)) {
        throw new ServiceError('Not authorized to delete receipts', 403);
    }
    if (!captureId) {
        throw new ServiceError('captureId required', 400);
    }
    try {
        await ReceiptParseJob.deleteMany({ captureId });
        await ReceiptCapture.deleteOne({ _id: captureId });
        await flushStaleReceiptJobs({ captureIds: [captureId] });
        return { ok: true };
    } catch (err) {
        console.error('Failed to delete receipt and parse jobs:', err);
        throw new ServiceError('Failed to delete receipt and parse jobs', 500);
    }
};

export const cleanupQueue = async ({ user, captureIds, dryRun }) => {
    checkDb();
    if (!canApproveReceipts(user)) {
        throw new ServiceError('Not authorized to clean receipt queue', 403);
    }
    try {
        const result = await flushStaleReceiptJobs({ captureIds, dryRun });
        if (!result.ok) {
            throw new ServiceError(result.reason || 'queue_unavailable', 503);
        }
        return { ok: true, ...result };
    } catch (err) {
        console.error('Failed to clean receipt queue:', err);
        if (err instanceof ServiceError) throw err;
        throw new ServiceError('Failed to clean receipt queue', 500);
    }
};
