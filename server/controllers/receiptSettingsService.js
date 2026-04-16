import AppSettings from '../../models/AppSettings.js';
import { recordAuditLog } from '../../utils/audit.js';
import { isDbReady } from '../../db/connect.js';
import { receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap } from '../../utils/featureFlags.js';

const DEFAULT_PRICE_LOCK_DAYS = 7;

export const getSettings = async () => {
  if (!isDbReady()) {
    throw new Error('Database not ready');
  }
  const settings = await AppSettings.findOne({ key: 'default' }).lean();
  return {
    receiptIngestionMode: receiptIngestionMode(),
    allowlist: Array.from(receiptStoreAllowlist()),
    dailyCap: receiptDailyCap(),
    priceLockDays: settings?.priceLockDays || DEFAULT_PRICE_LOCK_DAYS,
  };
};

export const updateSettings = async ({ priceLockDays, actor }) => {
  if (!isDbReady()) {
    throw new Error('Database not ready');
  }
  if (typeof priceLockDays !== 'number') {
    throw new Error('priceLockDays must be a number.');
  }

  const settings = await AppSettings.findOneAndUpdate(
    { key: 'default' },
    { priceLockDays },
    { new: true, upsert: true }
  );

  await recordAuditLog({ type: 'receipt_settings_update', actorId: actor, details: `priceLockDays=${priceLockDays}` });

  return settings;
};