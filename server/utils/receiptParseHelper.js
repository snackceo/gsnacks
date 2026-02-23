// receiptParseHelper.js
// Shared parsing logic for receipt-prices route and receiptWorker

import { GoogleGenAI } from '@google/genai';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import Store from '../models/Store.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import Product from '../models/Product.js';
import { recordAuditLog } from './audit.js';
import { transitionReceiptParseJobStatus } from './receiptParseJobStatus.js';
import { inferStoreType, matchStoreCandidate, normalizePhone, normalizeStoreNumber, normalizeZip } from './storeMatcher.js';
import { normalizeReceiptProductName } from './receiptNameNormalization.js';

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const ensureGeminiReady = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Gemini API key not configured.' };
  }
  return { ok: true, apiKey };
};

// Constants for parsing policies
const ALIAS_CONFIDENCE_HALF_LIFE_DAYS = 90;
const PRICE_DELTA_POLICY = {
  pctThreshold: 0.30,
  absThreshold: 1.00,
  stalenessDays: 30
};

const isReceiptParseDebugEnabled = () => {
  const rawValue = process.env.RECEIPT_PARSE_DEBUG;
  return /^(1|true|yes|on)$/i.test(String(rawValue || '').trim());
};

const parseReceiptAddress = (rawAddress = '') => {
  if (!rawAddress) return {};
  const cleaned = rawAddress.trim();
  const zipMatch = cleaned.match(/\b\d{5}\b/);
  const zip = zipMatch?.[0];
  const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ');
    const stateZipMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
    const state = stateZipMatch?.[1]?.toUpperCase();
    const parsedZip = stateZipMatch?.[2] || zip;
    return {
      street,
      city,
      state,
      zip: parsedZip
    };
  }
  const lines = cleaned.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const street = lines[0];
    const locality = lines.slice(1).join(' ');
    const localityMatch = locality.match(/^(.*?)(?:\s+([A-Z]{2})\s*(\d{5})?)$/i);
    if (localityMatch) {
      return {
        street,
        city: localityMatch[1].trim(),
        state: localityMatch[2].toUpperCase(),
        zip: localityMatch[3] || zip
      };
    }
    return {
      street,
      city: locality.replace(/\b\d{5}\b/, '').trim(),
      zip
    };
  }
  const fallbackZip = zip || normalizeZip(cleaned);
  const fallbackStateMatch = cleaned.match(/([A-Z]{2})\s*\d{5}?/i);
  const fallbackState = fallbackStateMatch?.[1]?.toUpperCase();
  console.warn('Receipt address parse incomplete; storing street only.', { rawAddress });
  return { street: cleaned, state: fallbackState, zip: fallbackZip };
};

const normalizeUpc = value => {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length < 8 || digits.length > 14) return '';
  return digits;
};


const sanitizeNumericCandidate = raw => {
  if (raw === null || raw === undefined) return '';
  return normalizeSpacedDecimalTokens(String(raw))
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/\b(?:USD|U5D|USO|EUR|CAD|GBP)\b/gi, '')
    .replace(/[oO]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
};

const normalizeSmartQuotes = value => String(value || '')
  .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
  .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

const stripCodeFences = value => normalizeSmartQuotes(value)
  .replace(/```json\s*/gi, '')
  .replace(/```\s*/g, '')
  .trim();

const extractLargestJsonBlock = value => {
  const input = String(value || '');
  const spans = [];
  const stack = [];
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '{') {
      stack.push(i);
    } else if (char === '}' && stack.length) {
      const start = stack.pop();
      spans.push({ start, end: i + 1, length: i + 1 - start });
    }
  }
  if (!spans.length) return '';
  spans.sort((a, b) => b.length - a.length);
  const best = spans[0];
  return input.slice(best.start, best.end);
};

