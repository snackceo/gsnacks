import express from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired } from '../utils/helpers.js';
import { RECEIPT_PRICES_ROUTES } from '../../contracts/naming.js';

import {
  deleteReceiptNoiseRule,
  deleteReceiptNoiseRuleIgnore,
  getReceiptAliasHistory,
  getReceiptAliases,
  getReceiptCapture,
  getReceiptCaptureItems,
  getReceiptCapturesSummary,
  getReceiptHealth,
  getReceiptItemHistory,
  getReceiptItems,
  getReceiptNoiseRule,
  getReceiptNoiseRules,
  getReceiptSettings,
  getReceiptStoreAliases,
  getReceiptStoreCandidates,
  getReceiptStoreSummary,
  postReceiptAlias,
  postReceiptCapture,
  postReceiptCaptureExpire,
  postReceiptConfirmMatch,
  postReceiptFixPrice,
  postReceiptFixUpc,
  postReceiptLock,
  postReceiptNoiseRule,
  postReceiptNoiseRuleIgnore,
  postReceiptParse,
  postReceiptParseFrame,
  postReceiptParseLive,
  postReceiptRefresh,
  postReceiptResetReview,
  postReceiptStoreCandidates,
  postReceiptUnlock,
  postUploadReceiptImage,
  updateReceiptSettings,
} from '../controllers/receipt/index.js';
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

const router = express.Router(); // Main router

// --- Settings Routes ---
const settingsRouter = express.Router();
settingsRouter.get(RECEIPT_PRICES_ROUTES.GET_SETTINGS, authRequired, getReceiptSettings);
settingsRouter.post(RECEIPT_PRICES_ROUTES.POST_RECEIPT_SETTINGS, authRequired, updateReceiptSettings);
router.use(settingsRouter);

// --- Store Candidates Routes ---
const storeCandidatesRouter = express.Router();
storeCandidatesRouter.get(RECEIPT_PRICES_ROUTES.GET_STORE_CANDIDATES, authRequired, getReceiptStoreCandidates);
storeCandidatesRouter.post(RECEIPT_PRICES_ROUTES.POST_STORE_CANDIDATES, authRequired, postReceiptStoreCandidates);
router.use(storeCandidatesRouter);

// --- Noise Rule Routes ---
const noiseRulesRouter = express.Router();
noiseRulesRouter.delete(RECEIPT_PRICES_ROUTES.DELETE_NOISE_RULE, authRequired, deleteReceiptNoiseRule);
noiseRulesRouter.delete(RECEIPT_PRICES_ROUTES.DELETE_NOISE_RULE_IGNORE, authRequired, deleteReceiptNoiseRuleIgnore);
noiseRulesRouter.get(RECEIPT_PRICES_ROUTES.GET_NOISE_RULE, authRequired, getReceiptNoiseRule);
noiseRulesRouter.get(RECEIPT_PRICES_ROUTES.GET_NOISE_RULES, authRequired, getReceiptNoiseRules);
noiseRulesRouter.post(RECEIPT_PRICES_ROUTES.POST_NOISE_RULE, authRequired, postReceiptNoiseRule);
noiseRulesRouter.post(RECEIPT_PRICES_ROUTES.POST_NOISE_RULE_IGNORE, authRequired, postReceiptNoiseRuleIgnore);
router.use(noiseRulesRouter);

// --- Alias Routes ---
const aliasRouter = express.Router();
aliasRouter.get(RECEIPT_PRICES_ROUTES.GET_ALIASES, authRequired, getReceiptAliases);
aliasRouter.post(RECEIPT_PRICES_ROUTES.POST_ALIAS, authRequired, postReceiptAlias);
aliasRouter.get(RECEIPT_PRICES_ROUTES.GET_STORE_ALIASES, authRequired, getReceiptStoreAliases);
aliasRouter.get(RECEIPT_PRICES_ROUTES.GET_ALIAS_HISTORY, authRequired, getReceiptAliasHistory);
aliasRouter.post(RECEIPT_PRICES_ROUTES.POST_CONFIRM_MATCH, authRequired, postReceiptConfirmMatch);
router.use(aliasRouter);

// --- Upload & Capture Routes ---
const uploadCaptureRouter = express.Router();
/**
 * POST /api/driver/upload-receipt-image
 * Upload receipt image data (data URL) to Cloudinary
 * Returns secure URL and thumbnail URL
 */
