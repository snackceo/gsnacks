export const DEFAULT_PRICE_LOCK_DAYS = 7;
export const MAX_RECEIPT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const ALLOWED_IMAGE_HOSTS = ['cloudinary.com', 'res.cloudinary.com'];
export const RECEIPT_QUEUE_WORKER_STALE_MS = Math.max(
  60_000,
  Number(process.env.RECEIPT_QUEUE_WORKER_STALE_MS || 5 * 60_000)
);
export const ALIAS_CONFIDENCE_HALF_LIFE_DAYS = 90;
export const ALIAS_CONFIDENCE_MATCH_THRESHOLD = 0.6;
export const RECEIPT_UPLOAD_FOLDER = 'receipt-captures';