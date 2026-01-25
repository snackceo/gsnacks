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
import { matchStoreCandidate, shouldAutoCreateStore } from '../utils/storeMatcher.js';
import { isPricingLearningEnabled, receiptIngestionMode, receiptStoreAllowlist, receiptDailyCap } from '../utils/featureFlags.js';
import { enqueueReceiptJob, isReceiptQueueEnabled } from '../queues/receiptQueue.js';

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

const ensureIngestionAllowed = async storeId => {
  if (receiptIngestionMode() === 'disabled') {
    return { ok: false, status: 503, error: 'Receipt ingestion disabled during rollout' };
  }
  if (!isStoreAllowlisted(storeId)) {
    return { ok: false, status: 403, error: 'Store not allowlisted for ingestion during rollout' };
  }

  const cap = receiptDailyCap();
  if (cap) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const countToday = await ReceiptCapture.countDocuments({
      storeId,
      createdAt: { $gte: startOfDay }
    });
    if (countToday >= cap) {
      return { ok: false, status: 429, error: 'Receipt ingestion daily cap reached' };
    }
  }

  return { ok: true };
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
      : 'CREATE_PRODUCT';
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
    captureId: capture._id.toString(),
    status,
    rawText,
    structured: { draftItems },
    geminiOutput: geminiOutput || undefined,
    storeCandidate,
    items,
    warnings: draftItems.filter(it => it.needsReview && it.reviewReason).map(it => it.reviewReason)
  };

  const job = await ReceiptParseJob.findOneAndUpdate(
    { captureId: payload.captureId },
    payload,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return job;
}

