import AppSettings from '../../models/AppSettings.js';
import { recordAuditLog } from '../../utils/audit.js';
import { isDbReady } from '../../db/connect.js';
import { receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap } from '../../utils/featureFlags.js';
import { DEFAULT_PRICE_LOCK_DAYS } from '../../config/constants.js';

const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

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

export const updateSettings = async ({ priceLockDays, actor }) => {
  checkDb();
  if (priceLockDays === undefined || priceLockDays === null || !Number.isFinite(Number(priceLockDays))) {
    throw new Error('priceLockDays must be a number');
  }

  const settings = await AppSettings.findOneAndUpdate(
    { key: 'default' },
    { priceLockDays: Number(priceLockDays) },
    { new: true, upsert: true }
  ).lean();

  await recordAuditLog({
    type: 'receipt_settings_update',
    actorId: actor,
    details: `priceLockDays=${priceLockDays}`,
  });

  return settings;
};