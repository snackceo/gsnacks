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

router.get('/receipt-settings', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const settings = await AppSettings.findOne({ key: 'default' }).lean();
    const effective = {
      receiptIngestionMode: receiptIngestionMode(),
      allowlist: Array.from(receiptStoreAllowlist()),
      dailyCap: receiptDailyCap(),
      priceLockDays: settings?.priceLockDays || DEFAULT_PRICE_LOCK_DAYS
    };
    res.json({ ok: true, settings: effective });
  } catch (error) {
    console.error('Error fetching receipt settings:', error);
    res.status(500).json({ error: 'Failed to fetch receipt settings' });
  }
});

router.post('/receipt-settings', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { priceLockDays } = req.body;
    const username = req.user?.username || 'unknown';

    const settings = await AppSettings.findOneAndUpdate(
      { key: 'default' },
      { priceLockDays },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_settings_update',
      actorId: username,
      details: `priceLockDays=${priceLockDays}`
    });

    res.json({ ok: true, settings });
  } catch (error) {
    console.error('Error updating receipt settings:', error);
    res.status(500).json({ error: 'Failed to update receipt settings' });
  }
});

router.get('/receipt-store-candidates', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { q } = req.query;
    const safeQuery = sanitizeSearch(q);
    if (!safeQuery) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const stores = await Store.find({ name: { $regex: safeQuery, $options: 'i' } })
      .select('name address phone storeType')
      .limit(20)
      .lean();

    res.json({ ok: true, stores });
  } catch (error) {
    console.error('Error searching store candidates:', error);
    res.status(500).json({ error: 'Failed to search store candidates' });
  }
});

router.post('/receipt-store-candidates', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeName, address, phone, storeType, storeNumber } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeName) {
      return res.status(400).json({ error: 'Store name required' });
    }

    const stored = await Store.findOne({ name: storeName }).lean();
    if (stored) {
      return res.json({ ok: true, existing: stored });
    }

    const allowCreate = shouldAutoCreateStore({
      name: storeName,
      address,
      phone,
      phoneNormalized: normalizePhone(phone),
      storeNumber: normalizeStoreNumber(storeNumber),
      storeType
    });
    if (!allowCreate) {
      return res.status(403).json({ error: 'Auto store creation disabled' });
    }

    const store = await Store.create({
      name: storeName,
      address,
      phone,
      phoneNormalized: normalizePhone(phone),
      storeNumber: normalizeStoreNumber(storeNumber),
      storeType
    });

    await recordAuditLog({
      type: 'receipt_store_create',
      actorId: username,
      details: `storeName=${storeName}`
    });

    res.json({ ok: true, store });
  } catch (error) {
    console.error('Error creating store:', error);
    res.status(500).json({ error: 'Failed to create store' });
  }
});

router.post('/receipt-noise-rule', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const rule = await ReceiptNoiseRule.findOneAndUpdate(
      { storeId, normalizedName },
      { storeId, normalizedName, addedBy: username },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_noise_rule_create',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true, rule });
  } catch (error) {
    console.error('Error creating receipt noise rule:', error);
    res.status(500).json({ error: 'Failed to create noise rule' });
  }
});

router.get('/receipt-noise-rule', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const rules = await ReceiptNoiseRule.find({ storeId }).lean();
    res.json({ ok: true, rules });
  } catch (error) {
    console.error('Error fetching noise rules:', error);
    res.status(500).json({ error: 'Failed to fetch noise rules' });
  }
});

router.delete('/receipt-noise-rule', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

    await recordAuditLog({
      type: 'receipt_noise_rule_delete',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting noise rule:', error);
    res.status(500).json({ error: 'Failed to delete noise rule' });
  }
});

router.get('/receipt-aliases', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const aliases = await ReceiptNameAlias.find({ storeId })
      .sort({ confirmedCount: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching receipt aliases:', error);
    res.status(500).json({ error: 'Failed to fetch receipt aliases' });
  }
});

router.get('/receipt-noise-rules', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const rules = await ReceiptNoiseRule.find({ storeId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, rules });
  } catch (error) {
    console.error('Error fetching receipt noise rules:', error);
    res.status(500).json({ error: 'Failed to fetch receipt noise rules' });
  }
});

router.post('/receipt-alias', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName, rawName, productId, upc } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName || !productId) {
      return res.status(400).json({ error: 'storeId, normalizedName, productId required' });
    }

    const alias = await ReceiptNameAlias.findOneAndUpdate(
      { storeId, normalizedName, productId },
      {
        storeId,
        normalizedName,
        productId,
        upc: upc || undefined,
        $addToSet: {
          rawNames: rawName ? { name: rawName } : undefined
        },
        $inc: { confirmedCount: 1 },
        lastConfirmedAt: new Date(),
        confirmedBy: username
      },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_alias_confirm',
      actorId: username,
      details: `storeId=${storeId} name=${normalizedName} product=${productId}`
    });

    res.json({ ok: true, alias });
  } catch (error) {
    console.error('Error creating receipt alias:', error);
    res.status(500).json({ error: 'Failed to create receipt alias' });
  }
});

router.post('/receipt-noise-rule/ignore', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const rule = await ReceiptNoiseRule.findOneAndUpdate(
      { storeId, normalizedName },
      { storeId, normalizedName, addedBy: username },
      { new: true, upsert: true }
    );

    await recordAuditLog({
      type: 'receipt_noise_rule_ignore',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true, rule });
  } catch (error) {
    console.error('Error creating noise rule:', error);
    res.status(500).json({ error: 'Failed to ignore receipt noise rule' });
  }
});

