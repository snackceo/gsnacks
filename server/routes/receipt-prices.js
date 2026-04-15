import express from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { GoogleGenAI } from '@google/genai';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import AppSettings from '../models/AppSettings.js';
import { authRequired, isDriverUsername, isOwnerUsername, driverCanAccessStore } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { isDbReady } from '../db/connect.js';
import { matchStoreCandidate, normalizePhone, normalizeStoreNumber, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { isPricingLearningEnabled, receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap, isReceiptAutoCommitEnabled } from '../utils/featureFlags.js';
import { enqueueReceiptJob, getReceiptQueue, isReceiptQueueEnabled } from '../queues/receiptQueue.js';
import { executeReceiptParse } from '../utils/receiptParseHelper.js';
import { transitionReceiptParseJobStatus } from '../utils/receiptParseJobStatus.js';
import {
  getReceiptLineNormalizedName,
  resolveReceiptLineProduct
} from '../utils/receiptLineResolver.js';
import { approveReceiptJob, buildAutoCommitApprovalBody } from '../services/receiptApprovalService.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';
import { buildPriceObservationPayload } from '../utils/receiptObservation.js';
import { RECEIPT_PRICES_ROUTES } from '../../contracts/naming.js';

import {
  getReceiptSettings,
  updateReceiptSettings,
  getReceiptStoreCandidates,
  postReceiptStoreCandidates,
  postReceiptNoiseRule,
  getReceiptNoiseRule,
  deleteReceiptNoiseRule,
  getReceiptAliases,
  getReceiptNoiseRules,
  postReceiptAlias,
  postReceiptNoiseRuleIgnore,
  deleteReceiptNoiseRuleIgnore,
  postReceiptUpload,
  postUploadReceiptImage,
  postReceiptCapture,
  getReceiptCapture,
  postReceiptParse,
  postReceiptParseFrame,
  postReceiptParseLive,
  getReceiptParseJobs,
  postReceiptParseJobsApprove,
  postReceiptParseJobsReject,
  getReceiptItems,
  getReceiptItemHistory,
  postReceiptPriceUpdateManual,
  getReceiptCapturesSummary,
  postReceiptRefresh,
  postReceiptLock,
  postReceiptUnlock,
  getReceiptStoreSummary,
  postReceiptFixUpc,
  postReceiptFixPrice,
  postReceiptResetReview,
  getReceiptCaptureItems,
  postReceiptCaptureExpire,
  getReceiptStoreAliases,
  getReceiptAliasHistory,
  getReceiptHealth,
  postReceiptConfirmMatch
} from '../controllers/receipt-prices.js';

/**
 * Receipt capture/parse lifecycle contract (this router):
 * - capture/upload endpoints create ReceiptCapture + ReceiptParseJob records
 * - parse trigger endpoint must be called immediately after capture (Gemini invariant)
 * - health/status endpoints support polling and queue diagnostics
 *
 * Approval/review actions are intentionally handled in /api/receipts (routes/receipts.js).
 */

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const ensureGeminiReady = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Gemini API key not configured.' };
  }
  return { ok: true, apiKey };
};

const DEFAULT_PRICE_LOCK_DAYS = 7;
const MAX_RECEIPT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_IMAGE_HOSTS = ['cloudinary.com', 'res.cloudinary.com'];
const RECEIPT_QUEUE_WORKER_STALE_MS = Math.max(
  60_000,
  Number(process.env.RECEIPT_QUEUE_WORKER_STALE_MS || 5 * 60_000)
);