// Extract base64 and mime from data URL
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

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
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  
  if (!allowedMimes.includes(mime)) {
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

const normalizeReceiptName = name => {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
};

const tokenizeReceiptName = name => {
  return normalizeReceiptName(name).split(' ').filter(Boolean);
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
  return items.map(item => ({
    lineIndex: item.lineIndex,
    receiptName: item.receiptName,
    normalizedName: item.normalizedName,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    unitPrice: item.unitPrice,
    tokens: item.tokens,
    priceDelta: item.priceDelta,
    matchHistory: item.matchHistory,
    suggestedProduct: item.suggestedProduct,
    matchMethod: item.matchMethod,
    matchConfidence: item.matchConfidence,
    needsReview: item.needsReview,
    reviewReason: item.reviewReason,
    boundProductId: item.boundProductId,
    boundUpc: item.boundUpc,
    confirmedAt: item.confirmedAt,
    confirmedBy: item.confirmedBy,
    promoDetected: item.promoDetected,
    priceType: item.priceType,
    workflowType: item.workflowType
  }));
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
    const { storeName, address, phone, storeType } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeName) {
      return res.status(400).json({ error: 'Store name required' });
    }

    const stored = await Store.findOne({ name: storeName }).lean();
    if (stored) {
      return res.json({ ok: true, existing: stored });
    }

    const allowCreate = shouldAutoCreateStore();
    if (!allowCreate) {
      return res.status(403).json({ error: 'Auto store creation disabled' });
    }

    const store = await Store.create({
      name: storeName,
      address,
      phone,
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
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout' });
    }

    if (storeId) {
      const ingestionCheck = await ensureIngestionAllowed(storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error });
      }
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > 5 * 1024 * 1024) {
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
    if (typeof image === 'string' && image.length > 5 * 1024 * 1024) {
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
      return res.status(503).json({ error: 'Receipt ingestion disabled during rollout' });
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
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error });
      }
    }

    // Validate image URLs and sizes
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
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (!allowedMimes.includes(mime.toLowerCase())) {
          return res.status(400).json({ error: `Unsupported image type: ${mime || 'unknown'}` });
        }

        if (!isAllowedImageDataUrl(img.url)) {
          return res.status(400).json({ error: 'Image content failed validation (corrupt or unsupported)' });
        }
      } else {
        // Non-data URLs must be valid image URLs (HTTPS, allowed hosts, content-type check)
        if (!img.url.startsWith('https://')) {
          return res.status(400).json({ error: 'Image URLs must use HTTPS' });
        }
        
        const urlObj = new URL(img.url);
        const allowedHosts = ['cloudinary.com', 'res.cloudinary.com'];
        const isAllowedHost = allowedHosts.some(host => urlObj.hostname?.includes(host));
        if (!isAllowedHost) {
          return res.status(400).json({ error: 'Only Cloudinary image URLs are allowed' });
        }
        
        // Verify content-type by HEAD request
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const headResp = await fetch(img.url, { method: 'HEAD', signal: controller.signal });
          clearTimeout(timeoutId);
          const ct = (headResp.headers.get('content-type') || '').toLowerCase();
          const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
          if (!allowedMimes.some(m => ct.includes(m))) {
            return res.status(400).json({ error: `Unsupported content-type: ${ct}` });
          }
        } catch (headErr) {
          console.warn('HEAD request failed for image URL:', img.url, headErr.message);
          // Don't fail entirely, but log for investigation
        }
      }
    }

    // Create ReceiptCapture record
    const capture = new ReceiptCapture({
      captureRequestId, // For idempotency
      storeId: store?._id?.toString(),
      storeName: store?.name || normalizedStoreName,
      orderId: orderId || undefined,
      images: images.map((img, idx) => ({
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
      await ReceiptParseJob.findOneAndUpdate(
        { captureId: capture._id.toString() },
        {
          captureId: capture._id.toString(),
          status: 'QUEUED',
          storeCandidate: {
            name: store?.name || normalizedStoreName || 'Unknown Store',
            address: store?.address || {},
            phone: store?.phone,
            storeType: store?.storeType,
            confidence: matchResult?.confidence || 0,
            storeId: matchResult?.match?._id || undefined
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
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
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error });
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
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    // Authorize: only management or driver can parse for their stores
    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const isOwner = isOwnerRole || isOwnerUsername(req.user?.username);
    const isDriver = isDriverUsername(req.user?.username);
    const isManagement = isOwner || isManagerRole;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to parse receipts' });
    }

    // Enforce driver-store binding
    if (capture.storeId && isDriver && !driverCanAccessStore(req.user?.username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    if (capture.status !== 'pending_parse' && capture.status !== 'failed') {
      return res.status(400).json({ error: `Cannot parse receipt with status: ${capture.status}` });
    }

    if (capture.storeId) {
      const ingestionCheck = await ensureIngestionAllowed(capture.storeId);
      if (!ingestionCheck.ok) {
        return res.status(ingestionCheck.status).json({ error: ingestionCheck.error });
      }
    }

    const queueEnabled = isReceiptQueueEnabled();
    const learningOn = isPricingLearningEnabled();

    if (!learningOn && !queueEnabled) {
      return res.status(503).json({ error: 'Pricing learning disabled and queue not configured' });
    }

    if (queueEnabled) {
      capture.status = 'pending_parse';
      capture.parseError = null;
      await capture.save();

      await ReceiptParseJob.findOneAndUpdate(
        { captureId: capture._id.toString() },
        {
          captureId: capture._id.toString(),
          status: 'QUEUED'
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      const jobId = `receipt-parse:${capture._id.toString()}`;
      const enqueue = await enqueueReceiptJob(
        'receipt-parse',
        {
          captureId: capture._id.toString(),
          actor: req.user?.username || 'unknown'
        },
        { jobId }
      );

      if (!enqueue.ok) {
        return res.status(503).json({ error: 'Queue unavailable for receipt parsing' });
      }

      return res.status(202).json({ ok: true, queued: true, jobId });
    }

    // Check Gemini API availability
    const apiReady = ensureGeminiReady();
    if (!apiReady.ok) {
      capture.status = 'failed';
      capture.parseError = apiReady.error;
      await capture.save();
      return res.status(503).json({ error: apiReady.error });
    }

    // Use transaction for atomic parse
    const parseSession = await mongoose.startSession();
    parseSession.startTransaction();

    try {
      // Mark as parsing (atomic update to prevent race conditions)
      const updated = await ReceiptCapture.findByIdAndUpdate(
        captureId,
        { status: 'parsing', startedParsingAt: new Date() },
        { new: true, session: parseSession }
      );
      if (!updated) {
        await parseSession.abortTransaction();
        await parseSession.endSession();
        return res.status(404).json({ error: 'Receipt capture not found' });
      }

      // Download and parse receipt images
      const draftItems = [];
      const geminiOutput = { rawTextByImage: [], parsedByImage: [] };
      let storeCandidateOverride = null;
    
    for (const image of capture.images) {
      try {
        // Fetch image data with timeout (10 seconds) and retry (2 attempts)
        let imageResponse = null;
        let fetchError = null;
        const FETCH_TIMEOUT_MS = 10000;
        const MAX_FETCH_RETRIES = 2;
        
        // Fetch the image to pass to Gemini
        // For Cloudinary URLs, pass URL directly to Gemini
        // For data URLs, convert to base64
        let geminiImageContent;
        
        if (image.url.startsWith('https://') && image.url.includes('cloudinary')) {
          // Cloudinary URL: send URL directly (preferred)
          console.log(`Using Cloudinary URL for Gemini: ${image.url.substring(0, 60)}...`);
          geminiImageContent = {
            url: image.url
          };
        } else if (image.url.startsWith('data:')) {
          // Data URL: extract base64
          const match = image.url.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) {
            console.warn('Invalid data URL format for image:', image.sequence);
            continue;
          }
          const mimeType = match[1];
          const base64Data = match[2];
          geminiImageContent = {
            inline_data: {
              data: base64Data,
              mime_type: mimeType
            }
          };
        } else if (image.url.startsWith('https://')) {
          // HTTPS URL (but not Cloudinary): fetch and convert to base64
          console.log(`Fetching image for Gemini: ${image.url.substring(0, 60)}...`);
          let imageResponse;
          let fetchError;
          
          for (let retry = 0; retry < MAX_FETCH_RETRIES; retry++) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
              imageResponse = await fetch(image.url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (imageResponse.ok) break;
              fetchError = new Error(`HTTP ${imageResponse.status}`);
            } catch (err) {
              fetchError = err;
              if (retry < MAX_FETCH_RETRIES - 1) {
                console.warn(`Fetch retry ${retry + 1}/${MAX_FETCH_RETRIES - 1} for image:`, image.url, err.message);
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retry))); // Exponential backoff
              }
            }
          }
          
          if (!imageResponse?.ok) {
            console.error(`Failed to fetch image after ${MAX_FETCH_RETRIES} attempts:`, image.url, fetchError?.message);
            continue;
          }
          
          const imageBuffer = await imageResponse.arrayBuffer();
          const imageBase64 = Buffer.from(imageBuffer).toString('base64');
          const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
          
          geminiImageContent = {
            inline_data: {
              data: imageBase64,
              mime_type: mimeType
            }
          };
        } else {
          console.warn('Unsupported image URL format:', image.url);
          continue;
        }

        // Gemini prompt for receipt parsing
        // Sanitized Gemini prompt (no user input injection)
        const prompt = `You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE ADDRESS if visible at the top or bottom of receipt. Return it as:
"address": "123 Main St, City, ST 12345"  (or null if not visible)

THEN, extract ALL line items with prices. Return ONLY valid JSON format:
{
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store address if visible (street, city, state, zip)
2. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment, instructions)
3. Use exact product names from receipt
4. For multi-buy items, calculate quantity * unit price = totalPrice
5. Skip discounts, coupons, tax lines
6. Return empty array [] for items if none found
7. Return ONLY valid JSON, no markdown, no explanation`;

        // Call Gemini Vision API with error handling
        let response;
        try {
          const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
          response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp',
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  geminiImageContent
                ]
              }
            ],
            generationConfig: { 
              temperature: 0.1,
              topP: 0.8,
              topK: 10
            }
          });
        } catch (geminiErr) {
          // Distinguish transient vs permanent Gemini errors
          const isTransient = geminiErr?.message?.includes('429') || geminiErr?.message?.includes('timeout') || geminiErr?.code === 'ECONNRESET';
          const severity = isTransient ? 'warn' : 'error';
          console[severity](`Gemini API error (${image.sequence}):`, geminiErr?.message);
          
          // For rate limits, mark capture as requires_retry instead of failed
          if (isTransient) {
            capture.status = 'requires_retry';
            capture.parseError = `Gemini rate limit / timeout (image ${image.sequence})`;
            await capture.save();
            return res.status(503).json({ error: 'Gemini service overloaded. Retry in 30s.' });
          }
          continue; // Skip this image for permanent errors
        }

        const rawText = response?.text?.trim?.() ?? '';
        if (rawText) {
          geminiOutput.rawTextByImage.push({ sequence: image.sequence, text: rawText });
        }
        if (!rawText) {
          console.warn('No response from Gemini for image:', image.sequence);
          continue;
        }

        // Parse JSON response
        let parsedData = {};
        let extractedItems = [];
        let extractedAddress = null;
        
        try {
          // Remove markdown code blocks if present
          const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsedData = JSON.parse(jsonText);
          
          // Extract address if present
          if (parsedData.address && typeof parsedData.address === 'string') {
            extractedAddress = parsedData.address.trim();
          }
          
          // Extract items
          extractedItems = Array.isArray(parsedData.items) ? parsedData.items : 
                          Array.isArray(parsedData) ? parsedData : [];
          
          if (!Array.isArray(extractedItems)) {
            console.warn('Gemini response items is not an array:', jsonText);
            extractedItems = [];
          }
        } catch (parseError) {
          console.error('Failed to parse Gemini JSON:', parseError.message);
          continue;
        }

        // Track store candidate override based on address
        if (extractedAddress) {
          storeCandidateOverride = {
            address: {
              formatted: extractedAddress
            },
            confidence: 0.2
          };
        }

        for (const item of extractedItems) {
          const receiptName = String(item.receiptName || '').trim();
          if (!receiptName) continue;
          
          const quantity = Number(item.quantity) || 1;
          const totalPrice = Number(item.totalPrice) || 0;
          const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;
          
          if (!Number.isFinite(totalPrice) || totalPrice <= 0) continue;
          
          const normalizedName = normalizeReceiptName(receiptName);
          const tokens = extractTokens(normalizedName);
          const tokenSummary = summarizeTokens(tokens);
          const category = classifyCategory(normalizedName);
          const promoDetected = detectPromo(receiptName);
          const priceType = promoDetected ? 'promo' : 'unknown';
          
          // Build draft item skeleton
          const draftItem = {
            lineIndex: draftItems.length,
            receiptName,
            normalizedName,
            quantity,
            totalPrice,
            unitPrice: Number(unitPrice.toFixed(2)),
            tokens: tokenSummary,
            matchHistory: [],
            matchMethod: 'none',
            matchConfidence: 0,
            needsReview: true,
            reviewReason: 'no_match',
            promoDetected,
            priceType,
            workflowType: null
          };
          
          // Try to auto-match product using store inventory and aliases
          if (capture.storeId) {
            const alias = await ReceiptNameAlias.findOne({
              storeId: capture.storeId,
              normalizedName
            });
            
            if (alias && alias.confirmedCount > 0) {
              const { effectiveConfidence } = getAliasEffectiveConfidence(alias);
              if (effectiveConfidence >= ALIAS_CONFIDENCE_MATCH_THRESHOLD) {
                const product = await Product.findById(alias.productId);
                if (product) {
                  draftItem.suggestedProduct = {
                    id: product._id,
                    name: product.name,
                    upc: product.upc,
                    sku: product.sku
                  };
                  draftItem.matchMethod = 'alias_confirmed';
                  draftItem.matchConfidence = effectiveConfidence;
                  draftItem.needsReview = false;
                  draftItem.reviewReason = null;
                  draftItem.workflowType = 'update_price';
                }
              }
            }
          }
          
          // If still no match, try fuzzy matching against store inventory
          if (!draftItem.suggestedProduct && capture.storeId) {
            const inventory = await StoreInventory.find({ storeId: capture.storeId })
              .populate('productId', 'name sku upc')
              .limit(500);
            
            let bestScore = 0;
            let bestProduct = null;
            let bestInventory = null;
            
            for (const inv of inventory) {
              if (!inv.productId?.name) continue;
              const matchResult = advancedMatch(receiptName, inv.productId.name);
              const productCategory = classifyCategory(normalizeReceiptName(inv.productId.name));
              if (category !== 'other' && productCategory !== 'other' && category !== productCategory) {
                continue;
              }
              if (matchResult.score > bestScore && matchResult.tokensMatch) {
                bestScore = matchResult.score;
                bestProduct = inv.productId;
                bestInventory = inv;
              }
            }
            
            if (bestProduct && bestScore >= 0.75) {
              draftItem.suggestedProduct = {
                id: bestProduct._id,
                name: bestProduct.name,
                upc: bestProduct.upc,
                sku: bestProduct.sku
              };
              draftItem.matchMethod = bestScore >= 0.9 ? 'fuzzy_high' : 'fuzzy_suggested';
              draftItem.matchConfidence = bestScore;
              draftItem.needsReview = bestScore < 0.9;
              draftItem.reviewReason = bestScore < 0.9 ? 'low_confidence' : null;
              
              const matchHistory = bestInventory ? buildMatchHistory(bestInventory) : [];
              const priceDelta = bestInventory
                ? computePriceDelta(unitPrice, matchHistory, bestInventory.observedPrice)
                : undefined;
              
              if (priceDelta?.flag) {
                draftItem.priceDelta = priceDelta;
                draftItem.needsReview = true;
                draftItem.reviewReason = 'large_price_change';
              }
              
              draftItem.matchHistory = matchHistory;
              draftItem.workflowType = 'update_price';
            }
          }
          
          // If no match at all, mark for product creation
          if (!draftItem.suggestedProduct) {
            draftItem.needsReview = true;
            draftItem.reviewReason = 'no_match';
            draftItem.workflowType = 'new_product';
          }
          
          draftItems.push(draftItem);
        }
      } catch (imageError) {
        console.error('Error processing receipt image:', imageError);
        continue;
      }
    }

      // Mark as parsed with extracted items (within transaction)
      capture.markParsed(draftItems);
      capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
      await capture.save({ session: parseSession });

      // Commit transaction
      await parseSession.commitTransaction();

      try {
        await upsertReceiptParseJobFromDraft({
          capture,
          draftItems,
          rawText: null,
          geminiOutput,
          storeCandidateOverride
        });
      } catch (jobErr) {
        console.warn('Failed to upsert ReceiptParseJob proposal:', jobErr?.message);
      }

      await recordAuditLog({
        type: 'receipt_parse',
        actorId: req.user?.username || 'unknown',
        details: `capture=${capture._id.toString()} items=${draftItems.length} review=${draftItems.filter(i => i.needsReview).length}`
      });

      res.json({
        ok: true,
        captureId: capture._id.toString(),
        status: capture.status,
        itemCount: draftItems.length,
        itemsNeedingReview: draftItems.filter(i => i.needsReview).length,
        message: 'Receipt parsed successfully'
      });
    } catch (error) {
      await parseSession.abortTransaction();
      console.error('Error parsing receipt:', error);
      
      // Mark as failed
      try {
        const capture = await ReceiptCapture.findByIdAndUpdate(
          captureId,
          { status: 'failed', parseError: error.message },
          { new: true }
        );
      } catch (updateError) {
        console.error('Failed to update capture status:', updateError);
      }
      
      res.status(500).json({ error: 'Failed to parse receipt' });
    } finally {
      await parseSession.endSession();
    }
  } catch (error) {
    console.error('Error in receipt-parse route:', error);
    res.status(500).json({ error: 'Failed to parse receipt' });
  }
});

