import mongoose from 'mongoose';
import ReceiptNameAlias from '../../models/ReceiptNameAlias.js';
import Product from '../../models/Product.js';
import Store from '../../models/Store.js';
import { isDbReady } from '../../db/connect.js';
import { recordAuditLog } from '../../utils/audit.js';
import { getReceiptLineNormalizedName } from '../../utils/receiptLineResolver.js';

const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

export const getAliasesByStore = async (storeId) => {
  checkDb();
  if (!storeId) {
    const error = new Error('storeId required');
    error.statusCode = 400;
    throw error;
  }
  return ReceiptNameAlias.find({ storeId }).sort({ confirmedCount: -1 }).limit(200).lean();
};

export const getStoreAliasesSortedByConfirmation = async (storeId) => {
  checkDb();
  if (!storeId) {
    const error = new Error('storeId required');
    error.statusCode = 400;
    throw error;
  }
  return ReceiptNameAlias.find({ storeId }).sort({ lastConfirmedAt: -1 }).limit(100).lean();
};

export const createAlias = async ({ storeId, normalizedName, rawName, productId, upc, actor }) => {
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
      upc: upc || undefined,
      $addToSet: { rawNames: rawName ? { name: rawName } : undefined },
      $inc: { confirmedCount: 1 },
      lastConfirmedAt: new Date(),
      confirmedBy: actor,
    },
    { new: true, upsert: true }
  ).lean();

  await recordAuditLog({
    type: 'receipt_alias_confirm',
    actorId: actor,
    details: `storeId=${storeId} name=${normalizedName} product=${productId}`,
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

export const confirmMatch = async ({ receiptName, sku, storeId, actor }) => {
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
  const alias = await createAlias({ storeId, normalizedName, rawName: receiptName, productId: product._id, upc: product.upc, actor });

  return { message: 'Receipt item match confirmed', aliasId: alias._id, productId: product._id, sku };
};