const attemptAutoCommit = async ({ parseJob, captureId, user }) => {
  if (!isReceiptAutoCommitEnabled()) {
    return null;
  }

  const jobId = parseJob?._id?.toString?.() || parseJob?.id || null;
  if (!jobId) {
    await recordAuditLog({
      type: 'receipt_auto_commit_skipped',
      actorId: user?.username || 'system',
      details: `captureId=${captureId} reason=missing_job_id auto_commit=true`
    });
    return { ok: false, skipped: true, reason: 'missing_job_id' };
  }

  const approvalBody = buildAutoCommitApprovalBody({ captureId });
  const approvalUser = {
    username: user?.username || 'system:auto-commit',
    role: user?.role || 'MANAGER'
  };

  const result = await approveReceiptJob({
    jobId,
    user: approvalUser,
    body: approvalBody
  });

  await recordAuditLog({
    type: result.statusCode < 400 ? 'receipt_auto_commit_succeeded' : 'receipt_auto_commit_failed',
    actorId: approvalUser.username,
    details: `jobId=${jobId} captureId=${captureId} status=${result.statusCode} auto_commit=true`
  });

  return {
    ok: result.statusCode < 400,
    statusCode: result.statusCode,
    response: result.body
  };
};

const getReceiptQueueWorkerHealth = async () => {
  const queueEnabled = isReceiptQueueEnabled();
  if (!queueEnabled) {
    return {
      queueEnabled,
      workerHealthy: true,
      workerOffline: false,
      reason: 'queue_disabled',
      staleQueuedAgeMs: 0,
      staleThresholdMs: RECEIPT_QUEUE_WORKER_STALE_MS
    };
  }

  const queue = getReceiptQueue();
  const [counts, workers, oldestQueuedJob] = await Promise.all([
    queue
      ?.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')
      .catch(() => ({})) || {},
    queue?.getWorkers().catch(() => []) || [],
    ReceiptParseJob.findOne({ status: 'QUEUED' })
      .sort({ updatedAt: 1 })
      .select('_id updatedAt captureId')
      .lean()
  ]);

  const workerCount = Array.isArray(workers) ? workers.length : 0;
  const waitingCount = Number(counts?.waiting || 0);
  const activeCount = Number(counts?.active || 0);
  const oldestQueuedUpdatedAt = oldestQueuedJob?.updatedAt ? new Date(oldestQueuedJob.updatedAt).getTime() : null;
  const staleQueuedAgeMs = oldestQueuedUpdatedAt ? Math.max(0, Date.now() - oldestQueuedUpdatedAt) : 0;
  const staleQueued = staleQueuedAgeMs >= RECEIPT_QUEUE_WORKER_STALE_MS;
  const workerOffline = Boolean((workerCount === 0 && waitingCount > 0) || (staleQueued && activeCount === 0));

  return {
    queueEnabled,
    workerHealthy: !workerOffline,
    workerOffline,
    workerCount,
    waitingCount,
    activeCount,
    staleQueued,
    staleQueuedAgeMs,
    staleThresholdMs: RECEIPT_QUEUE_WORKER_STALE_MS,
    oldestQueuedCaptureId: oldestQueuedJob?.captureId || null,
    reason: workerOffline
      ? `Queue enabled but worker appears offline (workers=${workerCount}, waiting=${waitingCount}, staleQueued=${staleQueued}).`
      : 'ok'
  };
};

const computeReceiptOcrSuccessSummary = captures => {
  const bucketTemplate = () => ({ total: 0, success: 0, successRate: null });
  const summary = {
    windowDays: 7,
    windowStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    geminiOnly: bucketTemplate(),
    visionOnly: bucketTemplate(),
    hybrid: bucketTemplate()
  };

  const isSuccess = status => ['parsed', 'review_complete', 'committed'].includes(String(status || '').toLowerCase());
  const toBucket = metrics => {
    const attempted = String(metrics?.providerAttempted || '').toLowerCase();
    const used = String(metrics?.providerUsed || '').toLowerCase();
    const fallbackReason = metrics?.fallbackReason;
    const isHybrid = (attempted && used && attempted !== used) || Boolean(fallbackReason);
    if (isHybrid) return 'hybrid';
    if (used === 'gemini') return 'geminiOnly';
    if (used === 'vision') return 'visionOnly';
    return null;
  };

  for (const capture of captures || []) {
    const bucketName = toBucket(capture?.parseMetrics || {});
    if (!bucketName) continue;
    const bucket = summary[bucketName];
    bucket.total += 1;
    if (isSuccess(capture?.status)) bucket.success += 1;
  }

  for (const key of ['geminiOnly', 'visionOnly', 'hybrid']) {
    const b = summary[key];
    b.successRate = b.total > 0 ? Number(((b.success / b.total) * 100).toFixed(2)) : null;
  }

  return summary;
};