router.delete('/receipt-noise-rule/ignore', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    await ReceiptNoiseRule.deleteOne({ storeId, normalizedName });

    await recordAuditLog({
      type: 'receipt_noise_rule_unignore',
      actorId: username,
      details: `storeId=${storeId} normalizedName=${normalizedName}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting noise rule ignore:', error);
    res.status(500).json({ error: 'Failed to unignore receipt noise rule' });
  }
});

router.post('/receipt-upload', authRequired, receiptLimiter, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image data required' });
    }

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    if (receiptIngestionMode() === 'disabled') {
      const gate = await getReceiptIngestionGateState({ storeId });
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout', gate });
    }

    if (storeId) {
      const ingestionCheck = await ensureIngestionAllowed(storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > MAX_RECEIPT_IMAGE_BYTES) {
      const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
      return res.status(413).json({ error: `Image too large: ${sizeMB}MB (max 5MB)` });
    }

    const result = await handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error.message);
    // Return specific error messages so frontend can debug
    res.status(500).json({ 
      error: error.message || 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/driver/upload-receipt-image
 * Upload receipt image data (data URL) to Cloudinary
 * Returns secure URL and thumbnail URL
 */
router.post('/upload-receipt-image', authRequired, receiptLimiter, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    if (!image) {
      return res.status(400).json({ error: 'Image data required' });
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > MAX_RECEIPT_IMAGE_BYTES) {
      const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
      return res.status(413).json({ error: `Image too large: ${sizeMB}MB (max 5MB)` });
    }

    const result = await handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error.message);
    // Return specific error messages so frontend can debug
    res.status(500).json({ 
      error: error.message || 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
 */
router.post('/receipt-capture', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, storeName, orderId, images, captureRequestId, source: requestedSource } = req.body;
    const username = req.user?.username;
    const userId = req.user?.id || req.user?.userId;
    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const normalizedStoreName =
      typeof storeName === 'string' && storeName.trim().length > 0 ? storeName.trim() : undefined;

    // Authorization check
    const isOwner = isOwnerRole || isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    const isManagement = isOwner || isManagerRole;
    const createdByRole = isOwner ? 'OWNER' : isManagerRole ? 'MANAGER' : isDriver ? 'DRIVER' : undefined;
    const source = requestedSource === 'email_import' && isManagement
      ? 'email_import'
      : isManagement
      ? 'management_upload'
      : isDriver
      ? 'driver_camera'
      : undefined;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to upload receipts' });
    }

    // Idempotency: check if this captureRequestId already exists
    if (captureRequestId && typeof captureRequestId === 'string' && captureRequestId.length >= 8) {
      const existingCapture = await ReceiptCapture.findOne({ 
        captureRequestId,
        createdBy: username
      });
      if (existingCapture) {
        // Return existing capture (idempotent)
        return res.json({
          ok: true,
          captureId: existingCapture._id.toString(),
          status: existingCapture.status,
          imageCount: existingCapture.images.length,
          idempotent: true
        });
      }
    } else if (!captureRequestId) {
      return res.status(400).json({ error: 'captureRequestId required (UUID recommended)' });
    }

    // Validation
    if (receiptIngestionMode() === 'disabled') {
      const gate = await getReceiptIngestionGateState({ storeId });
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout', gate });
    }
    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }
    if (!images || !Array.isArray(images) || images.length === 0 || images.length > 3) {
      return res.status(400).json({ error: 'images array required (1-3 photos)' });
    }

    let store = null;
    if (storeId) {
      // Find store by id
      store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    }

    // Enforce driver-store binding
    if (store && isDriver && !driverCanAccessStore(username, store._id.toString())) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    if (store) {
      const ingestionCheck = await ensureIngestionAllowed(store._id.toString());
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    // Validate image URLs and sizes
    const normalizedImages = [];
    for (const img of images) {
      if (!img.url || typeof img.url !== 'string') {
        return res.status(400).json({ error: 'Each image must have a url' });
      }
      // Validate data URL size (max 5MB per image)
      if (img.url.startsWith('data:')) {
        const sizeMB = img.url.length / (1024 * 1024);
        if (sizeMB > 5) {
          return res.status(400).json({ error: `Image too large: ${sizeMB.toFixed(1)}MB (max 5MB)` });
        }

        const mimeMatch = img.url.match(/^data:([^;]+);base64,/i);
        const mime = mimeMatch?.[1] || '';
        if (!ALLOWED_IMAGE_MIMES.includes(mime.toLowerCase())) {
          return res.status(400).json({ error: `Unsupported image type: ${mime || 'unknown'}` });
        }

        if (!isAllowedImageDataUrl(img.url)) {
          return res.status(400).json({ error: 'Image content failed validation (corrupt or unsupported)' });
        }

        if (!hasCloudinary) {
          return res.status(503).json({ error: 'Cloudinary not configured for receipt image uploads' });
        }

        const uploaded = await handleReceiptImageUpload(img.url);
        normalizedImages.push({
          url: uploaded.url,
          thumbnailUrl: uploaded.thumbnailUrl
        });
      } else {
        // Non-data URLs must be valid image URLs (HTTPS, allowed hosts, content-type check)
        if (!/^https?:\/\//i.test(img.url)) {
          console.warn('Receipt capture rejected image URL with unsupported scheme', {
            url: img.url,
            captureRequestId
          });
          await recordAuditLog({
            type: 'receipt_capture_reject',
            actorId: username || 'unknown',
            details: `reason=unsupported_scheme url=${img.url} captureRequestId=${captureRequestId || 'none'}`
          });
          return res.status(400).json({ error: 'Image URLs must use HTTP(S)' });
        }
        if (!img.url.startsWith('https://')) {
          console.warn('Receipt capture rejected non-HTTPS image URL', {
            url: img.url,
            captureRequestId
          });
          await recordAuditLog({
            type: 'receipt_capture_reject',
            actorId: username || 'unknown',
            details: `reason=non_https url=${img.url} captureRequestId=${captureRequestId || 'none'}`
          });
          return res.status(400).json({ error: 'Image URLs must use HTTPS' });
        }

        const isCloudinaryHost = isCloudinaryUrl(img.url);
        if (!isCloudinaryHost) {
          if (!hasCloudinary) {
            return res.status(503).json({ error: 'Cloudinary not configured for receipt image uploads' });
          }
          try {
            const dataUrl = await fetchExternalReceiptImage(img.url);
            const uploaded = await handleReceiptImageUpload(dataUrl);
            normalizedImages.push({
              url: uploaded.url,
              thumbnailUrl: uploaded.thumbnailUrl
            });
          } catch (uploadErr) {
            return res.status(400).json({ error: uploadErr.message || 'Failed to re-upload receipt image' });
          }
        } else {
          // Verify content-type by HEAD request
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const headResp = await fetch(img.url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            const ct = (headResp.headers.get('content-type') || '').toLowerCase();
            if (!isAllowedReceiptMime(ct)) {
              return res.status(400).json({ error: `Unsupported content-type: ${ct || 'unknown'}` });
            }
          } catch (headErr) {
            console.warn('HEAD request failed for image URL:', img.url, headErr.message);
            return res.status(400).json({ error: 'Unable to validate receipt image URL' });
          }

          const thumbnailUrl = img.thumbnailUrl && isCloudinaryUrl(img.thumbnailUrl)
            ? img.thumbnailUrl
            : img.url;
          normalizedImages.push({
            url: img.url,
            thumbnailUrl
          });
        }
      }
    }

    // Create ReceiptCapture record
    const capture = new ReceiptCapture({
      captureRequestId, // For idempotency
      storeId: store?._id?.toString(),
      storeName: store?.name || normalizedStoreName,
      orderId: orderId || undefined,
      images: normalizedImages.map((img, idx) => ({
        url: img.url,
        thumbnailUrl: img.thumbnailUrl || img.url,
        uploadedAt: new Date(),
        sequence: idx + 1
      })),
      status: 'pending_parse',
      createdBy: username || 'unknown',
      createdByUserId: userId || undefined,
      createdByRole: createdByRole || undefined,
      source: source || undefined
    });

    await capture.save();

    // Attempt store matching for receipt proposals (optional, for management review)
    try {
      const matchPayload = store
        ? {
            name: store.name,
            address: store.address,
            phone: store.phone,
            storeType: store.storeType
          }
        : normalizedStoreName
          ? { name: normalizedStoreName }
          : null;
      const matchResult = matchPayload ? await matchStoreCandidate(matchPayload) : null;

      // Create a draft ReceiptParseJob even before parsing with store candidate info
      await transitionReceiptParseJobStatus({
        captureId: capture._id.toString(),
        actor: username || 'unknown',
        status: 'CREATED',
        updates: {
          storeCandidate: {
            name: store?.name || normalizedStoreName || 'Unknown Store',
            address: store?.address || {},
            phone: store?.phone,
            phoneNormalized: normalizePhone(store?.phoneNormalized || store?.phone),
            storeNumber: store?.storeNumber,
            storeType: store?.storeType,
            confidence: matchResult?.confidence || 0,
            storeId: matchResult?.match?._id || undefined
          }
        }
      });
    } catch (matchErr) {
      console.warn('Failed to create ReceiptParseJob with store candidate:', matchErr?.message);
    }

    await recordAuditLog({
      type: 'receipt_capture_create',
      actorId: username || 'unknown',
      details: `store=${store?._id?.toString() || 'none'} storeName=${store?.name || normalizedStoreName || 'unknown'} images=${capture.images.length} capture=${capture._id.toString()}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      imageCount: capture.images.length
    });

  } catch (error) {
    console.error('Error creating receipt capture:', error);
    res.status(500).json({ error: 'Failed to create receipt capture' });
  }
});

