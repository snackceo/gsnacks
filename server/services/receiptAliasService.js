import mongoose from 'mongoose';
import ReceiptNameAlias from '../../models/ReceiptNameAlias.js';
import Product from '../../models/Product.js';
import Store from '../../models/Store.js';
import { recordAuditLog } from './auditLogService.js';
import { getReceiptLineNormalizedName } from '../../utils/receiptLineResolver.js';
import { checkDb, validateStoreId } from './serviceUtils.js';

export const getAliasesByStore = async (storeId) => {
  checkDb();
  validateStoreId(storeId);
  return ReceiptNameAlias.find({ storeId }).sort({ confirmedCount: -1 }).limit(200).lean();
};

export const getStoreAliasesSortedByConfirmation = async (storeId) => {
  checkDb();
  validateStoreId(storeId);
  return ReceiptNameAlias.find({ storeId }).sort({ lastConfirmedAt: -1 }).limit(100).lean();
};

export const createAlias = async ({ storeId, normalizedName, rawName, productId, upc, actorId }) => {
  checkDb();
  if (!storeId || !normalizedName || !productId) {
    const error = new Error('storeId, normalizedName, and productId are required');
    error.statusCode = 400;
    throw error;
  }

  const alias = await ReceiptNameAlias.findOneAndUpdate(
    { storeId, normalizedName, productId },
    {
      storeId,
      normalizedName,
      productId,
      ...(upc && { upc }), // Only add upc if it exists
      ...(rawName && { $addToSet: { rawNames: { name: rawName } } }), // Only add rawName if it exists
      $inc: { confirmedCount: 1 },
      lastConfirmedAt: new Date(),
      confirmedBy: actorId,
    },
    { new: true, upsert: true }
  ).lean();

  await recordAuditLog({
    action: 'RECEIPT_ALIAS_CONFIRMED',
    actorId: actorId,
    details: { storeId, normalizedName, productId },
  });

  return alias;
};

export const getAliasHistory = async ({ storeId, normalizedName }) => {
  checkDb();
  if (!storeId || !normalizedName) {
    const error = new Error('storeId and normalizedName required');
    error.statusCode = 400;
    throw error;
  }
  return ReceiptNameAlias.findOne({ storeId, normalizedName }).lean();
};

export const confirmMatch = async ({ receiptName, sku, storeId, actorId }) => {
  checkDb();
  if (!receiptName || !sku) {
    const error = new Error('receiptName and sku are required');
    error.statusCode = 400;
    throw error;
  }

  const product = await Product.findOne({ sku }).lean();
  if (!product) {
    const error = new Error(`Product with SKU ${sku} not found`);
    error.statusCode = 404;
    throw error;
  }

  const normalizedName = getReceiptLineNormalizedName(receiptName);
  const alias = await createAlias({ storeId, normalizedName, rawName: receiptName, productId: product._id, upc: product.upc, actorId });

  return { message: 'Receipt item match confirmed', aliasId: alias._id, productId: product._id, sku };
};