const coerceNumber = value => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isStoreAllowlisted = storeId => {
  const allowlist = receiptStoreAllowlist();
  if (!storeId) return false;
  if (allowlist.size === 0) return true;
  return allowlist.has(String(storeId));
};

const getReceiptIngestionGateState = async ({ storeId } = {}) => {
  const mode = receiptIngestionMode();
  const allowlist = receiptStoreAllowlist();
  const allowlistEntries = Array.from(allowlist);
  const allowlistEnabled = allowlist.size > 0;
  const normalizedStoreId = storeId ? String(storeId) : null;
  const allowlistHit = normalizedStoreId
    ? (!allowlistEnabled || allowlist.has(normalizedStoreId))
    : null;

  const capLimit = receiptDailyCap();
  let capUsedToday = null;
  if (capLimit && normalizedStoreId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    capUsedToday = await ReceiptCapture.countDocuments({
      storeId: normalizedStoreId,
      createdAt: { $gte: startOfDay }
    });
  }

  return {
    mode,
    storeId: normalizedStoreId,
    allowlist: {
      enabled: allowlistEnabled,
      entries: allowlistEntries,
      hit: allowlistHit
    },
    cap: {
      enabled: Boolean(capLimit),
      limit: capLimit,
      usedToday: capUsedToday,
      remaining: capLimit && typeof capUsedToday === 'number' ? Math.max(0, capLimit - capUsedToday) : null,
      exceeded: capLimit && typeof capUsedToday === 'number' ? capUsedToday >= capLimit : null
    }
  };
};

const ensureIngestionAllowed = async storeId => {
  const gate = await getReceiptIngestionGateState({ storeId });
  if (gate.mode === 'disabled') {
    return {
      ok: false,
      status: 503,
      error: 'Receipt ingestion disabled during rollout',
      gate
    };
  }
  if (!isStoreAllowlisted(storeId)) {
    return {
      ok: false,
      status: 403,
      error: 'Store not allowlisted for ingestion during rollout',
      gate
    };
  }

  if (gate.cap.enabled && typeof gate.cap.usedToday === 'number' && gate.cap.usedToday >= gate.cap.limit) {
    return {
      ok: false,
      status: 429,
      error: 'Receipt ingestion daily cap reached',
      gate
    };
  }

  return { ok: true, gate };
};

