import AppSettings from '../../models/AppSettings.js';
import { recordAuditLog } from './auditLogService.js';
import { receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap } from '../../utils/featureFlags.js';
import { checkDb } from './serviceUtils.js'; // Assuming serviceUtils.js is in the same directory
import { DEFAULT_PRICE_LOCK_DAYS } from '../config/constants.js'; // Centralized constant

export const getSettings = async () => {
  checkDb();
  const settings = await AppSettings.findOne({ key: 'default' }).lean();
  return {
    receiptIngestionMode: receiptIngestionMode(),
    allowlist: Array.from(receiptStoreAllowlist()),
    dailyCap: receiptDailyCap(),
    priceLockDays: settings?.priceLockDays || DEFAULT_PRICE_LOCK_DAYS,
  };
};

export const updateSettings = async ({ priceLockDays, actorId }) => {
  checkDb();
  if (typeof priceLockDays !== 'number') {
    throw new Error('priceLockDays must be a number.');
  }

  const settings = await AppSettings.findOneAndUpdate(
    { key: 'default' },
    { priceLockDays },
    { new: true, upsert: true }
  );

  await recordAuditLog({ action: 'RECEIPT_SETTINGS_UPDATED', actorId: actorId, details: { priceLockDays } });

  return settings;
};