/**
 * GET /api/driver/receipt-capture/:captureId
 * Get receipt capture status and parsed items
 */
router.get('/receipt-capture/:captureId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.storeId) {
      const ingestionCheck = await ensureIngestionAllowed(capture.storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error, gate: ingestionCheck.gate });
      }
    }

    res.json({
      ok: true,
      capture: {
        _id: capture._id,
        storeId: capture.storeId,
        storeName: capture.storeName,
        orderId: capture.orderId,
        status: capture.status,
        images: capture.images,
        draftItems: capture.draftItems,
        stats: {
          totalItems: capture.totalItems,
          itemsNeedingReview: capture.itemsNeedingReview,
          itemsConfirmed: capture.itemsConfirmed,
          itemsCommitted: capture.itemsCommitted
        },
        parseError: capture.parseError,
        createdByUserId: capture.createdByUserId,
        createdByRole: capture.createdByRole,
        source: capture.source,
        createdAt: capture.createdAt,
        reviewExpiresAt: capture.reviewExpiresAt
      }
    });

  } catch (error) {
    console.error('Error fetching receipt capture:', error);
    res.status(500).json({ error: 'Failed to fetch receipt capture' });
  }
});

/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
router.post('/receipt-parse', authRequired, async (req, res) => {
  const { captureId } = req.body;
  console.log('[receipt-parse] start', captureId);
  if (!captureId) {
    return res.status(400).json({ error: 'Missing captureId' });
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    return res.status(404).json({ error: 'Receipt capture not found' });
  }

  // Use canonical queue logic
  if (isReceiptQueueEnabled()) {
    const queueHealth = await getReceiptQueueWorkerHealth();
    if (queueHealth.workerOffline) {
      try {
        const parseJob = await executeReceiptParse(captureId, req.user?._id || 'api', { bypassQueue: true });
        const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
        return res.status(202).json({
          ok: true,
          queued: false,
          fallbackSync: true,
          warning: 'Queue enabled, worker offline. Parsed synchronously as fallback.',
          queueHealth,
          job: parseJob,
          autoCommit
        });
      } catch (syncErr) {
        return res.status(503).json({
          error: 'Queue enabled, worker offline. Start receipt worker or disable queue before retrying.',
          queueHealth,
          details: syncErr?.message || 'Synchronous fallback failed'
        });
      }
    }

    try {
      const result = await enqueueReceiptJob('receipt-parse', { captureId, actor: req.user?._id || 'api' });
      if (result.ok) {
        await transitionReceiptParseJobStatus({
          captureId: capture._id.toString(),
          actor: req.user?._id || 'api',
          status: 'QUEUED'
        });
        return res.json({ ok: true, queued: true, jobId: result.jobId, queueHealth });
      } else {
        return res.status(500).json({ error: 'Failed to enqueue receipt parse job', ...result });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to enqueue receipt parse job' });
    }
  }

  // Otherwise, run the parse pipeline directly (synchronous)
  try {
    const parseJob = await executeReceiptParse(captureId, req.user?._id || 'api');
    const autoCommit = await attemptAutoCommit({ parseJob, captureId, user: req.user });
    return res.json({ ok: true, queued: false, job: parseJob, autoCommit });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Receipt parse failed' });
  }
});

/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
router.post('/receipt-parse-frame', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image, storeId } = req.body;
    
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Valid base64 image required' });
    }

    if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    const apiReady = ensureGeminiReady();
    if (!apiReady.ok) {
      return res.status(503).json({ error: apiReady.error });
    }

    // Extract base64 from data URL
    let imageBase64 = image;
    let mimeType = 'image/jpeg';
    
    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageBase64 = match[2];
      }
    }

    // Call Gemini with items extraction prompt
    const prompt = `Extract ALL product line items from this receipt image ONLY. Return ONLY JSON:
[
  {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
  {"receiptName": "LAYS CHIPS", "quantity": 1, "totalPrice": 3.99}
]

Rules: Extract product lines only (skip store, date, tax, total). Return empty [] if unclear. ONLY JSON, no explanation.`;

    let response;
    try {
      const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
      response = await ai.models.generateContent({
        model: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: imageBase64, mimeType } }
            ]
          }
        ],
        generationConfig: { temperature: 0.1 }
      });
    } catch (geminiErr) {
      console.error('Gemini parse error:', geminiErr.message);
      return res.json({ ok: true, items: [] }); // Non-blocking
    }

    const rawText = response?.text?.trim?.() ?? '';
    let items = [];
    
    try {
      const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonText);
      
      if (Array.isArray(parsed)) {
        items = parsed.filter(item => 
          item.receiptName && 
          Number.isFinite(item.quantity) && 
          Number.isFinite(item.totalPrice) &&
          item.totalPrice > 0 &&
          item.quantity > 0
        ).slice(0, 20); // Limit to 20 items per frame
      }
    } catch (e) {
      // Silent fail for parsing
    }

    let storeInventories = [];
    if (storeId) {
      storeInventories = await StoreInventory.find({ storeId })
        .populate('productId')
        .limit(500);
    }

    const enrichedItems = [];
    for (const item of items) {
      const receiptName = String(item.receiptName || '').trim();
      const quantity = Number(item.quantity) || 1;
      const totalPrice = Number(item.totalPrice) || 0;
      const unitPrice = totalPrice / quantity;
      const normalizedName = getReceiptLineNormalizedName(receiptName);
      const tokens = extractTokens(normalizedName);
      const tokenSummary = summarizeTokens(tokens);

      let suggestedProduct = null;
      let matchMethod = 'no_match';
      let matchConfidence = 0;
      let matchedInventory = null;

      if (storeId) {
        const noiseRule = await ReceiptNoiseRule.findOne({
          storeId,
          normalizedName
        });

        if (noiseRule) {
          enrichedItems.push({
            receiptName,
            normalizedName,
            quantity,
            totalPrice,
            unitPrice: Number(unitPrice.toFixed(2)),
            tokens: tokenSummary,
            matchHistory: [],
            suggestedProduct: null,
            matchMethod: 'noise_rule',
            matchConfidence: 1,
            isNoiseRule: true
          });
          continue;
        }
      }


      if (storeId) {
        const alias = await ReceiptNameAlias.findOne({
          storeId,
          normalizedName
        });

        if (alias && alias.confirmedCount > 0) {
          const { effectiveConfidence } = getAliasEffectiveConfidence(alias);
          if (effectiveConfidence >= ALIAS_CONFIDENCE_MATCH_THRESHOLD) {
            const product = await Product.findById(alias.productId);
            if (product) {
              suggestedProduct = {
                id: product._id.toString(),
                name: product.name,
                upc: product.upc,
                sku: product.sku
              };
              matchMethod = 'alias_confirmed';
              matchConfidence = effectiveConfidence;
              matchedInventory = await StoreInventory.findOne({
                storeId,
                productId: product._id
              });
            }
          }
        }

        if (!suggestedProduct && storeInventories.length > 0) {
          const category = classifyCategory(normalizedName);
          let bestScore = 0;
          let bestMatch = null;
          let bestInventory = null;

          for (const inv of storeInventories) {
            if (!inv.productId || !inv.productId.name) continue;
            const matchResult = advancedMatch(receiptName, inv.productId.name);
            const productCategory = classifyCategory(normalizeReceiptName(inv.productId.name));
            if (category !== 'other' && productCategory !== 'other' && category !== productCategory) {
              continue;
            }
            if (matchResult.score > bestScore && matchResult.tokensMatch) {
              bestScore = matchResult.score;
              bestMatch = inv.productId;
              bestInventory = inv;
            }
          }

          if (bestMatch && bestScore >= 0.75) {
            suggestedProduct = {
              id: bestMatch._id.toString(),
              name: bestMatch.name,
              upc: bestMatch.upc,
              sku: bestMatch.sku
            };
            matchConfidence = bestScore;
            matchMethod = bestScore >= 0.9 ? 'fuzzy_high' : 'fuzzy_suggested';
            matchedInventory = bestInventory;
          }
        }
      }

      const matchHistory = matchedInventory ? buildMatchHistory(matchedInventory) : [];
      const priceDelta = matchedInventory
        ? computePriceDelta(unitPrice, matchHistory, matchedInventory.observedPrice)
        : undefined;

      enrichedItems.push({
        receiptName,
        normalizedName,
        quantity,
        totalPrice,
        unitPrice: Number(unitPrice.toFixed(2)),
        tokens: tokenSummary,
        priceDelta,
        matchHistory,
        suggestedProduct,
        matchMethod,
        matchConfidence: matchConfidence > 0 ? matchConfidence : undefined
      });
    }

    res.json({ ok: true, items: enrichedItems });

  } catch (error) {
    console.error('Receipt frame parse error:', error);
    res.json({ ok: true, items: [] });
  }
});