// Persist a proposal draft for management review without mutating inventory directly
async function upsertReceiptParseJobFromDraft({
  capture,
  draftItems,
  rawText,
  geminiOutput,
  storeCandidateOverride
}) {
  if (!capture) return null;

  let storeCandidate = null;
  try {
    const store = await Store.findById(capture.storeId).lean();
    const baseName = store?.name || capture.storeName || 'Unknown Store';
    if (store) {
      storeCandidate = {
        name: baseName,
        address: store.address || {},
        phone: store.phone,
        storeType: store.storeType,
        confidence: 1,
        storeId: store._id
      };
    } else if (baseName) {
      storeCandidate = {
        name: baseName,
        address: {},
        confidence: 0
      };
    }
  } catch (err) {
    console.warn('Failed to build storeCandidate for ReceiptParseJob:', err?.message);
  }

  if (storeCandidateOverride?.address) {
    storeCandidate = {
      ...(storeCandidate || {
        name: capture.storeName || 'Unknown Store',
        address: {},
        confidence: storeCandidateOverride.confidence ?? 0
      }),
      address: {
        ...(storeCandidate?.address || {}),
        ...storeCandidateOverride.address
      }
    };
  }

  const items = (draftItems || []).map(item => {
    const suggested = item.suggestedProduct;
    const hasSuggestion = suggested && suggested.id;
    const actionSuggestion = hasSuggestion
      ? 'LINK_UPC_TO_PRODUCT'
      : 'CAPTURE_UNMAPPED';
    const warnings = [];
    if (item.needsReview && item.reviewReason) warnings.push(item.reviewReason);
    if (item.priceDelta && item.priceDelta.flag) warnings.push(`price:${item.priceDelta.flag}`);

    return {
      rawLine: item.receiptName,
      nameCandidate: item.normalizedName || item.receiptName,
      brandCandidate: item.tokens?.brand || undefined,
      sizeCandidate: item.tokens?.size || undefined,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.totalPrice,
      upcCandidate: suggested?.upc,
      requiresUpc: !suggested?.upc,
      match: {
        productId: hasSuggestion ? suggested.id : undefined,
        registryUpcId: undefined,
        confidence: item.matchConfidence,
        reason: item.matchMethod
      },
      actionSuggestion,
      warnings
    };
  });

  const needsReview = items.some(it => it.warnings?.length); // simple guardrail

  const status = needsReview ? 'NEEDS_REVIEW' : 'PARSED';

  const payload = {
    rawText,
    structured: { draftItems },
    geminiOutput: geminiOutput || undefined,
    storeCandidate,
    items,
    warnings: draftItems.filter(it => it.needsReview && it.reviewReason).map(it => it.reviewReason)
  };

  const job = await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor: 'api',
    status,
    updates: payload
  });

  return job;
}

// Extract base64 and mime from data URL
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

const isAllowedReceiptMime = mime =>
  ALLOWED_IMAGE_MIMES.some(allowed => mime?.toLowerCase?.().includes(allowed));

const isCloudinaryUrl = url => {
  try {
    const urlObj = new URL(url);
    return ALLOWED_IMAGE_HOSTS.some(host => urlObj.hostname?.includes(host));
  } catch (err) {
    return false;
  }
};

