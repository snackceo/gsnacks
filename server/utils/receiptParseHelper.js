// receiptParseHelper.js
// Shared parsing logic for receipt-prices route and receiptWorker

import { GoogleGenAI } from '@google/genai';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import Store from '../models/Store.js';
import StoreInventory from '../models/StoreInventory.js';
import { recordAuditLog } from './audit.js';

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

const normalizePhone = (phone = '') => phone.replace(/\D+/g, '');
const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parseReceiptAddress = (rawAddress = '') => {
  if (!rawAddress) return {};
  const cleaned = rawAddress.trim();
  const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZip = parts.slice(2).join(' ');
    const stateZipMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
    const state = stateZipMatch?.[1]?.toUpperCase();
    const zip = stateZipMatch?.[2];
    return {
      street,
      city,
      state,
      zip
    };
  }
  console.warn('Receipt address parse incomplete; storing street only.', { rawAddress });
  return { street: cleaned };
};

// Normalize receipt name for matching
function normalizeReceiptName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/gi, '');
}

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

  const matchedItems = [];

  for (const item of items) {
    const normalized = normalizeReceiptName(item.receiptName);
    
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

export async function executeReceiptParse(captureId, actorId = 'worker', options = {}) {
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw new Error('Receipt capture not found');
  }

  let parseFailureDetails = null;
  let skippedImages = [];
  let skippedImageReason = [];

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
    await ReceiptParseJob.findOneAndUpdate(
      { captureId: capture._id.toString() },
      {
        captureId: capture._id.toString(),
        status: 'FAILED',
        parseError: failureDetails.parseError,
        parseErrorType: failureDetails.parseErrorType,
        retryAfter
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    throw new Error(apiReady.error);
  }

  capture.markParsing();
  await capture.save();

  try {
    const draftItems = [];
    const geminiOutput = { rawTextByImage: [], parsedByImage: [], skippedImages: [] };
    const storeCandidateData = {};

    // Parse each image
    for (const image of capture.images) {
      let geminiImageContent;

      // Prepare image for Gemini
      if (image.url.startsWith('https://') && image.url.includes('cloudinary')) {
        geminiImageContent = { url: image.url };
      } else if (image.url.startsWith('data:')) {
        const match = image.url.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          geminiOutput.skippedImages.push({ url: image.url, reason: 'invalid_data_url' });
          continue;
        }
        geminiImageContent = {
          inline_data: {
            data: match[2],
            mime_type: match[1]
          }
        };
      } else {
        geminiOutput.skippedImages.push({ url: image.url, reason: 'unsupported_image_url' });
        continue;
      }

      // Gemini prompt for receipt parsing
      const prompt = `You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE NAME, PHONE, and ADDRESS if visible at the top or bottom of receipt. Return them as:
"storeName": "Store Name" (or null if not visible)
"phone": "555-123-4567" (or null if not visible)
"address": "123 Main St, City, ST 12345"  (or null if not visible)

THEN, extract ALL line items with prices. Return ONLY valid JSON format:
{
  "storeName": "STORE NAME",
  "phone": "555-123-4567",
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store name, phone, and address if visible (street, city, state, zip)
2. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment, instructions)
3. Use exact product names from receipt
4. For multi-buy items, calculate quantity * unit price = totalPrice
5. Skip discounts, coupons, tax lines
6. Return empty array [] for items if none found
7. Return ONLY valid JSON, no markdown, no explanation`;

      // Call Gemini Vision API
      const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
      const response = await ai.models.generateContent({
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

      const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      geminiOutput.rawTextByImage.push(text);

      // Parse Gemini JSON response
      let parsed = null;
      try {
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        console.warn('Failed to parse Gemini JSON:', text.substring(0, 200));
        geminiOutput.parsedByImage.push({ error: 'Invalid JSON' });
        continue;
      }

      geminiOutput.parsedByImage.push(parsed);

      if (parsed.storeName && !storeCandidateData.name) {
        storeCandidateData.name = parsed.storeName;
      }
      if (parsed.phone && !storeCandidateData.phone) {
        storeCandidateData.phone = parsed.phone;
      }
      if (parsed.address && !storeCandidateData.address) {
        storeCandidateData.address = parseReceiptAddress(parsed.address);
      }

      // Add items from this image
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          if (item.receiptName && item.totalPrice) {
            draftItems.push({
              receiptName: item.receiptName,
              quantity: item.quantity || 1,
              totalPrice: item.totalPrice,
              unitPrice: item.totalPrice / (item.quantity || 1)
            });
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

    // Match items to products
    const matchedItems = await matchReceiptItems(draftItems, capture.storeId);

    capture.markParsed(matchedItems);
    capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
    await capture.save();

    // Create ReceiptParseJob for review/approval
    const candidateName = capture.storeName || storeCandidateData.name;
    const candidatePhone = storeCandidateData.phone;
    const candidateAddress = storeCandidateData.address;
    const normalizedPhone = normalizePhone(candidatePhone);

    let storeCandidate = null;
    let storeMatchReason = null;
    let storeMatchConfidence = null;
    const storeFromCapture = capture.storeId ? await Store.findById(capture.storeId).lean() : null;
    if (storeFromCapture) {
      storeCandidate = storeFromCapture;
      storeMatchReason = 'capture_store';
      storeMatchConfidence = 1;
    } else {
      let matchedStore = null;
      let matchConfidence = 0;
      let matchReason = null;
      if (normalizedPhone) {
        matchedStore = await Store.findOne({ phone: { $regex: normalizedPhone, $options: 'i' } }).lean();
        matchConfidence = matchedStore ? 0.9 : 0;
        matchReason = matchedStore ? 'phone_match' : null;
      }
      if (!matchedStore && candidateName) {
        matchedStore = await Store.findOne({
          name: { $regex: `^${escapeRegex(candidateName)}$`, $options: 'i' }
        }).lean();
        matchConfidence = matchedStore ? 0.75 : 0;
        matchReason = matchedStore ? 'name_match' : null;
      }
      if (matchedStore) {
        storeCandidate = { ...matchedStore, confidence: matchConfidence };
        storeMatchReason = matchReason;
        storeMatchConfidence = matchConfidence;
      } else if (candidateName || candidatePhone || candidateAddress) {
        storeCandidate = {
          name: candidateName || 'Unknown Store',
          phone: candidatePhone,
          address: candidateAddress || {},
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
      upcCandidate: item.suggestedProduct?.upc,
      requiresUpc: !item.suggestedProduct?.upc,
      match: {
        productId: item.suggestedProduct?.id,
        confidence: item.matchConfidence,
        reason: item.matchMethod
      },
      actionSuggestion: item.suggestedProduct ? 'LINK_UPC_TO_PRODUCT' : 'CREATE_PRODUCT',
      warnings: item.needsReview && item.reviewReason ? [item.reviewReason] : []
    }));

    const needsReview = items.some(it => it.warnings?.length);
    const job = await ReceiptParseJob.findOneAndUpdate(
      { captureId: capture._id.toString() },
      {
        captureId: capture._id.toString(),
        status: needsReview ? 'NEEDS_REVIEW' : 'PARSED',
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
          storeType: storeCandidate.storeType,
          storeId: storeCandidate._id,
          confidence: storeMatchConfidence ?? storeCandidate.confidence ?? 1,
          matchReason: storeMatchReason
        } : (candidateName || candidatePhone || candidateAddress) ? {
          name: candidateName || 'Unknown Store',
          address: candidateAddress || {},
          phone: candidatePhone,
          confidence: storeMatchConfidence ?? 0.2,
          matchReason: storeMatchReason || 'parsed_store_data'
        } : null,
        items,
        warnings: matchedItems.filter(it => it.needsReview).map(it => it.reviewReason).filter(Boolean)
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

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

    await ReceiptParseJob.findOneAndUpdate(
      { captureId: capture._id.toString() },
      {
        captureId: capture._id.toString(),
        status: 'FAILED',
        parseError: failureDetails.parseError,
        parseErrorType: failureDetails.parseErrorType,
        retryAfter,
        skippedImages,
        skippedImageReason,
        rawText: failureDetails.parseError
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    throw err;
  }
}
