import ReceiptNoiseRule from '../../models/ReceiptNoiseRule.js';
import { recordAuditLog } from './auditLogService.js';
import { checkDb, validateStoreId } from './serviceUtils.js';

export const getRules = async (storeId) => {
  checkDb();
  validateStoreId(storeId);
  return ReceiptNoiseRule.find({ storeId }).sort({ createdAt: -1 }).limit(200).lean();
};

export const createRule = async ({ storeId, normalizedName, actorId }) => {
  checkDb();
  if (!storeId || !normalizedName) {
    const error = new Error('storeId and normalizedName required');
    error.statusCode = 400;
    throw error;
  }

  const rule = await ReceiptNoiseRule.findOneAndUpdate(
    { storeId, normalizedName },
    { storeId, normalizedName, addedBy: actorId },
    { new: true, upsert: true }
  ).lean();

  await recordAuditLog({
    action: 'RECEIPT_NOISE_RULE_CREATED',
    actorId: actorId,
    details: { storeId, normalizedName },
  });

  return rule;
};

export const deleteRule = async ({ storeId, normalizedName, actorId }) => {
  checkDb();
  if (!storeId || !normalizedName) {
    const error = new Error('storeId and normalizedName required');
    error.statusCode = 400;
    throw error;
  }

  await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

  await recordAuditLog({
    action: 'RECEIPT_NOISE_RULE_DELETED',
    actorId: actorId,
    details: { storeId, normalizedName },
  });
};