const fetchExternalReceiptImage = async url => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!isAllowedReceiptMime(contentType)) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_RECEIPT_IMAGE_BYTES) {
      throw new Error(`Image too large: ${(contentLength / (1024 * 1024)).toFixed(1)}MB (max 5MB)`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RECEIPT_IMAGE_BYTES) {
      throw new Error(`Image too large: ${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)}MB (max 5MB)`);
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType.split(';')[0]};base64,${base64}`;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Upload handler: Cloudinary if configured, else data URL fallback
const handleReceiptImageUpload = async (base64Data) => {
  if (!base64Data) {
    throw new Error('No image data provided');
  }

  // Ensure data URL format
  const dataUrl = base64Data.startsWith('data:')
    ? base64Data
    : `data:image/jpeg;base64,${base64Data}`;

  // Log initial validation
  const validationResult = isAllowedImageDataUrl(dataUrl);
  if (!validationResult) {
    console.error('Image validation failed. Data URL length:', dataUrl.length);
    console.error('Starts with data:', dataUrl.substring(0, 50));
    throw new Error('Image content failed validation - invalid format or corrupted data');
  }

  // Fallback: return data URL if Cloudinary not configured
  if (!hasCloudinary) {
    return {
      url: dataUrl,
      thumbnailUrl: dataUrl
    };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    console.error('Failed to parse data URL');
    throw new Error('Invalid data URL format');
  }

  try {
    const uploadResult = await cloudinary.uploader.upload(dataUrl, {
      folder: RECEIPT_UPLOAD_FOLDER,
      resource_type: 'image',
      overwrite: false,
      transformation: [{ width: 1600, crop: 'limit' }],
      eager: [{ width: 400, crop: 'limit' }]
    });

    return {
      url: uploadResult.secure_url,
      thumbnailUrl: uploadResult.eager?.[0]?.secure_url || uploadResult.secure_url
    };
  } catch (uploadErr) {
    console.error('Cloudinary upload failed:', uploadErr.message);
    throw new Error(`Cloudinary upload failed: ${uploadErr.message}`);
  }
};

// Validate data URL magic bytes (best-effort) to ensure it's an image
function isAllowedImageDataUrl(dataUrl) {
  if (!dataUrl.startsWith('data:')) {
    console.error('Data URL does not start with data:');
    return false;
  }
  
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    console.error('Data URL does not match base64 format');
    return false;
  }
  
  const mime = (match[1] || '').toLowerCase();
  
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
    console.error('MIME type not allowed:', mime);
    return false;
  }

  try {
    const base64 = match[2];
    if (!base64 || base64.length === 0) {
      console.error('Base64 data is empty');
      return false;
    }
    
    // For very short base64 (less than 100 chars or ~75 bytes), skip validation
    // These might be partially captured frames or test data
    if (base64.length < 100) {
      console.warn('Base64 data very short, skipping magic byte check:', base64.length, 'chars');
      return true;
    }
    
    // Decode first 12 bytes to check magic numbers
    let buf;
    try {
      buf = Buffer.from(base64.slice(0, 80), 'base64'); // More generous buffer
    } catch (bufErr) {
      console.error('Failed to decode base64 to buffer:', bufErr.message);
      return false;
    }
    
    if (buf.length < 2) {
      console.warn('Buffer too short for magic byte check, accepting anyway');
      return true;
    }

    // Check magic bytes for JPEG (most common for canvas)
    // JPEG: FFD8FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && (buf.length < 3 || buf[2] === 0xff)) {
      console.log('Recognized as JPEG');
      return true;
    }
    
    // PNG: 89504E47
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      console.log('Recognized as PNG');
      return true;
    }
    
    // WebP: RIFF...WEBP
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      console.log('Recognized as WebP');
      return true;
    }
    
    // HEIF/HEIC: ftyp variants
    if (buf.length >= 12) {
      try {
        const brand = buf.toString('ascii', 4, 12);
        const isHeic = brand.includes('ftypheic') || brand.includes('ftypheix') || 
                       brand.includes('ftyphevc') || brand.includes('ftyphevx') || 
                       brand.includes('ftypmif1');
        if (isHeic) {
          console.log('Recognized as HEIC/HEIF');
          return true;
        }
      } catch (err) {
        // Ignore errors reading brand
      }
    }

    // If we get here and mime type is image/jpeg, allow it anyway
    // (Canvas generated JPEGs might not have standard headers in all cases)
    if (mime === 'image/jpeg') {
      console.warn('MIME says JPEG but magic bytes do not match standard JPEG header. Allowing anyway.');
      return true;
    }

    console.warn('Magic bytes do not match known image formats. First bytes:', Array.from(buf.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    return false;
  } catch (err) {
    console.error('Data URL validation failed:', err);
    return false;
  }
}

const ALIAS_CONFIDENCE_HALF_LIFE_DAYS = 90;
const ALIAS_CONFIDENCE_MATCH_THRESHOLD = 0.6;
// Price delta policy: if last price is fresh (<= 30 days), block/review updates
// when the change exceeds 30% or $1.00. Stale prices bypass the delta guard.
const PRICE_DELTA_POLICY = {
  pctThreshold: 0.30,
  absThreshold: 1.00,
  stalenessDays: 30
};

const evaluatePriceDelta = ({ lastPrice, newPrice, lastObservedAt, now = new Date() }) => {
  if (!lastPrice) {
    return {
      isStale: false,
      exceedsThreshold: false,
      pctDelta: 0,
      absDelta: 0,
      daysSinceUpdate: null
    };
  }

  const pctDelta = Math.abs(newPrice - lastPrice) / lastPrice;
  const absDelta = Math.abs(newPrice - lastPrice);
  const daysSinceUpdate = lastObservedAt
    ? (now.getTime() - new Date(lastObservedAt).getTime()) / (1000 * 60 * 60 * 24)
    : Number.POSITIVE_INFINITY;
  const isStale = daysSinceUpdate > PRICE_DELTA_POLICY.stalenessDays;
  const exceedsThreshold = !isStale && (
    pctDelta > PRICE_DELTA_POLICY.pctThreshold || absDelta >= PRICE_DELTA_POLICY.absThreshold
  );

  return { isStale, exceedsThreshold, pctDelta, absDelta, daysSinceUpdate };
};

const getAliasEffectiveConfidence = (alias, now = new Date()) => {
  const confirmedCount = Number(alias?.confirmedCount || 0);
  const baseConfidence = Math.min(1.0, 0.7 + confirmedCount * 0.1);
  const lastActivityAt = alias?.lastConfirmedAt || alias?.lastSeenAt || alias?.updatedAt || alias?.createdAt;
  if (!lastActivityAt) {
    return { baseConfidence, effectiveConfidence: baseConfidence };
  }

  const ageMs = Math.max(0, now.getTime() - new Date(lastActivityAt).getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, ageDays / ALIAS_CONFIDENCE_HALF_LIFE_DAYS);
  const effectiveConfidence = Math.max(0.1, baseConfidence * decayFactor);
  return { baseConfidence, effectiveConfidence };
};

const hasCloudinary = isCloudinaryConfigured();
const RECEIPT_UPLOAD_FOLDER = 'receipt-captures';
const RECEIPT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RECEIPT_RATE_LIMIT_MAX = 25;

const receiptLimiter = rateLimit({
  windowMs: RECEIPT_RATE_LIMIT_WINDOW_MS,
  max: RECEIPT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});

const router = express.Router();

const normalizeReceiptName = getReceiptLineNormalizedName;

const tokenizeReceiptName = name => {
  return getReceiptLineNormalizedName(name).split(' ').filter(Boolean);
};

const detectPromo = name => {
  const promoWords = ['sale', 'deal', 'promo', 'special', 'off', 'save', 'discount'];
  const tokens = tokenizeReceiptName(name);
  return tokens.some(token => promoWords.includes(token));
};

const classifyCategory = (name) => {
  if (!name) return 'other';
  const lower = name.toLowerCase();
  if (lower.includes('soda') || lower.includes('cola') || lower.includes('pop')) return 'beverage';
  if (lower.includes('chip') || lower.includes('snack')) return 'snack';
  if (lower.includes('candy') || lower.includes('chocolate')) return 'candy';
  return 'other';
};

const extractTokens = name => {
  const tokens = tokenizeReceiptName(name);
  const tokenSummary = { brand: null, size: null, flavor: [] };

  tokens.forEach(token => {
    if (token.match(/(\d+)(oz|ml|g|lb|ct|pk|pack)/)) {
      tokenSummary.size = token;
    } else if (token.match(/(coke|pepsi|sprite|lays|doritos|cheetos)/)) {
      tokenSummary.brand = token;
    } else if (token.length > 2) {
      tokenSummary.flavor.push(token);
    }
  });

  return tokenSummary;
};

const summarizeTokens = tokens => ({
  brand: tokens.brand,
  size: tokens.size,
  flavor: tokens.flavor?.slice(0, 3) || []
});

const validatePriceQuantity = (totalPrice, quantity) => {
  const price = Number(totalPrice);
  const qty = Number(quantity);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Price must be positive' };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Quantity must be positive' };
  return { ok: true };
};

const validateUPC = upc => {
  if (!upc) return false;
  const cleaned = upc.replace(/\D/g, '');
  return cleaned.length >= 8 && cleaned.length <= 14;
};

const advancedMatch = (name, candidate) => {
  const tokens = tokenizeReceiptName(name);
  const candidateTokens = tokenizeReceiptName(candidate);

  if (tokens.length === 0 || candidateTokens.length === 0) {
    return { score: 0, tokensMatch: false };
  }

  const tokenSet = new Set(tokens);
  const candidateSet = new Set(candidateTokens);
  let matchCount = 0;

  for (const token of tokenSet) {
    if (candidateSet.has(token)) {
      matchCount++;
    }
  }

  const score = matchCount / Math.max(tokenSet.size, candidateSet.size);
  return { score, tokensMatch: score > 0.3 };
};

const buildMatchHistory = (inventoryEntry) => {
  const history = inventoryEntry?.priceHistory || [];
  return history.map(entry => ({
    price: entry.price,
    observedAt: entry.observedAt,
    matchMethod: entry.matchMethod,
    matchConfidence: entry.matchConfidence,
    priceType: entry.priceType,
    promoDetected: entry.promoDetected,
    workflowType: entry.workflowType
  }));
};

const computePriceDelta = (unitPrice, history, observedPrice) => {
  const lastObserved = observedPrice || history?.[0]?.price;
  if (!lastObserved || !unitPrice) return null;
  const delta = unitPrice - lastObserved;
  const pctDelta = lastObserved ? delta / lastObserved : 0;
  let flag = null;

  if (Math.abs(pctDelta) > PRICE_DELTA_POLICY.pctThreshold || Math.abs(delta) > PRICE_DELTA_POLICY.absThreshold) {
    flag = pctDelta > 0 ? 'increase' : 'decrease';
  }

  return {
    delta,
    pctDelta,
    flag
  };
};

const mapReceiptItemsForResponse = (items) => {
  const toPositiveNumber = (value, fallback = null) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  };

  const normalizeDraftItemForResponse = (item, index) => {
    const lineIndex = typeof item?.lineIndex === 'number'
      ? item.lineIndex
      : (typeof item?.index === 'number' ? item.index : index);

    const receiptName =
      item?.receiptName ||
      item?.nameCandidate ||
      item?.rawLine ||
      item?.rawLineText ||
      'Receipt Item';

    const quantity = toPositiveNumber(item?.quantity, 1) || 1;
    const totalPrice = toPositiveNumber(item?.totalPrice ?? item?.lineTotal, null);
    const unitPrice = toPositiveNumber(
      item?.unitPrice,
      totalPrice ? totalPrice / quantity : 0
    ) || 0;

    return {
      lineIndex,
      receiptName,
      normalizedName: item?.normalizedName || getReceiptLineNormalizedName(receiptName),
      quantity,
      totalPrice: totalPrice ?? Number((unitPrice * quantity).toFixed(2)),
      unitPrice: Number(unitPrice.toFixed(2)),
      tokens: item?.tokens,
      priceDelta: item?.priceDelta,
      matchHistory: item?.matchHistory,
      suggestedProduct: item?.suggestedProduct,
      matchMethod: item?.matchMethod || item?.match?.reason,
      matchConfidence: item?.matchConfidence ?? item?.match?.confidence,
      needsReview: Boolean(item?.needsReview),
      reviewReason: item?.reviewReason,
      boundProductId: item?.boundProductId || item?.productId || item?.match?.productId,
      boundUpc: item?.boundUpc || item?.upc || item?.upcCandidate,
      confirmedAt: item?.confirmedAt,
      confirmedBy: item?.confirmedBy,
      promoDetected: item?.promoDetected,
      priceType: item?.priceType,
      workflowType: item?.workflowType
    };
  };

  return (items || []).map((item, index) => normalizeDraftItemForResponse(item, index));
};

const defaultScanBatchLimit = 40;

const sanitizeSearch = (query) => {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

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