/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
router.post('/receipt-parse-live', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, items } = req.body;
    
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    const isOwner = isOwnerUsername(req.user?.username);
    if (!isOwner && capture.createdBy !== req.user?.username) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Convert live items to draft items for manual UPC binding
    const draftItems = items.map((item, idx) => {
      const normalizedName = getReceiptLineNormalizedName(item.receiptName);
      const tokens = extractTokens(normalizedName);
      return {
        lineIndex: idx,
        receiptName: item.receiptName,
        normalizedName,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        unitPrice: item.totalPrice / item.quantity,
        tokens: summarizeTokens(tokens),
        priceDelta: undefined,
        matchHistory: [],
        suggestedProduct: null,
        matchMethod: 'live_scan',
        matchConfidence: undefined,
        needsReview: false,
        workflowType: 'new_product'
      };
    });

    capture.markParsed(draftItems);
    await capture.save();

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      itemCount: draftItems.length
    });

  } catch (error) {
    console.error('Receipt parse live error:', error);
    res.status(500).json({ error: 'Failed to save items' });
  }
});

/**
 * GET /api/driver/receipt-parse-jobs
 * Fetch receipt parse jobs (used by management review UI)
 */
router.get('/receipt-parse-jobs', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const jobs = await ReceiptParseJob.find(query)
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ ok: true, jobs });
  } catch (error) {
    console.error('Error fetching receipt parse jobs:', error);
    res.status(500).json({ error: 'Failed to fetch parse jobs' });
  }
});

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/approve
 * Approve store candidate from parse job proposal
 */