const normalizeJsonCandidate = value => {
  let normalized = stripCodeFences(value);
  const largestJsonBlock = extractLargestJsonBlock(normalized);
  if (largestJsonBlock) {
    normalized = largestJsonBlock;
  }
  return normalized
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

const parseGeminiJsonPayload = rawText => {
  const firstPass = stripCodeFences(rawText);
  try {
    return JSON.parse(firstPass);
  } catch (_err) {
    const tolerant = normalizeJsonCandidate(rawText);
    if (!tolerant) return null;
    return JSON.parse(tolerant);
  }
};

const sanitizeReceiptNumber = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let cleaned = sanitizeNumericCandidate(value);
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    cleaned = decimalSeparator === '.'
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    const parts = cleaned.split(',');
    const decimalLike = commaCount === 1 && parts[1]?.length > 0 && parts[1].length <= 2;
    cleaned = decimalLike ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      const parts = cleaned.split('.');
      const decimalPart = parts.pop();
      cleaned = `${parts.join('')}.${decimalPart}`;
    }
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const RECEIPT_SKIP_ROW_PATTERN = /(subtotal|sub total|tax|payment|tender|change|balance|total\s+due|grand\s+total|cash|credit|debit|visa|mastercard|amex|discover|coupon|discount|savings|loyalty|fee|deposit|bottle\s+return|tip|auth|approval|invoice|order\s*#|thank\s+you)/i;

const normalizeSpacedDecimalTokens = value => {
  if (!value) return value;
  return String(value)
    .replace(/(\d)\s+(\d)/g, '$1$2')
    .replace(/(\d)\s+([.,])/g, '$1$2')
    .replace(/([.,])\s+(\d)/g, '$1$2');
};

const recoverItemsFromRawText = rawText => {
  const lines = String(rawText || '').split(/\r?\n/);
  const recovered = [];
  let pendingName = '';

  const itemLineRegex = /^(.+?)\s+(?:(\d+(?:[.,]\d+)?)\s*[xX]\s*)?([\$€£]?\s*[\d\s]+(?:[.,]\s*\d{1,2})?(?:\s*[A-Z]{3})?)\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingName = '';
      continue;
    }
    if (RECEIPT_SKIP_ROW_PATTERN.test(line)) {
      pendingName = '';
      continue;
    }

    const normalizedLine = normalizeSpacedDecimalTokens(line);
    const match = normalizedLine.match(itemLineRegex);

    if (!match) {
      if (!/\d/.test(line) && line.length > 2) {
        pendingName = pendingName ? `${pendingName} ${line}` : line;
      }
      continue;
    }

    const inlineName = match[1]?.trim();
    const name = (pendingName ? `${pendingName} ${inlineName}` : inlineName).trim();
    const qty = sanitizeReceiptNumber(match[2]) || 1;
    const price = sanitizeReceiptNumber(match[3]);

    pendingName = '';
    if (!name || !price || price <= 0 || RECEIPT_SKIP_ROW_PATTERN.test(name)) {
      continue;
    }

    recovered.push({
      receiptName: name,
      quantity: qty > 0 ? qty : 1,
      totalPrice: price,
      unitPrice: qty > 0 ? price / qty : price
    });
  }

  return recovered;
};

