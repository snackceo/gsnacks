// server/utils/featureFlags.js

const TRUTHY_BOOL_TOKENS = new Set(['true', '1', 'yes', 'on']);

const normalizeBoolToken = value => String(value).trim().toLowerCase();

export const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;

  const normalized = normalizeBoolToken(value);
  return TRUTHY_BOOL_TOKENS.has(normalized);
};

export const parseBoolWithReason = (value, defaultValue = false) => {
  if (value === undefined || value === null) {
    return {
      value: defaultValue,
      reason: `env unset; default=${defaultValue}`,
      raw: '(unset)',
      normalized: null
    };
  }

  if (typeof value === 'boolean') {
    return {
      value,
      reason: 'env provided boolean literal',
      raw: String(value),
      normalized: String(value)
    };
  }

  const normalized = normalizeBoolToken(value);
  const isTruthy = TRUTHY_BOOL_TOKENS.has(normalized);

  return {
    value: isTruthy,
    reason: isTruthy
      ? `matched truthy token "${normalized}"`
      : `token "${normalized}" is not truthy (${Array.from(TRUTHY_BOOL_TOKENS).join(', ')})`,
    raw: String(value),
    normalized
  };
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