router.post('/receipt-parse-jobs/:captureId/approve', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const { storeId, storeName, address, phone, storeType, storeNumber } = req.body;
    const username = req.user?.username || 'unknown';

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (!storeId && !storeName) {
      return res.status(400).json({ error: 'storeId or storeName required' });
    }

    let store = null;
    if (storeId) {
      store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    } else if (storeName) {
      store = await Store.findOne({ name: storeName });
      if (!store) {
        store = await Store.create({
          name: storeName,
          address: address || {},
          phone,
          phoneNormalized: normalizePhone(phone),
          storeNumber: normalizeStoreNumber(storeNumber),
          storeType
        });
      }
    }


    capture.storeId = store._id;
    capture.storeName = store.name;
    await capture.save();

    await ReceiptParseJob.findOneAndUpdate(
      { captureId },
      { 'storeCandidate.storeId': store._id, 'storeCandidate.confidence': 1 },
      { new: true }
    );

    // --- UnmappedProduct & PriceObservation logic ---
    // Only run if capture has draftItems
    try {
      const UnmappedProduct = (await import('../models/UnmappedProduct.js')).default;
      const PriceObservation = (await import('../models/PriceObservation.js')).default;
      const draftItems = capture.draftItems || [];
      const now = new Date();
      const rejectedLines = [];
      for (const item of draftItems) {
        const resolution = await resolveReceiptLineProduct({
          line: item,
          normalizedName: item.normalizedName || item.receiptName,
          upc: item.boundUpc || item.upc,
          fallback: 'unmapped'
        });
        const product = resolution.product;
        const normalizedName = resolution.normalizedName;

        if (!product && item.receiptName) {
          // Find or create UnmappedProduct
          let unmapped = await UnmappedProduct.findOne({ storeId: store._id, normalizedName });
          if (!unmapped) {
            unmapped = await UnmappedProduct.create({
              storeId: store._id,
              rawName: item.receiptName,
              normalizedName,
              firstSeenAt: now,
              lastSeenAt: now,
              status: 'NEW'
            });
          } else {
            unmapped.lastSeenAt = now;
            await unmapped.save();
          }
          // Write PriceObservation
          const observation = buildPriceObservationPayload({
            item,
            storeId: store._id,
            receiptCaptureId: capture._id,
            unmappedProductId: unmapped._id,
            observedAt: now
          });
          if (observation.ok) {
            await PriceObservation.create(observation.payload);
          } else {
            rejectedLines.push({ lineIndex: item?.lineIndex, reason: observation.reason });
          }
        } else if (product) {
          // Write PriceObservation for resolved product
          const observation = buildPriceObservationPayload({
            item,
            storeId: store._id,
            receiptCaptureId: capture._id,
            productId: product._id,
            observedAt: now
          });
          if (observation.ok) {
            await PriceObservation.create(observation.payload);
          } else {
            rejectedLines.push({ lineIndex: item?.lineIndex, reason: observation.reason });
          }
        } else {
          rejectedLines.push({ lineIndex: item?.lineIndex, reason: 'missing_mapping' });
        }
      }
      if (rejectedLines.length > 0) {
        const reasonCounts = rejectedLines.reduce((acc, entry) => {
          const key = entry.reason || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        await recordAuditLog({
          type: 'receipt_observation_rejected_lines',
          actorId: username,
          details: `captureId=${captureId} route=receipt-prices rejected=${rejectedLines.length} reasons=${JSON.stringify(reasonCounts)}`
        });
      }
    } catch (err) {
      console.error('UnmappedProduct/PriceObservation error:', err);
    }
    // --- End UnmappedProduct logic ---

    await recordAuditLog({
      type: 'receipt_store_confirm',
      actorId: username,
      details: `captureId=${captureId} storeId=${store._id}`
    });

    res.json({ ok: true, store });

  } catch (error) {
    console.error('Error approving store candidate:', error);
    res.status(500).json({ error: 'Failed to approve store candidate' });
  }
});

