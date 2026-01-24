// Centralized feature flags for pricing/learning controls
export const isPricingLearningEnabled = () => String(process.env.PRICING_LEARNING_ENABLED || 'false').toLowerCase() === 'true';

export const receiptIngestionMode = () => {
  const mode = String(process.env.RECEIPT_INGESTION_MODE || 'draft').toLowerCase();
  return ['draft', 'disabled'].includes(mode) ? mode : 'draft';
};

export const receiptStoreAllowlist = () => {
  const raw = process.env.RECEIPT_INGESTION_STORE_ALLOWLIST || '';
  const ids = raw.split(',').map(v => v.trim()).filter(Boolean);
  return new Set(ids);
};

export const receiptDailyCap = () => {
  const raw = process.env.RECEIPT_INGESTION_DAILY_CAP || '';
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};
