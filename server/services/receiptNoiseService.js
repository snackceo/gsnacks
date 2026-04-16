import ReceiptNoiseRule from '../../models/ReceiptNoiseRule.js';
import { isDbReady } from '../../db/connect.js';
import { recordAuditLog } from '../../utils/audit.js';

const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

export const getRules = async (storeId) => {
  checkDb();
  if (!storeId) {
    const error = new Error('storeId required');
    error.statusCode = 400;
    throw error;
  }
  return ReceiptNoiseRule.find({ storeId }).sort({ createdAt: -1 }).limit(200).lean();
};

export const createRule = async ({ storeId, normalizedName, actor }) => {
  checkDb();
  if (!storeId || !normalizedName) {
    const error = new Error('storeId and normalizedName required');
    error.statusCode = 400;
    throw error;
  }

  const rule = await ReceiptNoiseRule.findOneAndUpdate(
    { storeId, normalizedName },
    { storeId, normalizedName, addedBy: actor },
    { new: true, upsert: true }
  ).lean();

  await recordAuditLog({
    type: 'receipt_noise_rule_create',
    actorId: actor,
    details: `storeId=${storeId} normalizedName=${normalizedName}`,
  });

  return rule;
};

export const deleteRule = async ({ storeId, normalizedName, actor }) => {
  checkDb();
  if (!storeId || !normalizedName) {
    const error = new Error('storeId and normalizedName required');
    error.statusCode = 400;
    throw error;
  }

  await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

  await recordAuditLog({
    type: 'receipt_noise_rule_delete',
    actorId: actor,
    details: `storeId=${storeId} normalizedName=${normalizedName}`,
  });
};