/**
 * POST /api/driver/receipt-parse-jobs/:captureId/reject
 * Reject store candidate (keeps capture store null)
 */
router.post('/receipt-parse-jobs/:captureId/reject', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username || 'unknown';

    await transitionReceiptParseJobStatus({
      captureId,
      actor: username,
      status: 'REJECTED'
    });

    await recordAuditLog({
      type: 'receipt_store_reject',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error rejecting store candidate:', error);
    res.status(500).json({ error: 'Failed to reject store candidate' });
  }
});

/**
 * GET /api/driver/receipt-items/:storeId
 * Fetch receipt items for a store (for search / alias management)
 */
router.get('/receipt-items/:storeId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.params;
    const { q } = req.query;
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    const query = {
      storeId
    };

    if (q) {
      query.normalizedName = { $regex: sanitizeSearch(q), $options: 'i' };
    }

    const aliases = await ReceiptNameAlias.find(query)
      .sort({ lastSeenAt: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching receipt items:', error);
    res.status(500).json({ error: 'Failed to fetch receipt items' });
  }
});

/**
 * GET /api/driver/receipt-item-history
 * Fetch price history for a receipt item
 */
router.get('/receipt-item-history', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, productId } = req.query;
    if (!storeId || !productId) {
      return res.status(400).json({ error: 'storeId and productId required' });
    }

    const inventory = await StoreInventory.findOne({
      storeId,
      productId
    }).lean();

    if (!inventory) {
      return res.json({ ok: true, history: [] });
    }

    res.json({ ok: true, history: inventory.priceHistory || [] });
  } catch (error) {
    console.error('Error fetching receipt item history:', error);
    res.status(500).json({ error: 'Failed to fetch receipt item history' });
  }
});

/**
 * POST /api/driver/receipt-price-update-manual
 * Manual price update (bypass receipt)
 */
router.post('/receipt-price-update-manual', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, productId, price, priceType } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !productId) {
      return res.status(400).json({ error: 'storeId and productId required' });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const observedPrice = Number(price);
    if (!Number.isFinite(observedPrice) || observedPrice <= 0) {
      return res.status(400).json({ error: 'Valid price required' });
    }

    await StoreInventory.findOneAndUpdate(
      { storeId, productId },
      {
        $set: {
          observedPrice,
          observedAt: new Date()
        },
        $push: {
          priceHistory: {
            price: observedPrice,
            observedAt: new Date(),
            matchMethod: 'manual',
            matchConfidence: 1.0,
            priceType: priceType || 'manual',
            promoDetected: false,
            workflowType: 'update_price'
          }
        }
      },
      { new: true, upsert: true }
    );

    product.price = observedPrice;
    await product.save();

    await recordAuditLog({
      type: 'receipt_price_update_manual',
      actorId: username,
      details: `storeId=${storeId} productId=${productId} price=${observedPrice}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating receipt price manually:', error);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

/**
 * GET /api/driver/receipt-captures-summary
 * Summary counts for receipt captures by status
 */
router.get('/receipt-captures-summary', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    const query = storeId ? { storeId } : {};

    const total = await ReceiptCapture.countDocuments(query);
    const pendingParse = await ReceiptCapture.countDocuments({ ...query, status: 'pending_parse' });
    const parsed = await ReceiptCapture.countDocuments({ ...query, status: 'parsed' });
    const reviewComplete = await ReceiptCapture.countDocuments({ ...query, status: 'review_complete' });
    const committed = await ReceiptCapture.countDocuments({ ...query, status: 'committed' });
    const failed = await ReceiptCapture.countDocuments({ ...query, status: 'failed' });

    res.json({
      ok: true,
      summary: {
        total,
        pendingParse,
        parsed,
        reviewComplete,
        committed,
        failed
      }
    });
  } catch (error) {
    console.error('Error fetching receipt capture summary:', error);
    res.status(500).json({ error: 'Failed to fetch receipt capture summary' });
  }
});

/**
 * POST /api/driver/receipt-refresh
 * Reprocess failed receipt captures for a store
 */
router.post('/receipt-refresh', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    const failed = await ReceiptCapture.find({ storeId, status: 'failed' });
    if (failed.length === 0) {
      return res.json({ ok: true, message: 'No failed receipts to refresh' });
    }

    for (const capture of failed) {
      capture.status = 'pending_parse';
      capture.parseError = null;
      await capture.save();
    }

    await recordAuditLog({
      type: 'receipt_refresh',
      actorId: username,
      details: `storeId=${storeId} count=${failed.length}`
    });

    res.json({ ok: true, refreshed: failed.length });
  } catch (error) {
    console.error('Error refreshing receipts:', error);
    res.status(500).json({ error: 'Failed to refresh receipts' });
  }
});

/**
 * POST /api/driver/receipt-lock
 * Lock receipt capture for a period (prevents edits)
 */
router.post('/receipt-lock', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, days = DEFAULT_PRICE_LOCK_DAYS } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    capture.reviewExpiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
    await capture.save();

    await recordAuditLog({
      type: 'receipt_lock',
      actorId: username,
      details: `captureId=${captureId} days=${days}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error locking receipt capture:', error);
    res.status(500).json({ error: 'Failed to lock receipt capture' });
  }
});