/**
 * POST /api/driver/receipt-confirm-item
 * Confirm a draft item binding (management scanner workflow)
 * Idempotent: calling twice with same params is safe
 */
router.post('/receipt-confirm-item', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, lineIndex, productId, upc } = req.body;
    const username = req.user?.username;

    // Validation
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }
    if (lineIndex === undefined || lineIndex < 0) {
      return res.status(400).json({ error: 'Valid lineIndex required' });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Valid productId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status !== 'parsed' && capture.status !== 'review_complete') {
      return res.status(400).json({ error: `Cannot confirm items with status: ${capture.status}` });
    }

    // Enforce driver-store binding
    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const isOwner = isOwnerRole || isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    const isManagement = isOwner || isManagerRole;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to confirm receipts' });
    }
    if (isDriver && !driverCanAccessStore(username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    // Check if already confirmed with same values (idempotent)
    const draftItem = capture.draftItems.find(i => i.lineIndex === lineIndex);
    if (draftItem && draftItem.boundProductId && draftItem.confirmedAt) {
      // Already confirmed - check if same values
      if (draftItem.boundProductId.toString() === productId && draftItem.boundUpc === upc) {
        // Idempotent - return same response
        return res.json({
          ok: true,
          captureId: capture._id.toString(),
          status: capture.status,
          idempotent: true,
          stats: {
            totalItems: capture.totalItems,
            itemsNeedingReview: capture.itemsNeedingReview,
            itemsConfirmed: capture.itemsConfirmed
          }
        });
      }
      // Different values - error on double confirmation
      return res.status(409).json({ error: 'Item already confirmed with different values' });
    }

    // Confirm the item
    capture.confirmItem(lineIndex, productId, upc, username || 'unknown');
    await capture.save();

    await recordAuditLog({
      type: 'receipt_confirm_item',
      actorId: username || 'unknown',
      details: `capture=${capture._id.toString()} line=${lineIndex} product=${productId}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      stats: {
        totalItems: capture.totalItems,
        itemsNeedingReview: capture.itemsNeedingReview,
        itemsConfirmed: capture.itemsConfirmed
      }
    });

  } catch (error) {
    console.error('Error confirming receipt item:', error);
    res.status(500).json({ error: 'Failed to confirm receipt item' });
  }
});

/**
 * POST /api/driver/receipt-confirm-item-manual
 * Confirm a draft item binding by explicit product selection (no UPC scan)
 */
router.post('/receipt-confirm-item-manual', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, lineIndex, productId, upc } = req.body;
    const username = req.user?.username;

    // Validation
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }
    if (lineIndex === undefined || lineIndex < 0) {
      return res.status(400).json({ error: 'Valid lineIndex required' });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Valid productId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status !== 'parsed' && capture.status !== 'review_complete') {
      return res.status(400).json({ error: `Cannot confirm items with status: ${capture.status}` });
    }

    // Enforce driver-store binding
    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const isOwner = isOwnerRole || isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    const isManagement = isOwner || isManagerRole;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to confirm receipts' });
    }
    if (isDriver && !driverCanAccessStore(username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    const draftItem = capture.draftItems.find(i => i.lineIndex === lineIndex);
    if (draftItem && draftItem.boundProductId && draftItem.confirmedAt) {
      if (draftItem.boundProductId.toString() === productId && draftItem.boundUpc === upc) {
        return res.json({
          ok: true,
          captureId: capture._id.toString(),
          status: capture.status,
          idempotent: true,
          stats: {
            totalItems: capture.totalItems,
            itemsNeedingReview: capture.itemsNeedingReview,
            itemsConfirmed: capture.itemsConfirmed
          }
        });
      }
      return res.status(409).json({ error: 'Item already confirmed with different values' });
    }

    capture.confirmItem(lineIndex, productId, upc, username || 'unknown');
    await capture.save();

    await recordAuditLog({
      type: 'receipt_confirm_item',
      actorId: username || 'unknown',
      details: `capture=${capture._id.toString()} line=${lineIndex} product=${productId}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      stats: {
        totalItems: capture.totalItems,
        itemsNeedingReview: capture.itemsNeedingReview,
        itemsConfirmed: capture.itemsConfirmed
      }
    });

  } catch (error) {
    console.error('Error confirming receipt item:', error);
    res.status(500).json({ error: 'Failed to confirm receipt item' });
  }
});