const RECEIPT_IMAGE_FETCH_ATTEMPTS = 3;
const RECEIPT_IMAGE_FETCH_RETRY_DELAY_MS = 300;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAsInlineData(url) {
  let lastError;
  for (let attempt = 1; attempt <= RECEIPT_IMAGE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch receipt image: ${resp.status}`);
      }
      const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(await resp.arrayBuffer());
      return { inlineData: { mimeType: contentType, data: buf.toString('base64') } };
    } catch (error) {
      lastError = error;
      if (attempt < RECEIPT_IMAGE_FETCH_ATTEMPTS) {
        await sleep(RECEIPT_IMAGE_FETCH_RETRY_DELAY_MS * attempt);
      }
    }
  }
  console.warn('Receipt image fetch failed after retries.', {
    url,
    attempts: RECEIPT_IMAGE_FETCH_ATTEMPTS,
    error: lastError?.message
  });
  try {
    await recordAuditLog({
      type: 'receipt_parse_image_fetch_failed',
      actorId: 'worker',
      details: `url=${url} attempts=${RECEIPT_IMAGE_FETCH_ATTEMPTS} error=${lastError?.message || 'unknown'}`
    });
  } catch (auditError) {
    console.warn('Failed to record receipt image fetch audit log.', {
      url,
      error: auditError?.message
    });
  }
  throw lastError;
}

function buildInlineDataFromDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  };
}

// Canonical normalize receipt name for matching
const normalizeReceiptName = normalizeReceiptProductName;

// Calculate alias confidence with time-based decay
function getAliasEffectiveConfidence(alias) {
  if (!alias?.confirmedCount || !alias?.lastConfirmedAt) return 0;
  const baseConfidence = Math.min(1, alias.confirmedCount / 10);
  const ageInDays = (Date.now() - new Date(alias.lastConfirmedAt).getTime()) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, ageInDays / ALIAS_CONFIDENCE_HALF_LIFE_DAYS);
  return Math.max(0.1, baseConfidence * decayFactor);
}

// Evaluate price delta for review flags
function evaluatePriceDelta({ lastPrice, newPrice, lastObservedAt, now = new Date() }) {
  if (!lastPrice || !newPrice) return { isStale: false, exceedsThreshold: false };
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
}

// Extract tokens from receipt name (brand, size, flavor)
function extractTokens(name) {
  if (!name || typeof name !== 'string') return {};
  const upper = name.toUpperCase();
  
  const brandKeywords = ['COKE', 'COCA', 'PEPSI', 'SPRITE', 'FANTA', 'MTN', 'MOUNTAIN', 'DEW', 'DR PEPPER', 'SNAPPLE', 'GATORADE', 'POWERADE', 'AQUAFINA', 'DASANI'];
  const sizePatterns = /(\d+(?:\.\d+)?\s*(?:OZ|FL|ML|L|G|KG|LB|GAL))/gi;
  const flavorKeywords = ['CHERRY', 'VANILLA', 'LEMON', 'LIME', 'ORANGE', 'GRAPE', 'BERRY', 'FRUIT'];

  const brand = brandKeywords.find(b => upper.includes(b));
  const sizeMatches = name.match(sizePatterns);
  const size = sizeMatches ? sizeMatches[0] : null;
  const flavor = flavorKeywords.filter(f => upper.includes(f));

  return { brand, size, flavor };
}

// Match receipt items to products using aliases, tokens, and fuzzy matching
async function matchReceiptItems(items, storeId) {
  if (!storeId || !Array.isArray(items) || items.length === 0) return items;

  const noiseRules = await ReceiptNoiseRule.find({ storeId }).lean();
  const noiseSet = new Set((noiseRules || []).map(r => r.normalizedName));

  const aliases = await ReceiptNameAlias.find({ storeId }).lean();
  const aliasMap = new Map(aliases.map(a => [a.normalizedName, a]));

  const storeInventory = await StoreInventory.find({ storeId })
    .populate('productId')
    .lean();
  const inventoryMap = new Map(storeInventory.map(inv => [String(inv.productId?._id), inv]));
  const upcValues = Array.from(
    new Set(
      items
        .map(item => normalizeUpc(item.upc))
        .filter(Boolean)
    )
  );
  const upcLookupMap = new Map();
  if (upcValues.length) {
    const upcItems = await UpcItem.find({ upc: { $in: upcValues } }).lean();
    const productIds = upcItems.map(entry => entry.productId).filter(Boolean);
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } }).lean()
      : [];
    const productMap = new Map(products.map(product => [String(product._id), product]));
    for (const entry of upcItems) {
      const product = entry.productId ? productMap.get(String(entry.productId)) : null;
      upcLookupMap.set(entry.upc, { entry, product });
    }
  }

  const matchedItems = [];

  for (const item of items) {
    const normalized = normalizeReceiptName(item.receiptName);
    const itemUpc = normalizeUpc(item.upc);
    if (itemUpc && upcLookupMap.has(itemUpc)) {
      const { entry, product } = upcLookupMap.get(itemUpc);
      const inventory = product ? inventoryMap.get(String(product._id)) : null;
      const confidence = product ? 1 : 0.7;
      let priceDelta = null;
      if (inventory?.observedPrice) {
        priceDelta = evaluatePriceDelta({
          lastPrice: inventory.observedPrice,
          newPrice: item.totalPrice / item.quantity,
          lastObservedAt: inventory.observedAt
        });
      }
      matchedItems.push({
        ...item,
        upc: itemUpc,
        normalizedName: normalized,
        suggestedProduct: product ? {
          id: product._id,
          name: product.name,
          upc: entry.upc,
          sku: product.sku
        } : null,
        matchMethod: product ? 'upc' : 'upc_unmapped',
        matchConfidence: confidence,
        tokens: extractTokens(item.receiptName),
        priceDelta: priceDelta?.exceedsThreshold ? {
          flag: 'large_price_change',
          pctDelta: priceDelta.pctDelta,
          absDelta: priceDelta.absDelta
        } : null,
        needsReview: !product || priceDelta?.exceedsThreshold || false,
        reviewReason: !product ? 'no_match' : priceDelta?.exceedsThreshold ? 'large_price_change' : null
      });
      continue;
    }
    
    // Check noise rules first
    if (noiseSet.has(normalized)) {
      matchedItems.push({
        ...item,
        normalizedName: normalized,
        classification: 'D',
        isNoiseRule: true,
        needsReview: false
      });
      continue;
    }

    // Try alias match
    const alias = aliasMap.get(normalized);
    if (alias && alias.productId) {
      const inventory = inventoryMap.get(String(alias.productId));
      const product = inventory?.productId;
      const confidence = getAliasEffectiveConfidence(alias);
      
      let priceDelta = null;
      if (product && inventory?.observedPrice) {
        priceDelta = evaluatePriceDelta({
          lastPrice: inventory.observedPrice,
          newPrice: item.totalPrice / item.quantity,
          lastObservedAt: inventory.observedAt
        });
      }

      matchedItems.push({
        ...item,
        normalizedName: normalized,
        suggestedProduct: product ? {
          id: product._id,
          name: product.name,
          upc: product.upc,
          sku: product.sku
        } : null,
        matchMethod: 'alias_confirmed',
        matchConfidence: confidence,
        tokens: extractTokens(item.receiptName),
        priceDelta: priceDelta?.exceedsThreshold ? {
          flag: 'large_price_change',
          pctDelta: priceDelta.pctDelta,
          absDelta: priceDelta.absDelta
        } : null,
        needsReview: confidence < 0.8 || priceDelta?.exceedsThreshold || false,
        reviewReason: confidence < 0.8 ? 'low_confidence' : priceDelta?.exceedsThreshold ? 'large_price_change' : null
      });
      continue;
    }

    // Fuzzy match fallback
    const tokens = extractTokens(item.receiptName);
    let bestMatch = null;
    let bestScore = 0;

    for (const inventory of storeInventory) {
      const product = inventory.productId;
      if (!product) continue;
      
      const productNorm = normalizeReceiptName(product.name);
      const productTokens = extractTokens(product.name);
      
      let score = 0;
      if (productNorm === normalized) score += 0.8;
      if (tokens.brand && productTokens.brand && tokens.brand === productTokens.brand) score += 0.3;
      if (tokens.size && productTokens.size && tokens.size === productTokens.size) score += 0.2;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { product, inventory };
      }
    }

    if (bestMatch && bestScore >= 0.3) {
      const product = bestMatch.product;
      const inventory = bestMatch.inventory;
      
      let priceDelta = null;
      if (inventory?.observedPrice) {
        priceDelta = evaluatePriceDelta({
          lastPrice: inventory.observedPrice,
          newPrice: item.totalPrice / item.quantity,
          lastObservedAt: inventory.observedAt
        });
      }

      matchedItems.push({
        ...item,
        normalizedName: normalized,
        suggestedProduct: {
          id: product._id,
          name: product.name,
          upc: product.upc,
          sku: product.sku
        },
        matchMethod: 'fuzzy_suggested',
        matchConfidence: bestScore,
        tokens,
        priceDelta: priceDelta?.exceedsThreshold ? {
          flag: 'large_price_change',
          pctDelta: priceDelta.pctDelta,
          absDelta: priceDelta.absDelta
        } : null,
        needsReview: bestScore < 0.8 || priceDelta?.exceedsThreshold || !tokens.size,
        reviewReason: bestScore < 0.8 ? 'low_confidence' : priceDelta?.exceedsThreshold ? 'large_price_change' : !tokens.size ? 'no_size_token' : null
      });
    } else {
      // No match
      matchedItems.push({
        ...item,
        normalizedName: normalized,
        tokens,
        needsReview: true,
        reviewReason: 'no_match'
      });
    }
  }

  return matchedItems;
}

/**
 * Parse receipt images using Gemini and populate ReceiptParseJob proposal
 * This is called from both the receipt-parse route and the receipt worker
 * Returns the updated ReceiptParseJob or throws on error
 */
const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /network/i,
  /temporar/i,
  /unavailable/i,
  /rate limit/i,
  /\b429\b/
];

const RETRY_BACKOFF_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000
];

const getRetryAfter = (attempts = 1) => {
  const index = Math.max(1, attempts) - 1;
  const delayMs = RETRY_BACKOFF_MS[Math.min(index, RETRY_BACKOFF_MS.length - 1)];
  return new Date(Date.now() + delayMs);
};

const classifyParseError = err => {
  const message = err?.message || err?.toString?.() || 'Unknown error';
  const status = err?.status || err?.response?.status;
  const isTransient =
    status === 429 ||
    status === 503 ||
    TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
  return {
    parseError: message,
    parseErrorType: isTransient ? 'TRANSIENT' : 'PERMANENT'
  };
};


export const __test__ = {
  sanitizeReceiptNumber,
  parseGeminiJsonPayload,
  recoverItemsFromRawText
};

export async function executeReceiptParse(captureId, actorId = 'worker', options = {}) {
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw new Error('Receipt capture not found');
  }


  let parseFailureDetails = null;
  let totalLines = 0;
  let invalidPriceSkippedLines = 0;
  let skippedImages = [];
  let skippedImageReason = [];

  // --- ENFORCE ALL IMAGES ARE CLOUDINARY OR DATA URL ---
  const invalidImages = (capture.images || []).filter(img => {
    if (!img.url) return true;
    if (img.url.startsWith('https://') && img.url.includes('cloudinary')) return false;
    if (img.url.startsWith('data:')) return false;
    return true;
  });
  if (invalidImages.length > 0) {
    const reasons = invalidImages.map(img => img.url || 'missing_url').join(', ');
    capture.status = 'failed';
    capture.parseError = `Invalid receipt image URLs: ${reasons}`;
    await capture.save();
    const failureDetails = classifyParseError(new Error(capture.parseError));
    const retryAfter = failureDetails.parseErrorType === 'TRANSIENT'
      ? getRetryAfter(capture.parseAttempts || 1)
      : null;
    await transitionReceiptParseJobStatus({
      captureId: capture._id.toString(),
      actor: actorId,
      status: 'FAILED',
      updates: {
        parseError: failureDetails.parseError,
        parseErrorType: failureDetails.parseErrorType,
        retryAfter
      }
    });
    throw new Error(capture.parseError);
  }

  // Check Gemini API availability
  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    capture.status = 'failed';
    capture.parseError = apiReady.error;
    await capture.save();
    const failureDetails = classifyParseError(new Error(apiReady.error));
    const retryAfter = failureDetails.parseErrorType === 'TRANSIENT'
      ? getRetryAfter(capture.parseAttempts || 1)
      : null;
    await transitionReceiptParseJobStatus({
      captureId: capture._id.toString(),
      actor: actorId,
      status: 'FAILED',
      updates: {
        parseError: failureDetails.parseError,
        parseErrorType: failureDetails.parseErrorType,
        retryAfter
      }
    });
    throw new Error(apiReady.error);
  }

  capture.markParsing();
  await capture.save();
  await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor: actorId,
    status: 'PARSING'
  });

  try {
    const draftItems = [];
    const geminiOutput = { rawTextByImage: [], parsedByImage: [], skippedImages: [] };
    const storeCandidateData = {};

    // Parse each image
    for (const image of capture.images) {

      // Prepare image for Gemini Vision (always inlineData, even for HTTPS URLs)
      let geminiImageContent;
      if (/^https?:\/\//i.test(image.url)) {
        geminiImageContent = await fetchAsInlineData(image.url);
      } else if (image.url.startsWith('data:')) {
        const inlineData = buildInlineDataFromDataUrl(image.url);
        if (!inlineData) {
          geminiOutput.skippedImages.push({ url: image.url, reason: 'invalid_data_url' });
          continue;
        }
        geminiImageContent = inlineData;
      } else {
        geminiOutput.skippedImages.push({ url: image.url, reason: 'unsupported_image_url' });
        continue;
      }

      // Gemini prompt for receipt parsing
      const prompt = `You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE NAME, STORE NUMBER, PHONE, and ADDRESS if visible at the top or bottom of receipt. Return them as:
"storeName": "Store Name" (or null if not visible)
"storeNumber": "1234" (or null if not visible)
"phone": "555-123-4567" (or null if not visible)
"address": "123 Main St, City, ST 12345"  (or null if not visible)

THEN, extract ALL line items with prices. Return ONLY valid JSON format:
{
  "storeName": "STORE NAME",
  "storeNumber": "1234",
  "phone": "555-123-4567",
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "upc": "012000001234", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "upc": "028400123456", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store name, store number (e.g., ST#, Store #, SC#), phone, and address if visible (street, city, state, zip)
2. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment, instructions)
3. Use exact product names from receipt
4. Extract UPC if visible on the line (8-14 digits, usually near the item name)
5. For multi-buy items, calculate quantity * unit price = totalPrice
6. Skip discounts, coupons, tax lines
7. Return empty array [] for items if none found
8. Return ONLY valid JSON, no markdown, no explanation`;

      // Call Gemini Vision API
      const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
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

      const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      geminiOutput.rawTextByImage.push(text);

      // Parse Gemini JSON response with tolerant recovery
      let parsed = null;
      try {
        parsed = parseGeminiJsonPayload(text);
      } catch (parseErr) {
        parsed = null;
      }
      if (!parsed) {
        console.warn('Failed to parse Gemini JSON:', text.substring(0, 200));
        geminiOutput.parsedByImage.push({ error: 'Invalid JSON' });
        continue;
      }

      geminiOutput.parsedByImage.push(parsed);

      if (parsed.storeName && !storeCandidateData.name) {
        storeCandidateData.name = parsed.storeName;
      }
      if (parsed.storeNumber && !storeCandidateData.storeNumber) {
        storeCandidateData.storeNumber = normalizeStoreNumber(parsed.storeNumber);
      }
      if (parsed.phone && !storeCandidateData.phone) {
        storeCandidateData.phone = parsed.phone;
      }
      if (parsed.address && !storeCandidateData.address) {
        storeCandidateData.address = parseReceiptAddress(parsed.address);
      }

      const recoveredItems = Array.isArray(parsed.items) && parsed.items.length
        ? parsed.items
        : recoverItemsFromRawText(text);

      // Add items from this image
      if (Array.isArray(recoveredItems)) {
        for (const item of recoveredItems) {
          totalLines += 1;
          const parsedTotal = sanitizeReceiptNumber(item.totalPrice);
          const parsedUnit = sanitizeReceiptNumber(item.unitPrice);
          const parsedQty = sanitizeReceiptNumber(item.quantity);

          const hasTotal = typeof parsedTotal === 'number' && Number.isFinite(parsedTotal) && parsedTotal > 0;
          const hasUnit = typeof parsedUnit === 'number' && Number.isFinite(parsedUnit) && parsedUnit > 0;
          const qty = typeof parsedQty === 'number' && Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

          if (item.receiptName && (hasTotal || hasUnit)) {
            const totalPrice = hasTotal
              ? parsedTotal
              : (hasUnit && qty > 0 ? parsedUnit * qty : null);
            const unitPrice = hasUnit
              ? parsedUnit
              : (hasTotal && qty > 0 ? parsedTotal / qty : null);

            if (!(typeof totalPrice === 'number' && totalPrice > 0) && !(typeof unitPrice === 'number' && unitPrice > 0)) {
              invalidPriceSkippedLines += 1;
              continue;
            }

            const upc = normalizeUpc(item.upc || item.upcCandidate || item.barcode);
            draftItems.push({
              lineIndex: draftItems.length,
              receiptName: item.receiptName,
              quantity: qty,
              totalPrice: typeof totalPrice === 'number' && Number.isFinite(totalPrice) ? totalPrice : 0,
              unitPrice: typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? unitPrice : 0,
              upc
            });
          } else if (item.receiptName) {
            invalidPriceSkippedLines += 1;
          }
        }
      }
    }

    skippedImages = geminiOutput.skippedImages;
    skippedImageReason = geminiOutput.skippedImages.map(skip => skip.reason).filter(Boolean);

    if (geminiOutput.skippedImages.length === capture.images.length) {
      const skipSummary = geminiOutput.skippedImages.map(skip => skip.reason).join(', ');
      capture.status = 'failed';
      capture.parseError = `All receipt images were skipped: ${skipSummary || 'unsupported images'}`;
      await capture.save();
      parseFailureDetails = {
        parseError: capture.parseError,
        parseErrorType: 'PERMANENT'
      };
      throw new Error(capture.parseError);
    }

    if (!storeCandidateData.storeType && storeCandidateData.name) {
      storeCandidateData.storeType = inferStoreType(storeCandidateData.name);
    }

    // Match items to products
    const matchedItems = await matchReceiptItems(draftItems, capture.storeId);
    const matchedLines = matchedItems.filter(item => item?.suggestedProduct?.id).length;
    const unmatchedLines = matchedItems.length - matchedLines;

    if (isReceiptParseDebugEnabled()) {
      console.info('Receipt parse debug matched items.', {
        captureId: capture._id?.toString?.() || String(capture._id || captureId),
        lines: matchedItems.map(item => ({
          lineIndex: item.lineIndex,
          receiptName: item.receiptName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          upc: item.upc || null,
          matchMethod: item.matchMethod || null,
          suggestedProductId: item.suggestedProduct?.id || null
        }))
      });
    }

    console.info('Receipt parse summary.', {
      captureId: capture._id?.toString?.() || String(capture._id || captureId),
      totalLines,
      matchedLines,
      unmatchedLines,
      invalidPriceSkippedLines
    });

    capture.markParsed(matchedItems);
    capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
    await capture.save();

    // Create ReceiptParseJob for review/approval
    const candidateName = capture.storeName || storeCandidateData.name;
    const candidatePhone = storeCandidateData.phone;
    const candidateAddress = storeCandidateData.address;
    const candidateStoreNumber = storeCandidateData.storeNumber;
    const candidateStoreType = storeCandidateData.storeType || inferStoreType(candidateName);
    const normalizedPhone = normalizePhone(candidatePhone);

    let storeCandidate = null;
    let storeMatchReason = null;
    let storeMatchConfidence = null;
    let storeMatchResult = null;
    const storeFromCapture = capture.storeId ? await Store.findById(capture.storeId).lean() : null;
    if (storeFromCapture) {
      storeCandidate = storeFromCapture;
      storeMatchReason = 'capture_store';
      storeMatchConfidence = 1;
    } else {
      const matchPayload = {
        name: candidateName,
        phone: candidatePhone,
        phoneNormalized: normalizedPhone,
        storeNumber: candidateStoreNumber,
        address: candidateAddress,
        storeType: candidateStoreType
      };
      const matchResult = await matchStoreCandidate(matchPayload);
      storeMatchResult = matchResult;
      if (matchResult?.match) {
        storeCandidate = { ...matchResult.match, confidence: matchResult.confidence };
        storeMatchReason = matchResult.matchReason || matchResult.reason;
        storeMatchConfidence = matchResult.confidence;
      } else if (candidateName || candidatePhone || candidateAddress || candidateStoreNumber) {
        storeCandidate = {
          name: candidateName || 'Unknown Store',
          phone: candidatePhone,
          phoneNormalized: normalizedPhone,
          storeNumber: candidateStoreNumber,
          address: candidateAddress || {},
          storeType: candidateStoreType,
          confidence: 0.2
        };
        storeMatchReason = 'parsed_store_data';
        storeMatchConfidence = 0.2;
      }
    }
    const items = matchedItems.map(item => ({
      rawLine: item.receiptName,
      nameCandidate: item.normalizedName || item.receiptName,
      brandCandidate: item.tokens?.brand,
      sizeCandidate: item.tokens?.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.totalPrice,
      upcCandidate: item.suggestedProduct?.upc || item.upc,
      requiresUpc: !item.suggestedProduct?.upc,
      match: {
        productId: item.suggestedProduct?.id,
        confidence: item.matchConfidence,
        reason: item.matchMethod
      },
      actionSuggestion: item.suggestedProduct ? 'LINK_UPC_TO_PRODUCT' : 'CAPTURE_UNMAPPED',
      warnings: item.needsReview && item.reviewReason ? [item.reviewReason] : []
    }));

    const needsReview = items.some(it => it.warnings?.length);
    const job = await transitionReceiptParseJobStatus({
      captureId: capture._id.toString(),
      actor: actorId,
      status: needsReview ? 'NEEDS_REVIEW' : 'PARSED',
      updates: {
        parseError: null,
        parseErrorType: null,
        retryAfter: null,
        skippedImages,
        skippedImageReason,
        rawText: JSON.stringify(geminiOutput),
        structured: { draftItems: matchedItems },
        geminiOutput,
        storeCandidate: storeCandidate ? {
          name: storeCandidate.name,
          address: { ...(storeCandidate.address || {}), ...(candidateAddress || {}) },
          phone: storeCandidate.phone || candidatePhone,
          phoneNormalized: normalizePhone(storeCandidate.phoneNormalized || storeCandidate.phone || candidatePhone),
          storeNumber: storeCandidate.storeNumber || candidateStoreNumber,
          storeType: storeCandidate.storeType,
          storeId: storeCandidate._id,
          confidence: storeMatchConfidence ?? storeCandidate.confidence ?? 1,
          matchReason: storeMatchReason
        } : (candidateName || candidatePhone || candidateAddress) ? {
          name: candidateName || 'Unknown Store',
          address: candidateAddress || {},
          phone: candidatePhone,
          phoneNormalized: normalizedPhone,
          storeNumber: candidateStoreNumber,
          storeType: candidateStoreType,
          confidence: storeMatchConfidence ?? 0.2,
          matchReason: storeMatchReason || 'parsed_store_data'
        } : null,
        items,
        warnings: matchedItems.filter(it => it.needsReview).map(it => it.reviewReason).filter(Boolean),
        metadata: {
          ...(storeMatchResult?.topCandidates?.length ? {
            storeMatchCandidates: storeMatchResult.topCandidates,
            storeMatchAmbiguous: Boolean(storeMatchResult?.ambiguous)
          } : {})
        }
      }
    });

    await recordAuditLog({
      type: 'receipt_parse',
      actorId,
      details: `captureId=${capture._id} items=${matchedItems.length} needsReview=${needsReview}`
    });

    return job;
  } catch (err) {
    const failureDetails = parseFailureDetails ?? classifyParseError(err);
    parseFailureDetails = failureDetails;
    capture.status = 'failed';
    capture.parseError = failureDetails.parseError;
    await capture.save();
    const retryAfter = failureDetails.parseErrorType === 'TRANSIENT'
      ? getRetryAfter(capture.parseAttempts || 1)
      : null;

    await transitionReceiptParseJobStatus({
      captureId: capture._id.toString(),
      actor: actorId,
      status: 'FAILED',
      updates: {
        parseError: failureDetails.parseError,
        parseErrorType: failureDetails.parseErrorType,
        retryAfter,
        skippedImages,
        skippedImageReason,
        rawText: failureDetails.parseError
      }
    });

    throw err;
  }
}