/**
 * POST /api/driver/receipt-unlock
 * Unlock receipt capture (remove lock)
 */
router.post('/receipt-unlock', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    capture.reviewExpiresAt = null;
    await capture.save();

    await recordAuditLog({
      type: 'receipt_unlock',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error unlocking receipt capture:', error);
    res.status(500).json({ error: 'Failed to unlock receipt capture' });
  }
});

/**
 * GET /api/driver/receipt-store-summary
 * Summary of receipt captures grouped by store
 */
router.get('/receipt-store-summary', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const summary = await ReceiptCapture.aggregate([
      {
        $group: {
          _id: '$storeId',
          storeName: { $first: '$storeName' },
          totalCaptures: { $sum: 1 },
          pendingParse: { $sum: { $cond: [{ $eq: ['$status', 'pending_parse'] }, 1, 0] } },
          parsed: { $sum: { $cond: [{ $eq: ['$status', 'parsed'] }, 1, 0] } },
          reviewComplete: { $sum: { $cond: [{ $eq: ['$status', 'review_complete'] }, 1, 0] } },
          committed: { $sum: { $cond: [{ $eq: ['$status', 'committed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      },
      {
        $sort: { totalCaptures: -1 }
      }
    ]);

    res.json({ ok: true, summary });
  } catch (error) {
    console.error('Error fetching receipt store summary:', error);
    res.status(500).json({ error: 'Failed to fetch store summary' });
  }
});

/**
 * POST /api/driver/receipt-fix-upc
 * Update receipt item bound UPC (used for corrections)
 */
router.post('/receipt-fix-upc', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, lineIndex, upc } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }
    if (!upc || !validateUPC(upc)) {
      return res.status(400).json({ error: 'Valid UPC required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
    if (!draftItem) {
      return res.status(404).json({ error: 'Draft item not found' });
    }

    draftItem.boundUpc = upc;
    await capture.save();

    await recordAuditLog({
      type: 'receipt_fix_upc',
      actorId: username,
      details: `captureId=${captureId} lineIndex=${lineIndex} upc=${upc}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error fixing receipt UPC:', error);
    res.status(500).json({ error: 'Failed to fix receipt UPC' });
  }
});

/**
 * POST /api/driver/receipt-fix-price
 * Update receipt item price (used for corrections)
 */
router.post('/receipt-fix-price', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, lineIndex, totalPrice, quantity } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }
    const validation = validatePriceQuantity(totalPrice, quantity);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    const draftItem = capture.draftItems.find(item => item.lineIndex === lineIndex);
    if (!draftItem) {
      return res.status(404).json({ error: 'Draft item not found' });
    }

    draftItem.totalPrice = totalPrice;
    draftItem.quantity = quantity;
    draftItem.unitPrice = totalPrice / quantity;
    draftItem.needsReview = false;
    draftItem.reviewReason = null;
    await capture.save();

    await recordAuditLog({
      type: 'receipt_fix_price',
      actorId: username,
      details: `captureId=${captureId} lineIndex=${lineIndex} price=${totalPrice}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error fixing receipt price:', error);
    res.status(500).json({ error: 'Failed to fix receipt price' });
  }
});

/**
 * POST /api/driver/receipt-reset-review
 * Reset receipt review status to parsed (reopen review)
 */
router.post('/receipt-reset-review', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    capture.status = 'parsed';
    capture.reviewExpiresAt = null;
    await capture.save();

    await recordAuditLog({
      type: 'receipt_reset_review',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error resetting receipt review:', error);
    res.status(500).json({ error: 'Failed to reset review' });
  }
});

/**
 * GET /api/driver/receipt-capture/:captureId/items
 * Fetch receipt capture items for review (convenience route)
 */
router.get('/receipt-capture/:captureId/items', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId).lean();
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    let draftItems = Array.isArray(capture.draftItems) ? capture.draftItems : [];
    if (draftItems.length === 0) {
      const parseJob = await ReceiptParseJob.findOne({ captureId })
        .sort({ createdAt: -1 })
        .select('structured.draftItems')
        .lean();

      if (Array.isArray(parseJob?.structured?.draftItems) && parseJob.structured.draftItems.length > 0) {
        draftItems = parseJob.structured.draftItems;
      }
    }

    res.json({
      ok: true,
      items: mapReceiptItemsForResponse(draftItems)
    });
  } catch (error) {
    console.error('Error fetching receipt items:', error);
    res.status(500).json({ error: 'Failed to fetch receipt items' });
  }
});

/**
 * POST /api/driver/receipt-capture/:captureId/expire
 * Manually expire a receipt capture (admin only)
 */
router.post('/receipt-capture/:captureId/expire', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username || 'unknown';
    const isOwner = isOwnerUsername(username);
    if (!isOwner) {
      return res.status(403).json({ error: 'Owner access required' });
    }

    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    await ReceiptCapture.findByIdAndUpdate(captureId, {
      reviewExpiresAt: new Date(Date.now() - 1000)
    });

    await recordAuditLog({
      type: 'receipt_capture_expire',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error expiring receipt capture:', error);
    res.status(500).json({ error: 'Failed to expire receipt capture' });
  }
});

/**
 * GET /api/driver/receipt-store-aliases
 * Fetch aliases for store (shortcut)
 */
router.get('/receipt-store-aliases', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }

    const aliases = await ReceiptNameAlias.find({ storeId })
      .sort({ lastConfirmedAt: -1 })
      .limit(100)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching store aliases:', error);
    res.status(500).json({ error: 'Failed to fetch store aliases' });
  }
});

