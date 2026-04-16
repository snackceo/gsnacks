import express from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired } from '../utils/helpers.js';
import { RECEIPT_PRICES_ROUTES } from '../../contracts/naming.js';

import { getReceiptHealth } from '../controllers/receipt/receiptHealthController.js';
import { 
  getReceiptSettings, 
  updateReceiptSettings 
} from '../controllers/receipt/receiptSettingsController.js';
import { 
  getReceiptStoreCandidates,
  postReceiptStoreCandidates 
} from '../controllers/receipt/receiptStoreController.js';
import {
  postReceiptNoiseRule,
  getReceiptNoiseRule,
  deleteReceiptNoiseRule,
  getReceiptNoiseRules,
  postReceiptNoiseRuleIgnore,
  deleteReceiptNoiseRuleIgnore
} from '../controllers/receipt/receiptNoiseController.js';
import {
  getReceiptAliases,
  postReceiptAlias,
  getReceiptStoreAliases,
  getReceiptAliasHistory,
  postReceiptConfirmMatch
} from '../controllers/receipt/receiptAliasController.js';

import {
  postReceiptUpload,
  postUploadReceiptImage,
} from '../controllers/receipt/receiptUploadController.js';
import {
  postReceiptCapture,
  getReceiptCapture,
  getReceiptCaptureItems,
  getReceiptCapturesSummary,
} from '../controllers/receipt/receiptCaptureController.js';
import {
  postReceiptParse,
  postReceiptParseFrame,
  postReceiptParseLive,
  getReceiptParseJobs,
} from '../controllers/receipt/receiptParseController.js';
import {
  postReceiptParseJobsApprove,
  postReceiptParseJobsReject,
  postReceiptCaptureExpire,
  postReceiptRefresh,
  postReceiptLock,
  postReceiptUnlock,
  getReceiptStoreSummary,
  postReceiptFixUpc,
  postReceiptFixPrice,
  postReceiptResetReview,
  getReceiptItems,
  getReceiptItemHistory,
  postReceiptPriceUpdateManual
} from '../controllers/receipt/receiptAdminController.js';
/**
 * Receipt capture/parse lifecycle contract (this router):
 * - capture/upload endpoints create ReceiptCapture + ReceiptParseJob records
 * - parse trigger endpoint must be called immediately after capture (Gemini invariant)
 * - health/status endpoints support polling and queue diagnostics
 *
 * Approval/review actions are intentionally handled in /api/receipts (routes/receipts.js).
 */

const RECEIPT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RECEIPT_RATE_LIMIT_MAX = 25;

const receiptLimiter = rateLimit({
  windowMs: RECEIPT_RATE_LIMIT_WINDOW_MS,
  max: RECEIPT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});

const router = express.Router();

router.get(RECEIPT_PRICES_ROUTES.GET_SETTINGS, authRequired, getReceiptSettings);

router.post(RECEIPT_PRICES_ROUTES.POST_RECEIPT_SETTINGS, authRequired, updateReceiptSettings);

router.get(RECEIPT_PRICES_ROUTES.GET_STORE_CANDIDATES, authRequired, getReceiptStoreCandidates);

router.post(RECEIPT_PRICES_ROUTES.POST_STORE_CANDIDATES, authRequired, postReceiptStoreCandidates);

router.post(RECEIPT_PRICES_ROUTES.POST_NOISE_RULE, authRequired, postReceiptNoiseRule);

router.get(RECEIPT_PRICES_ROUTES.GET_NOISE_RULE, authRequired, getReceiptNoiseRule);

router.delete(RECEIPT_PRICES_ROUTES.DELETE_NOISE_RULE, authRequired, deleteReceiptNoiseRule);

router.get(RECEIPT_PRICES_ROUTES.GET_ALIASES, authRequired, getReceiptAliases);

router.get(RECEIPT_PRICES_ROUTES.GET_NOISE_RULES, authRequired, getReceiptNoiseRules);

router.post(RECEIPT_PRICES_ROUTES.POST_ALIAS, authRequired, postReceiptAlias);

router.post(RECEIPT_PRICES_ROUTES.POST_NOISE_RULE_IGNORE, authRequired, postReceiptNoiseRuleIgnore);

router.delete(RECEIPT_PRICES_ROUTES.DELETE_NOISE_RULE_IGNORE, authRequired, deleteReceiptNoiseRuleIgnore);

/**
 * @deprecated Legacy combined upload path.
 * Sunset plan: migrate remaining callers to upload-receipt-image + receipt-capture + receipt-parse,
 * then remove after 2026-09-30.
 */
router.post(RECEIPT_PRICES_ROUTES.POST_UPLOAD, authRequired, receiptLimiter, postReceiptUpload);

/**
 * POST /api/driver/upload-receipt-image
 * Upload receipt image data (data URL) to Cloudinary
 * Returns secure URL and thumbnail URL
 */
router.post(RECEIPT_PRICES_ROUTES.POST_UPLOAD_IMAGE, authRequired, receiptLimiter, postUploadReceiptImage);

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
 */
router.post(RECEIPT_PRICES_ROUTES.POST_CAPTURE, authRequired, postReceiptCapture);

/**
 * GET /api/driver/receipt-capture/:captureId
 * Get receipt capture status and parsed items
 */
