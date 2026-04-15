export const RECEIPTS_ROUTES = {
  GET_ALL: "/",
  GET_ONE: "/:jobId",
  APPROVE: "/:jobId/approve",
  REJECT: "/:jobId/reject",
  DELETE: "/:captureId",
  CLEANUP_QUEUE: "/cleanup-queue",
};

export const RECEIPT_PRICES_ROUTES = {
  // From api.matrix.json, all prefixed with /api/driver, so we make them relative
  POST_RECEIPT_CAPTURE: "/receipt-capture",
  GET_RECEIPT_CAPTURE: "/receipt-capture/:captureId",
  POST_RECEIPT_CAPTURE_EXPIRE: "/receipt-capture/:captureId/expire",
  GET_RECEIPT_CAPTURE_ITEMS: "/receipt-capture/:captureId/items",
  POST_UPLOAD_RECEIPT_IMAGE: "/upload-receipt-image",
  POST_RECEIPT_PARSE: "/receipt-parse",
  POST_RECEIPT_PARSE_FRAME: "/receipt-parse-frame",
  POST_RECEIPT_PARSE_LIVE: "/receipt-parse-live",
  GET_RECEIPT_PARSE_JOBS: "/receipt-parse-jobs", // Deprecated
  POST_RECEIPT_PARSE_JOBS_APPROVE: "/receipt-parse-jobs/:captureId/approve", // Deprecated
  POST_RECEIPT_PARSE_JOBS_REJECT: "/receipt-parse-jobs/:captureId/reject", // Deprecated
  POST_RECEIPT_LOCK: "/receipt-lock",
  POST_RECEIPT_UNLOCK: "/receipt-unlock",
  POST_RECEIPT_RESET_REVIEW: "/receipt-reset-review",
  POST_RECEIPT_CONFIRM_MATCH: "/receipt-confirm-match",
  GET_RECEIPT_ITEMS: "/receipt-items/:storeId",
  POST_RECEIPT_PRICE_UPDATE_MANUAL: "/receipt-price-update-manual", // Deprecated
  POST_RECEIPT_FIX_PRICE: "/receipt-fix-price",
  POST_RECEIPT_FIX_UPC: "/receipt-fix-upc",
  POST_RECEIPT_REFRESH: "/receipt-refresh", // Belongs to pricing domain in matrix
  GET_RECEIPT_ITEM_HISTORY: "/receipt-item-history", // Belongs to analytics, but is in receipt-prices file
  GET_RECEIPT_CAPTURES_SUMMARY: "/receipt-captures-summary",
  GET_RECEIPT_STORE_SUMMARY: "/receipt-store-summary",
  GET_RECEIPT_SETTINGS: "/receipt-settings",
  POST_RECEIPT_SETTINGS: "/receipt-settings",
  GET_RECEIPT_STORE_CANDIDATES: "/receipt-store-candidates",
  POST_RECEIPT_STORE_CANDIDATES: "/receipt-store-candidates",
  GET_RECEIPT_HEALTH: "/receipt-health"
};

export const RECEIPT_ALIASES_ROUTES = {
    GET_ALIASES: "/receipt-aliases",
    POST_ALIAS: "/receipt-alias",
    GET_ALIAS_HISTORY: "/receipt-alias-history",
    GET_STORE_ALIASES: "/receipt-store-aliases",
    GET_NOISE_RULES: "/receipt-noise-rules",
    POST_NOISE_RULE: "/receipt-noise-rule",
    DELETE_NOISE_RULE: "/receipt-noise-rule",
    POST_NOISE_RULE_IGNORE: "/receipt-noise-rule/ignore",
    DELETE_NOISE_RULE_IGNORE: "/receipt-noise-rule/ignore"
};
