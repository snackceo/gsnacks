// server/utils/featureFlags.js

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
};

// Can we WRITE pricing intelligence from receipts?
export const isPricingLearningEnabled = () =>
  parseBool(process.env.PRICING_LEARNING_ENABLED, false);

// Can we READ pricing intelligence when pricing orders?
export const isStoreInventoryPricingEnabled = () =>
  parseBool(process.env.USE_STORE_INVENTORY_PRICING, false);

// Receipt ingestion controls
export const receiptIngestionMode = () => {
  const raw = String(process.env.RECEIPT_INGESTION_MODE || 'enabled')
    .trim()
    .toLowerCase();

  if (raw === 'disabled') return 'disabled';
  if (raw === 'draft') return 'enabled';
  if (raw === 'enabled') return 'enabled';

  return 'enabled';
};

export const receiptStoreAllowlist = () => {
  const raw = process.env.RECEIPT_INGESTION_STORE_ALLOWLIST || '';
  return new Set(
    raw
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  );
};

export const receiptDailyCap = () => {
  const raw = process.env.RECEIPT_INGESTION_DAILY_CAP;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
};


export const isReceiptAutoCommitEnabled = () =>
  parseBool(process.env.RECEIPT_AUTO_COMMIT_ENABLED, false);