uploadCaptureRouter.post(RECEIPT_PRICES_ROUTES.POST_UPLOAD_IMAGE, authRequired, receiptLimiter, postUploadReceiptImage);
/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
 */
uploadCaptureRouter.post(RECEIPT_PRICES_ROUTES.POST_CAPTURE, authRequired, postReceiptCapture);
/**
 * GET /api/driver/receipt-capture/:captureId
 * Get receipt capture status and parsed items
 */
uploadCaptureRouter.get(RECEIPT_PRICES_ROUTES.GET_CAPTURE, authRequired, getReceiptCapture);
/**
 * GET /api/driver/receipt-capture/:captureId/items
 * Fetch receipt capture items for review (convenience route).
 */
uploadCaptureRouter.get(RECEIPT_PRICES_ROUTES.GET_CAPTURE_ITEMS, authRequired, getReceiptCaptureItems);
/**
 * POST /api/driver/receipt-capture/:captureId/expire
 * Manually expire a receipt capture (admin only)
 */
uploadCaptureRouter.post(RECEIPT_PRICES_ROUTES.POST_CAPTURE_EXPIRE, authRequired, postReceiptCaptureExpire);
/**
 * GET /api/driver/receipt-captures-summary
 * Summary counts for receipt captures by status.
 */
uploadCaptureRouter.get(RECEIPT_PRICES_ROUTES.GET_CAPTURES_SUMMARY, authRequired, getReceiptCapturesSummary);
router.use(uploadCaptureRouter);

// --- Parse Routes ---
const parseRouter = express.Router();
/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
parseRouter.post(RECEIPT_PRICES_ROUTES.POST_PARSE, authRequired, postReceiptParse);
/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
parseRouter.post(RECEIPT_PRICES_ROUTES.POST_PARSE_FRAME, authRequired, postReceiptParseFrame);
/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
parseRouter.post(RECEIPT_PRICES_ROUTES.POST_PARSE_LIVE, authRequired, postReceiptParseLive);
router.use(parseRouter);

// --- Admin & Review Routes ---
const adminReviewRouter = express.Router();
/**
 * GET /api/driver/receipt-item-history
 * Fetch price history for a receipt item
 */
adminReviewRouter.get(RECEIPT_PRICES_ROUTES.GET_ITEM_HISTORY, authRequired, getReceiptItemHistory);
/**
 * GET /api/driver/receipt-items/:storeId
 * Fetch receipt items for a store (for search / alias management)
 */
adminReviewRouter.get(RECEIPT_PRICES_ROUTES.GET_ITEMS, authRequired, getReceiptItems);
/**
 * GET /api/driver/receipt-store-summary
 * Summary of receipt captures grouped by store
 */
adminReviewRouter.get(RECEIPT_PRICES_ROUTES.GET_STORE_SUMMARY, authRequired, getReceiptStoreSummary);
/**
 * POST /api/driver/receipt-fix-price
 * Update receipt item price (used for corrections)
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_FIX_PRICE, authRequired, postReceiptFixPrice);
/**
 * POST /api/driver/receipt-fix-upc
 * Update receipt item bound UPC (used for corrections)
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_FIX_UPC, authRequired, postReceiptFixUpc);
/**
 * POST /api/driver/receipt-lock
 * Lock receipt capture for a period (prevents edits)
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_LOCK, authRequired, postReceiptLock);
/**
 * POST /api/driver/receipt-refresh
 * Reprocess failed receipt captures for a store
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_REFRESH, authRequired, postReceiptRefresh);
/**
 * POST /api/driver/receipt-reset-review
 * Reset receipt review status to parsed (reopen review)
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_RESET_REVIEW, authRequired, postReceiptResetReview);
/**
 * POST /api/driver/receipt-unlock
 * Unlock receipt capture (remove lock)
 */
adminReviewRouter.post(RECEIPT_PRICES_ROUTES.POST_UNLOCK, authRequired, postReceiptUnlock);
router.use(adminReviewRouter);

// --- Health Routes ---
const healthRouter = express.Router();
/**
 * GET /api/driver/receipt-health
 * Debug route for receipt system health
 */
healthRouter.get(RECEIPT_PRICES_ROUTES.GET_HEALTH, authRequired, getReceiptHealth);
router.use(healthRouter);

export default router;