/**
 * GET /api/driver/receipt-alias-history
 * Fetch alias history (for admin tools)
 */
router.get('/receipt-alias-history', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, normalizedName } = req.query;
    if (!storeId || !normalizedName) {
      return res.status(400).json({ error: 'storeId and normalizedName required' });
    }

    const alias = await ReceiptNameAlias.findOne({ storeId, normalizedName }).lean();
    if (!alias) {
      return res.json({ ok: true, alias: null });
    }

    res.json({ ok: true, alias });
  } catch (error) {
    console.error('Error fetching alias history:', error);
    res.status(500).json({ error: 'Failed to fetch alias history' });
  }
});

/**
 * GET /api/driver/receipt-health
 * Debug route for receipt system health
 */
router.get('/receipt-health', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const requestedStoreId =
      typeof req.query?.storeId === 'string' && req.query.storeId.trim().length > 0
        ? req.query.storeId.trim()
        : null;
    const ingestionGate = await getReceiptIngestionGateState({ storeId: requestedStoreId });
    const staleJobCheck = await flushStaleReceiptJobs({ dryRun: true });
    const staleReceiptJobs = staleJobCheck.ok
      ? {
          totalJobs: staleJobCheck.totalJobs,
          candidates: staleJobCheck.candidates,
          stale: staleJobCheck.stale,
          missingCaptureIdsCount: staleJobCheck.missingCaptureIds.length
        }
      : { ok: false, reason: staleJobCheck.reason };
    const sevenDayWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ocrSummarySamples = await ReceiptCapture.find({
      lastParseAt: { $gte: sevenDayWindowStart },
      'parseMetrics.providerUsed': { $exists: true, $ne: null }
    })
      .select('status parseMetrics.providerAttempted parseMetrics.providerUsed parseMetrics.fallbackReason')
      .lean();
    const ocrProviderSummary7d = computeReceiptOcrSuccessSummary(ocrSummarySamples);
    res.json({
      ok: true,
      cloudinary: hasCloudinary,
      queueEnabled: isReceiptQueueEnabled(),
      queueStatus: await getReceiptQueueWorkerHealth(),
      learningEnabled: isPricingLearningEnabled(),
      ingestionGate,
      staleReceiptJobs,
      ocrProviderSummary7d
    });
  } catch (error) {
    console.error('Error fetching receipt health:', error);
    res.status(500).json({ error: 'Failed to fetch receipt health' });
  }
});

/**
 * POST /api/driver/receipt-confirm-match
 * Confirms and binds a receipt item to a product SKU during review phase
 * Creates/updates ReceiptNameAlias for future matching
 */
router.post('/receipt-confirm-match', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { receiptName, sku, storeId } = req.body;
    
    // Validate inputs
    if (!receiptName || !sku) {
      return res.status(400).json({ error: 'receiptName and sku are required' });
    }

    // Find the product by SKU
    const product = await Product.findOne({ sku }).lean();
    if (!product) {
      return res.status(404).json({ error: `Product with SKU ${sku} not found` });
    }

    // Validate storeId if provided
    let store = null;
    if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({ error: 'Invalid storeId' });
      }
      store = await Store.findById(storeId).lean();
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    }

    // Normalize receipt name
    const normalizedName = getReceiptLineNormalizedName(receiptName);

    // Create or update a receipt name alias (binding for future matches)
    const updatedAlias = await ReceiptNameAlias.findOneAndUpdate(
      {
        normalizedName,
        storeId: storeId || { $exists: false }
      },
      {
        normalizedName,
        storeId: storeId || null,
        productId: product._id,
        upc: product.upc,
        confirmedCount: { $inc: 1 },
        lastConfirmedAt: new Date(),
        lastSeenAt: new Date()
      },
      { new: true, upsert: true }
    );

    // Record audit log
    await recordAuditLog({
      type: 'RECEIPT_ALIAS_CONFIRMED',
      actorId: req.user?.username || req.user?.id,
      details: `Confirmed receipt "${receiptName}" → SKU ${sku}${storeId ? ` @ Store ${storeId}` : ''}`
    });

    res.json({ 
      ok: true, 
      message: 'Receipt item match confirmed',
      receiptName: normalizedName,
      sku,
      productId: product._id,
      storeId: storeId || null,
      aliasId: updatedAlias._id
    });
  } catch (error) {
    console.error('Receipt confirm match error:', error);
    res.status(500).json({ error: 'Failed to confirm match' });
  }
});

export default router;
