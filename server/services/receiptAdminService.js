import mongoose from 'mongoose';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import StoreInventory from '../../models/StoreInventory.js';
import ReceiptNameAlias from '../../models/ReceiptNameAlias.js';
import { recordAuditLog } from './auditLogService.js';
import { sanitizeSearch, validateUPC, validatePriceQuantity } from './receiptValidationService.js'; // Assuming these are in receiptValidationService.js
import { DEFAULT_PRICE_LOCK_DAYS } from '../config/constants.js'; // Centralized constant
import { checkDb, validateStoreId, validateCaptureId } from './serviceUtils.js';

export const getItemsForStore = async ({ storeId, q }) => {
  checkDb();
  validateStoreId(storeId);
  const query = { storeId };
  if (q) {
    query.normalizedName = { $regex: sanitizeSearch(q), $options: 'i' };
  }
  return ReceiptNameAlias.find(query).sort({ lastSeenAt: -1 }).limit(200).lean();
};

export const getItemHistory = async ({ storeId, productId }) => {
  checkDb();
  validateStoreId(storeId);
  if (!productId) {
    const error = new Error('productId required');
    error.statusCode = 400;
    throw error;
  }
  const inventory = await StoreInventory.findOne({ storeId, productId }).lean();
  return inventory?.priceHistory || [];
};

export const refreshFailedCaptures = async ({ storeId, actorId }) => {
  checkDb();
  validateStoreId(storeId);
  const failed = await ReceiptCapture.find({ storeId, status: 'failed' });
  if (failed.length === 0) {
    return { refreshed: 0, message: 'No failed receipts to refresh' };
  }
  for (const capture of failed) {
    capture.status = 'pending_parse';
    capture.parseError = null;
    await capture.save();
  }
  await recordAuditLog({ action: 'RECEIPT_REFRESH', actorId: actorId, details: { storeId, count: failed.length } });
  return { refreshed: failed.length };
};

export const lockCapture = async ({ captureId, days, actorId }) => {
  checkDb();
  validateCaptureId(captureId);
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    const error = new Error('Receipt capture not found');
    error.statusCode = 404;
    throw error;
  }
  const lockDays = Number(days) || DEFAULT_PRICE_LOCK_DAYS;
  capture.reviewExpiresAt = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
  await capture.save();
  await recordAuditLog({ action: 'RECEIPT_LOCKED', actorId: actorId, details: { captureId, days: lockDays } });
};

export const unlockCapture = async ({ captureId, actorId }) => {
  checkDb();
  validateCaptureId(captureId);
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    const error = new Error('Receipt capture not found');
    error.statusCode = 404;
    throw error;
  }
  capture.reviewExpiresAt = null;
  await capture.save();
  await recordAuditLog({ action: 'RECEIPT_UNLOCKED', actorId: actorId, details: { captureId } });
};

export const getStoreSummary = async () => {
  checkDb();
  return ReceiptCapture.aggregate([
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
      },
    },
    { $sort: { totalCaptures: -1 } },
  ]);
};

export const fixItemUpc = async ({ captureId, lineIndex, upc, actorId }) => {
  checkDb();
  validateCaptureId(captureId);
  if (!upc || !validateUPC(upc)) {
    const error = new Error('Valid UPC required');
    error.statusCode = 400;
    throw error;
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    const error = new Error('Receipt capture not found');
    error.statusCode = 404;
    throw error;
  }
  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) {
    const error = new Error('Draft item not found');
    error.statusCode = 404;
    throw error;
  }
  draftItem.boundUpc = upc;
  await capture.save();
  await recordAuditLog({ action: 'RECEIPT_ITEM_UPC_FIXED', actorId: actorId, details: { captureId, lineIndex, upc } });
};

export const fixItemPrice = async ({ captureId, lineIndex, totalPrice, quantity, actorId }) => {
  checkDb();
  validateCaptureId(captureId);
  const validation = validatePriceQuantity(totalPrice, quantity);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    const error = new Error('Receipt capture not found');
    error.statusCode = 404;
    throw error;
  }
  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) {
    const error = new Error('Draft item not found');
    error.statusCode = 404;
    throw error;
  }
  draftItem.totalPrice = totalPrice;
  draftItem.quantity = quantity;
  draftItem.unitPrice = totalPrice / quantity;
  draftItem.needsReview = false;
  draftItem.reviewReason = null;
  await capture.save();
  await recordAuditLog({ action: 'RECEIPT_ITEM_PRICE_FIXED', actorId: actorId, details: { captureId, lineIndex, totalPrice, quantity } });
};

export const resetReview = async ({ captureId, actorId }) => {
  checkDb();
  validateCaptureId(captureId);
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    const error = new Error('Receipt capture not found');
    error.statusCode = 404;
    throw error;
  }
  capture.status = 'parsed';
  capture.reviewExpiresAt = null;
  await capture.save();
  await recordAuditLog({ action: 'RECEIPT_REVIEW_RESET', actorId: actorId, details: { captureId } });
};