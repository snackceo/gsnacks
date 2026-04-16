import mongoose from 'mongoose';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import StoreInventory from '../../models/StoreInventory.js';
import ReceiptNameAlias from '../../models/ReceiptNameAlias.js';
import { isDbReady } from '../../db/connect.js';
import { recordAuditLog } from '../../utils/audit.js';
import { sanitizeSearch, validateUPC, validatePriceQuantity } from './receiptValidationService.js';
import { DEFAULT_PRICE_LOCK_DAYS } from '../../config/constants.js';

const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

export const getItemsForStore = async ({ storeId, q }) => {
  checkDb();
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    throw { statusCode: 400, message: 'Valid storeId required' };
  }
  const query = { storeId };
  if (q) {
    query.normalizedName = { $regex: sanitizeSearch(q), $options: 'i' };
  }
  return ReceiptNameAlias.find(query).sort({ lastSeenAt: -1 }).limit(200).lean();
};

export const getItemHistory = async ({ storeId, productId }) => {
  checkDb();
  if (!storeId || !productId) {
    throw { statusCode: 400, message: 'storeId and productId required' };
  }
  const inventory = await StoreInventory.findOne({ storeId, productId }).lean();
  return inventory?.priceHistory || [];
};

export const refreshFailedCaptures = async ({ storeId, actor }) => {
  checkDb();
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    throw { statusCode: 400, message: 'Valid storeId required' };
  }
  const failed = await ReceiptCapture.find({ storeId, status: 'failed' });
  if (failed.length === 0) {
    return { refreshed: 0, message: 'No failed receipts to refresh' };
  }
  for (const capture of failed) {
    capture.status = 'pending_parse';
    capture.parseError = null;
    await capture.save();
  }
  await recordAuditLog({ type: 'receipt_refresh', actorId: actor, details: `storeId=${storeId} count=${failed.length}` });
  return { refreshed: failed.length };
};

export const lockCapture = async ({ captureId, days, actor }) => {
  checkDb();
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    throw { statusCode: 400, message: 'Valid captureId required' };
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw { statusCode: 404, message: 'Receipt capture not found' };
  }
  const lockDays = Number(days) || DEFAULT_PRICE_LOCK_DAYS;
  capture.reviewExpiresAt = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000);
  await capture.save();
  await recordAuditLog({ type: 'receipt_lock', actorId: actor, details: `captureId=${captureId} days=${lockDays}` });
};

export const unlockCapture = async ({ captureId, actor }) => {
  checkDb();
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    throw { statusCode: 400, message: 'Valid captureId required' };
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw { statusCode: 404, message: 'Receipt capture not found' };
  }
  capture.reviewExpiresAt = null;
  await capture.save();
  await recordAuditLog({ type: 'receipt_unlock', actorId: actor, details: `captureId=${captureId}` });
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

export const fixItemUpc = async ({ captureId, lineIndex, upc, actor }) => {
  checkDb();
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    throw { statusCode: 400, message: 'Valid captureId required' };
  }
  if (!upc || !validateUPC(upc)) {
    throw { statusCode: 400, message: 'Valid UPC required' };
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) throw { statusCode: 404, message: 'Receipt capture not found' };
  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) throw { statusCode: 404, message: 'Draft item not found' };
  draftItem.boundUpc = upc;
  await capture.save();
  await recordAuditLog({ type: 'receipt_fix_upc', actorId: actor, details: `captureId=${captureId} lineIndex=${lineIndex} upc=${upc}` });
};

export const fixItemPrice = async ({ captureId, lineIndex, totalPrice, quantity, actor }) => {
  checkDb();
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    throw { statusCode: 400, message: 'Valid captureId required' };
  }
  const validation = validatePriceQuantity(totalPrice, quantity);
  if (!validation.ok) throw { statusCode: 400, message: validation.error };
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) throw { statusCode: 404, message: 'Receipt capture not found' };
  const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
  if (!draftItem) throw { statusCode: 404, message: 'Draft item not found' };
  draftItem.totalPrice = totalPrice;
  draftItem.quantity = quantity;
  draftItem.unitPrice = totalPrice / quantity;
  draftItem.needsReview = false;
  draftItem.reviewReason = null;
  await capture.save();
  await recordAuditLog({ type: 'receipt_fix_price', actorId: actor, details: `captureId=${captureId} lineIndex=${lineIndex} price=${totalPrice}` });
};

export const resetReview = async ({ captureId, actor }) => {
  checkDb();
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    throw { statusCode: 400, message: 'Valid captureId required' };
  }
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) throw { statusCode: 404, message: 'Receipt capture not found' };
  capture.status = 'parsed';
  capture.reviewExpiresAt = null;
  await capture.save();
  await recordAuditLog({ type: 'receipt_reset_review', actorId: actor, details: `captureId=${captureId}` });
};