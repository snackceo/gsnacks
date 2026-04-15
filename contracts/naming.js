export const RECEIPTS_ROUTES = {
  GET_ALL: '/',
  GET_ONE: '/:jobId',
  APPROVE: '/:jobId/approve',
  REJECT: '/:jobId/reject',
  DELETE: '/:captureId',
  CLEANUP_QUEUE: '/cleanup-queue'
};

export const RECEIPT_PRICES_ROUTES = {
  // settings / metadata
  GET_SETTINGS: '/receipt-settings',
  POST_RECEIPT_SETTINGS: '/receipt-settings',
  GET_STORE_CANDIDATES: '/receipt-store-candidates',
  POST_STORE_CANDIDATES: '/receipt-store-candidates',
  GET_NOISE_RULE: '/receipt-noise-rule',
  POST_NOISE_RULE: '/receipt-noise-rule',
  DELETE_NOISE_RULE: '/receipt-noise-rule',
  GET_ALIASES: '/receipt-aliases',
  GET_NOISE_RULES: '/receipt-noise-rules',
  POST_ALIAS: '/receipt-alias',
  POST_NOISE_RULE_IGNORE: '/receipt-noise-rule/ignore',
  DELETE_NOISE_RULE_IGNORE: '/receipt-noise-rule/ignore',

  // ingestion / capture lifecycle
  POST_UPLOAD: '/upload',
  POST_UPLOAD_IMAGE: '/upload-receipt-image',
  POST_CAPTURE: '/receipt-capture',
  GET_CAPTURE: '/receipt-capture/:captureId',
  POST_PARSE: '/receipt-parse',
  POST_PARSE_FRAME: '/receipt-parse-frame',
  POST_PARSE_LIVE: '/receipt-parse-live',
  GET_PARSE_JOBS: '/receipt-parse-jobs',
  POST_PARSE_JOBS_APPROVE: '/receipt-parse-jobs/:captureId/approve',
  POST_PARSE_JOBS_REJECT: '/receipt-parse-jobs/:captureId/reject',

  // pricing workflows
  GET_ITEMS: '/receipt-items/:storeId',
  GET_ITEM_HISTORY: '/receipt-item-history',
  POST_PRICE_UPDATE_MANUAL: '/receipt-price-update-manual',
  GET_CAPTURES_SUMMARY: '/receipt-captures-summary',
  POST_REFRESH: '/receipt-refresh',
  POST_LOCK: '/receipt-lock',
  POST_UNLOCK: '/receipt-unlock',
  GET_STORE_SUMMARY: '/receipt-store-summary',
  POST_FIX_UPC: '/receipt-fix-upc',
  POST_FIX_PRICE: '/receipt-fix-price',
  POST_RESET_REVIEW: '/receipt-reset-review',
  GET_CAPTURE_ITEMS: '/receipt-capture/:captureId/items',
  POST_CAPTURE_EXPIRE: '/receipt-capture/:captureId/expire',
  GET_STORE_ALIASES: '/receipt-store-aliases',
  GET_ALIAS_HISTORY: '/receipt-alias-history',
  GET_HEALTH: '/receipt-health',
  POST_CONFIRM_MATCH: '/receipt-confirm-match'
};