/**
 * POST /api/driver/receipt-commit
 * Commit confirmed items to store inventory and product price history
 * Supports modes: safe (default), selected, locked
 */
router.post('/receipt-commit', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  console.warn('Deprecated endpoint /api/driver/receipt-commit called. Use /api/receipts/:captureId/approve instead.');
  res.set('Deprecation', 'true');
  res.set('Link', '</api/receipts/:captureId/approve>; rel="successor-version"');
  res.set('Sunset', 'Wed, 01 Oct 2025 00:00:00 GMT');
  res.set('Warning', '299 - "Deprecated endpoint. Use /api/receipts/:captureId/approve before Oct 1, 2025."');

  const session = await mongoose.startSession();

  try {
    const { captureId, mode, selectedIndices, lockDurationDays } = req.body;
    const username = req.user?.username;

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId).session(session);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    const isOwnerRole = req.user?.role === 'OWNER';
    const isManagerRole = req.user?.role === 'MANAGER';
    const isOwner = isOwnerRole || isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    const isManagement = isOwner || isManagerRole;
    if (!isManagement && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to commit receipts' });
    }

    if (isDriver && !driverCanAccessStore(username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    const normalizedMode = mode || 'safe';
    const requiresFullReview = normalizedMode === 'safe';

    if (!['safe', 'selected', 'locked'].includes(normalizedMode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    if (normalizedMode === 'selected' && (!Array.isArray(selectedIndices) || selectedIndices.length === 0)) {
      return res.status(400).json({ error: 'selectedIndices required for selected mode' });
    }

    const selectedSet = Array.isArray(selectedIndices)
      ? new Set(selectedIndices.map(Number))
      : null;

    let committed = 0;
    const errors = [];

    session.startTransaction();

    // Guardrail: do not commit if any items still need review in safe mode
    if (requiresFullReview && capture.itemsNeedingReview > 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Receipt has items needing review' });
    }

    const itemsToCommit = capture.draftItems.filter(item => {
      if (normalizedMode === 'selected') {
        return selectedSet?.has(item.lineIndex);
      }
      return true;
    });

    for (const item of itemsToCommit) {
      try {
        if (!item.boundProductId) {
          if (normalizedMode === 'safe') {
            errors.push({ lineIndex: item.lineIndex, error: 'Item not confirmed' });
            continue;
          }
          // skip unconfirmed items in selected/locked mode
          continue;
        }

        const productId = item.boundProductId;
        const upc = item.boundUpc;
        const quantity = Number(item.quantity || 1);
        const unitPrice = Number(item.unitPrice || 0);
        if (!unitPrice || unitPrice <= 0) {
          errors.push({ lineIndex: item.lineIndex, error: 'Invalid unit price' });
          continue;
        }

        const product = await Product.findById(productId).session(session);
        if (!product) {
          errors.push({ lineIndex: item.lineIndex, error: 'Product not found' });
          continue;
        }

        // Update StoreInventory observed price and history
        const inventory = await StoreInventory.findOneAndUpdate(
          { storeId: capture.storeId, productId },
          {
            $set: {
              observedPrice: unitPrice,
              observedAt: new Date()
            },
            $push: {
              priceHistory: {
                price: unitPrice,
                observedAt: new Date(),
                matchMethod: item.matchMethod,
                matchConfidence: item.matchConfidence,
                priceType: item.priceType,
                promoDetected: item.promoDetected,
                workflowType: item.workflowType
              }
            }
          },
          { new: true, upsert: true, session }
        );

        // Update product price if delta is acceptable
        const history = buildMatchHistory(inventory);
        const priceDelta = computePriceDelta(unitPrice, history, inventory.observedPrice);
        if (priceDelta?.flag === null || normalizedMode !== 'safe') {
          product.price = unitPrice;
          await product.save({ session });
        }

        // Lock price if requested (prevent further updates for N days)
        if (normalizedMode === 'locked') {
          const lockDays = Number(lockDurationDays) || DEFAULT_PRICE_LOCK_DAYS;
          await StoreInventory.findOneAndUpdate(
            { storeId: capture.storeId, productId },
            {
              $set: {
                priceLockedUntil: new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000)
              }
            },
            { session }
          );
        }

        committed++;

      } catch (itemError) {
        console.error(`Error committing item ${item.lineIndex}:`, itemError);
        errors.push({ lineIndex: item.lineIndex, error: itemError.message });
      }
    }

    const previousCommitted = Number(capture.itemsCommitted || 0);
    capture.itemsCommitted = Math.min(capture.totalItems, previousCommitted + committed);
    if (committed > 0) {
      capture.committedBy = username || 'unknown';
      capture.committedAt = new Date();
    }
    if (requiresFullReview) {
      capture.status = 'committed';
    }
    await capture.save({ session });

    // Commit transaction atomically
    await session.commitTransaction();

    await recordAuditLog({
      type: 'receipt_commit',
      actorId: username || 'unknown',
      details: `capture=${capture._id.toString()} committed=${committed} errors=${errors.length} mode=${normalizedMode} selected=${selectedSet ? selectedSet.size : 0} receipt=${capture.images?.[0]?.url || 'none'} thumb=${capture.images?.[0]?.thumbnailUrl || 'none'}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      committed,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Error committing receipt:', error);
    res.status(500).json({ error: 'Failed to commit receipt' });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/driver/receipt-price-update
 * Update observed prices from receipt data
 * Anti-noise: averages with last price if within threshold
 * Fuzzy name matching: auto-matches products by name when UPC not available
 */
router.post('/receipt-price-update', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  if (!isPricingLearningEnabled()) {
    return res.status(503).json({ error: 'Pricing learning disabled during rollout' });
  }

  const sessionDb = await mongoose.startSession();

  try {
    const isDriver = isDriverUsername(req.user?.username);
    if (!isDriver) {
      return res.status(403).json({ error: 'Driver access required' });
    }

    const { 
      storeId, 
      storeName, 
      orderId, 
      captureId, // Idempotency key (required)
      receiptImageUrl, // Cloudinary/S3 URL (not base64)
      receiptThumbnailUrl,
      items // [{ upc?, sku?, name, totalPrice, quantity, lineIndex, confirmed? }]
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    if (!storeId && !storeName) {
      return res.status(400).json({ error: 'storeId or storeName is required' });
    }
    
    if (!captureId || typeof captureId !== 'string' || captureId.length < 8) {
      return res.status(400).json({ error: 'captureId is required for idempotency' });
    }

    let updated = 0;
    let created = 0;
    let autoMatched = 0;
    let needsReview = 0;
    let errors = [];
    let reviewItems = []; // Items that need confirmation

    await sessionDb.withTransaction(async () => {
      // Resolve store
      let store;
      if (storeId) {
        store = await Store.findById(storeId).session(sessionDb);
      } else {
        store = await Store.findOne({ name: storeName }).session(sessionDb);
      }

      if (!store) {
        throw new Error('Store not found');
      }

      const ingestionCheck = await ensureIngestionAllowed(store._id.toString());
      if (!ingestionCheck.ok) {
        throw Object.assign(new Error(ingestionCheck.error), { status: ingestionCheck.status || 503 });
      }

      for (const item of items) {
        try {
          const { upc, sku, name, totalPrice, quantity, lineIndex = 0, confirmed } = item;
          
          // Validate inputs strictly
          if (upc && !validateUPC(upc)) {
            errors.push(`Invalid UPC format: ${upc}`);
            continue;
          }
          
          const validation = validatePriceQuantity(totalPrice, quantity);
          if (!validation.ok) {
            errors.push(`${name}: ${validation.error}`);
            continue;
          }

          if (!name || name.trim().length === 0) {
            errors.push(`Product name is required for matching`);
            continue;
          }

          const unitPrice = Number(totalPrice) / Number(quantity);
          const normalizedName = normalizeReceiptName(name);
          const category = classifyCategory(normalizedName);
          const promoDetected = detectPromo(name);
          const priceType = promoDetected ? 'promo' : 'unknown';

          // STEP 1: Find product by UPC, SKU, confirmed alias, or fuzzy match
          let product;
          let matchMethod = 'none';
          let matchConfidence = 0;
          let aliasMatch = null;
          
          // Direct UPC match (highest priority)
          if (upc) {
            product = await Product.findOne({ upc }).session(sessionDb);
            if (product) {
              matchMethod = 'upc';
              matchConfidence = 1.0;
            }
          }
          
          // Direct SKU match
          if (!product && sku) {
            product = await Product.findOne({ sku }).session(sessionDb);
            if (product) {
              matchMethod = 'sku';
              matchConfidence = 1.0;
            }
          }

          // Alias match (manual confirmation history)
          if (!product) {
            aliasMatch = await ReceiptNameAlias.findOne({
              storeId: store._id,
              normalizedName
            }).session(sessionDb);
            
            if (aliasMatch && aliasMatch.confirmedCount > 0) {
              const { effectiveConfidence } = getAliasEffectiveConfidence(aliasMatch);
              if (effectiveConfidence >= ALIAS_CONFIDENCE_MATCH_THRESHOLD) {
                product = await Product.findById(aliasMatch.productId).session(sessionDb);
                if (product) {
                  matchMethod = 'alias_confirmed';
                  matchConfidence = effectiveConfidence;
                }
              }
            }
          }

          // Fuzzy match by name + category
          if (!product) {
            const candidates = await Product.find({ category }).limit(200).session(sessionDb);
            let bestScore = 0;
            let bestMatch = null;
            
            for (const candidate of candidates) {
              const result = advancedMatch(name, candidate.name);
              if (result.score > bestScore && result.tokensMatch) {
                bestScore = result.score;
                bestMatch = candidate;
              }
            }
            
            if (bestMatch && bestScore >= 0.8) {
              product = bestMatch;
              matchMethod = bestScore >= 0.9 ? 'fuzzy_high' : 'fuzzy_suggested';
              matchConfidence = bestScore;
            }
          }

          // STEP 2: If no match, create review item
          if (!product) {
            needsReview++;
            reviewItems.push({
              lineIndex,
              receiptName: name,
              normalizedName,
              totalPrice,
              quantity,
              unitPrice,
              matchMethod: 'none',
              matchConfidence: 0,
              needsReview: true,
              reviewReason: 'no_match'
            });
            continue;
          }

          // STEP 3: Update StoreInventory
          const storeInventory = await StoreInventory.findOneAndUpdate(
            { storeId: store._id, productId: product._id },
            {
              $set: {
                observedPrice: unitPrice,
                observedAt: new Date()
              },
              $push: {
                priceHistory: {
                  price: unitPrice,
                  observedAt: new Date(),
                  matchMethod,
                  matchConfidence,
                  priceType,
                  promoDetected,
                  workflowType: 'update_price'
                }
              }
            },
            { new: true, upsert: true, session: sessionDb }
          );

          // STEP 4: Update product price (with guardrails)
          const priceDelta = computePriceDelta(unitPrice, buildMatchHistory(storeInventory), storeInventory.observedPrice);
          if (!priceDelta || !priceDelta.flag) {
            product.price = unitPrice;
            await product.save({ session: sessionDb });
            updated++;
          } else {
            needsReview++;
            reviewItems.push({
              lineIndex,
              receiptName: name,
              normalizedName,
              totalPrice,
              quantity,
              unitPrice,
              matchMethod,
              matchConfidence,
              needsReview: true,
              reviewReason: 'large_price_change'
            });
          }

          // STEP 5: Update alias (if needed)
          if (aliasMatch) {
            aliasMatch.confirmedCount += 1;
            aliasMatch.lastConfirmedAt = new Date();
            aliasMatch.lastSeenAt = new Date();
            await aliasMatch.save({ session: sessionDb });
          }

        } catch (itemError) {
          errors.push({ lineIndex: item.lineIndex, error: itemError.message });
        }
      }

      // If captureId provided, update receipt capture record
      if (captureId) {
        await ReceiptCapture.findByIdAndUpdate(
          captureId,
          {
            $set: {
              status: 'parsed',
              draftItems: reviewItems,
              totalItems: items.length,
              itemsNeedingReview: needsReview,
              itemsConfirmed: items.length - needsReview
            }
          },
          { session: sessionDb }
        );
      }
    });

    res.json({
      ok: true,
      updated,
      created,
      autoMatched,
      needsReview,
      reviewItems: mapReceiptItemsForResponse(reviewItems),
      errors
    });

  } catch (error) {
    console.error('Receipt price update error:', error);
    res.status(500).json({ error: 'Failed to update receipt prices' });
  } finally {
    await sessionDb.endSession();
  }
});

/**
 * GET /api/driver/receipt-review
 * Fetch receipt capture items needing review (per store)
 */
router.get('/receipt-review', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, status = 'parsed', limit = 100 } = req.query;
    const username = req.user?.username;
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);

    // Drivers must specify storeId and be authorized for it
    if (isDriver && !isOwner) {
      if (!storeId) {
        return res.status(400).json({ error: 'Drivers must specify storeId' });
      }
      if (!driverCanAccessStore(username, storeId)) {
        return res.status(403).json({ error: 'Driver not authorized for this store' });
      }
    }

    const query = { status };
    if (storeId) query.storeId = storeId;

    const captures = await ReceiptCapture.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const items = [];
    for (const capture of captures) {
      for (const item of capture.draftItems || []) {
        if (item.needsReview) {
          items.push({
            captureId: capture._id,
            storeId: capture.storeId,
            storeName: capture.storeName,
            receiptName: item.receiptName,
            normalizedName: item.normalizedName,
            totalPrice: item.totalPrice,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            matchMethod: item.matchMethod,
            matchConfidence: item.matchConfidence,
            reviewReason: item.reviewReason,
            suggestedProduct: item.suggestedProduct
          });
        }
      }
    }

    res.json({ ok: true, items });

  } catch (error) {
    console.error('Error fetching receipt review items:', error);
    res.status(500).json({ error: 'Failed to fetch receipt review items' });
  }
});

/**
 * GET /api/driver/receipt-inventory/:storeId
 * Returns store inventory with observed prices (for review UI)
 */
router.get('/receipt-inventory/:storeId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.params;
    
    const inventory = await StoreInventory.find({ storeId })
      .populate('productId', 'name sku upc price')
      .lean();

    const enriched = inventory.map(inv => ({
      ...inv,
      product: inv.productId,
      hasObservedPrice: Boolean(inv.observedPrice),
      priceDrift: inv.observedPrice && inv.productId?.price 
        ? ((inv.observedPrice - inv.productId.price) / inv.productId.price * 100).toFixed(1)
        : null
    }));

    res.json({ ok: true, inventory: enriched });
  } catch (err) {
    console.error('GET STORE INVENTORY ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch store inventory' });
  }
});

/**
 * GET /api/driver/receipt-captures
 * List receipt captures for management review
 * Query params: storeId, status, limit
 * SECURITY: Owner sees all; Driver sees only their authorized stores
 */
router.get('/receipt-captures', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, status, limit = 50 } = req.query;
    const username = req.user?.username;
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    
    // Drivers must specify storeId and be authorized for it
    if (isDriver && !isOwner) {
      if (!storeId) {
        return res.status(400).json({ error: 'Drivers must specify storeId' });
      }
      if (!driverCanAccessStore(username, storeId)) {
        return res.status(403).json({ error: 'Driver not authorized for this store' });
      }
    }
    
    const query = {};
    if (storeId) query.storeId = storeId;
    if (status) {
      const statusList = Array.isArray(status) ? status : [status];
      query.status = { $in: statusList.map(entry => String(entry)) };
    }

    const captures = await ReceiptCapture.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      ok: true,
      captures: captures.map(c => {
        // Calculate workflow stats
        const newProducts = (c.draftItems || []).filter(i => i.workflowType === 'new_product').length;
        const priceUpdates = (c.draftItems || []).filter(i => i.workflowType === 'update_price').length;
        
        return {
          _id: c._id,
          storeId: c.storeId,
          storeName: c.storeName,
          orderId: c.orderId,
          status: c.status,
          imageCount: c.images?.length || 0,
          stats: {
            totalItems: c.totalItems || 0,
            itemsNeedingReview: c.itemsNeedingReview || 0,
            itemsConfirmed: c.itemsConfirmed || 0,
            itemsCommitted: c.itemsCommitted || 0
          },
          workflowStats: {
            newProducts,      // Items to create as new products
            priceUpdates      // Items to update existing prices
          },
          createdByUserId: c.createdByUserId,
          createdByRole: c.createdByRole,
          source: c.source,
          createdAt: c.createdAt,
          reviewExpiresAt: c.reviewExpiresAt
        };
      })
    });

  } catch (error) {
    console.error('Error listing receipt captures:', error);
    res.status(500).json({ error: 'Failed to list receipt captures' });
  }
});

/**
 * DELETE /api/driver/receipt-capture/:captureId
 * Delete a receipt capture and its associated images
 * SECURITY: Owner can delete any capture; Driver can only delete from their authorized stores
 */
router.delete('/receipt-capture/:captureId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username;
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);

    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    // Authorization check
    if (isDriver && !isOwner) {
      if (!driverCanAccessStore(username, capture.storeId)) {
        return res.status(403).json({ error: 'Not authorized to delete this receipt' });
      }
    } else if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to delete receipts' });
    }

    // Delete from database
    await ReceiptCapture.deleteOne({ _id: captureId });

    // Note: Images stored in Cloudinary are not deleted (permanent audit trail)
    // They remain accessible via URL but are orphaned from the receipt

    await recordAuditLog({
      type: 'receipt_capture_delete',
      actorId: username || 'unknown',
      details: `captureId=${captureId} storeName=${capture.storeName}`
    });

    res.json({
      ok: true,
      message: 'Receipt capture deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting receipt capture:', error);
    res.status(500).json({ error: 'Failed to delete receipt capture' });
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
        model: 'gemini-2.0-flash-exp',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { data: imageBase64, mime_type: mimeType } }
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
      const normalizedName = normalizeReceiptName(receiptName);
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
      const normalizedName = normalizeReceiptName(item.receiptName);
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
    const { storeId, storeName, address, phone, storeType } = req.body;
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

    await ReceiptParseJob.findOneAndUpdate(
      { captureId },
      { status: 'REJECTED' },
      { new: true }
    );

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

    res.json({
      ok: true,
      items: mapReceiptItemsForResponse(capture.draftItems || [])
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
    res.json({
      ok: true,
      cloudinary: hasCloudinary,
      queueEnabled: isReceiptQueueEnabled(),
      learningEnabled: isPricingLearningEnabled()
    });
  } catch (error) {
    console.error('Error fetching receipt health:', error);
    res.status(500).json({ error: 'Failed to fetch receipt health' });
  }
});

export default router;