router.get(RECEIPT_PRICES_ROUTES.GET_CAPTURE, authRequired, getReceiptCapture);

/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PARSE, authRequired, postReceiptParse);

/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PARSE_FRAME, authRequired, postReceiptParseFrame);

/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PARSE_LIVE, authRequired, postReceiptParseLive);

/**
 * GET /api/driver/receipt-parse-jobs
 * Fetch receipt parse jobs (used by management review UI)
 */
/**
 * @deprecated Legacy queue list endpoint.
 * Sunset plan: migrate queue reads to GET /api/receipts, then remove after 2026-09-30.
 */
router.get(RECEIPT_PRICES_ROUTES.GET_PARSE_JOBS, authRequired, getReceiptParseJobs);

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/approve
 * Approve store candidate from parse job proposal
 */
/**
 * @deprecated Legacy approve-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/approve and remove after 2026-09-30.
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PARSE_JOBS_APPROVE, authRequired, postReceiptParseJobsApprove);

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/reject
 * Reject store candidate (keeps capture store null)
 */
/**
 * @deprecated Legacy reject-by-capture endpoint.
 * Sunset plan: migrate to POST /api/receipts/:jobId/reject and remove after 2026-09-30.
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PARSE_JOBS_REJECT, authRequired, postReceiptParseJobsReject);

/**
 * GET /api/driver/receipt-items/:storeId
 * Fetch receipt items for a store (for search / alias management)
 */
router.get(RECEIPT_PRICES_ROUTES.GET_ITEMS, authRequired, getReceiptItems);

/**
 * GET /api/driver/receipt-item-history
 * Fetch price history for a receipt item
 */
router.get(RECEIPT_PRICES_ROUTES.GET_ITEM_HISTORY, authRequired, getReceiptItemHistory);

/**
 * POST /api/driver/receipt-price-update-manual
 * Manual price update (bypass receipt)
 */
/**
 * @deprecated Manual ingestion path retained for compatibility with legacy operator UI.
 * Sunset plan: move all callers to capture -> parse -> approve workflow and remove after 2026-09-30.
 */
router.post(RECEIPT_PRICES_ROUTES.POST_PRICE_UPDATE_MANUAL, authRequired, postReceiptPriceUpdateManual);

/**
 * GET /api/driver/receipt-captures-summary
 * Summary counts for receipt captures by status
 */
router.get(RECEIPT_PRICES_ROUTES.GET_CAPTURES_SUMMARY, authRequired, getReceiptCapturesSummary);

/**
 * POST /api/driver/receipt-refresh
 * Reprocess failed receipt captures for a store
 */
router.post(RECEIPT_PRICES_ROUTES.POST_REFRESH, authRequired, postReceiptRefresh);

/**
 * POST /api/driver/receipt-lock
 * Lock receipt capture for a period (prevents edits)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_LOCK, authRequired, postReceiptLock);

/**
 * POST /api/driver/receipt-unlock
 * Unlock receipt capture (remove lock)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_UNLOCK, authRequired, postReceiptUnlock);

/**
 * GET /api/driver/receipt-store-summary
 * Summary of receipt captures grouped by store
 */
router.get(RECEIPT_PRICES_ROUTES.GET_STORE_SUMMARY, authRequired, getReceiptStoreSummary);

/**
 * POST /api/driver/receipt-fix-upc
 * Update receipt item bound UPC (used for corrections)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_FIX_UPC, authRequired, postReceiptFixUpc);

/**
 * POST /api/driver/receipt-fix-price
 * Update receipt item price (used for corrections)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_FIX_PRICE, authRequired, postReceiptFixPrice);

/**
 * POST /api/driver/receipt-reset-review
 * Reset receipt review status to parsed (reopen review)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_RESET_REVIEW, authRequired, postReceiptResetReview);

/**
 * GET /api/driver/receipt-capture/:captureId/items
 * Fetch receipt capture items for review (convenience route)
 */
router.get(RECEIPT_PRICES_ROUTES.GET_CAPTURE_ITEMS, authRequired, getReceiptCaptureItems);

/**
 * POST /api/driver/receipt-capture/:captureId/expire
 * Manually expire a receipt capture (admin only)
 */
router.post(RECEIPT_PRICES_ROUTES.POST_CAPTURE_EXPIRE, authRequired, postReceiptCaptureExpire);

/**
 * GET /api/driver/receipt-store-aliases
 * Fetch aliases for store (shortcut)
 */
router.get(RECEIPT_PRICES_ROUTES.GET_STORE_ALIASES, authRequired, getReceiptStoreAliases);

/**
 * GET /api/driver/receipt-alias-history
 * Fetch alias history (for admin tools)
 */
router.get(RECEIPT_PRICES_ROUTES.GET_ALIAS_HISTORY, authRequired, getReceiptAliasHistory);

/**
 * GET /api/driver/receipt-health
 * Debug route for receipt system health
 */
router.get(RECEIPT_PRICES_ROUTES.GET_HEALTH, authRequired, getReceiptHealth);

/**
 * POST /api/driver/receipt-confirm-match
 * Confirms and binds a receipt item to a product SKU during review phase
 * Creates/updates ReceiptNameAlias for future matching
 */
router.post(RECEIPT_PRICES_ROUTES.POST_CONFIRM_MATCH, authRequired, postReceiptConfirmMatch);

export default router;
