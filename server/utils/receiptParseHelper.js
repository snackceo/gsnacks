// receiptParseHelper.js
// Shared parsing logic for receipt-prices route and receiptWorker

import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptNoiseRule from '../models/ReceiptNoiseRule.js';
import Store from '../models/Store.js';
import StoreInventory from '../models/StoreInventory.js';
import UpcItem from '../models/UpcItem.js';
import Product from '../models/Product.js';
import { recordAuditLog } from './audit.js';
import { transitionReceiptParseJobStatus } from './receiptParseJobStatus.js';
import { inferStoreType, matchStoreCandidate, normalizePhone } from './storeMatcher.js';
import { getReceiptLineNormalizedName, normalizeReceiptLineUpc } from './receiptLineResolver.js';
import { getReceiptOcrConfigFromEnv, runReceiptOcrWithFallback } from './receiptOcrProviders/coordinator.js';
import {
  normalizeProviderReceiptItemsWithMetrics,
  normalizeProviderReceiptItems,
  parseGeminiJsonPayload,
  recoverItemsFromRawText,
  sanitizeReceiptNumber
} from './receiptOcrProviders/shared.js';

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

// Canonical normalize receipt name for matching
const normalizeReceiptName = getReceiptLineNormalizedName;

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
        .map(item => normalizeReceiptLineUpc(item.upc))
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
    const normalized = getReceiptLineNormalizedName(item.receiptName);
    const itemUpc = normalizeReceiptLineUpc(item.upc);
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
      
      const productNorm = getReceiptLineNormalizedName(product.name);
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
  recoverItemsFromRawText,
  normalizeProviderReceiptItems,
  normalizeProviderReceiptItemsWithMetrics,
  buildParseQualityMetrics,
  getReceiptQualityThreshold
};

const getReceiptOcrProviderSelection = options => ({
  primaryProvider: options.primaryProvider || process.env.RECEIPT_OCR_PRIMARY_PROVIDER || 'gemini',
  fallbackProvider: options.fallbackProvider || process.env.RECEIPT_OCR_FALLBACK_PROVIDER || 'vision'
});

function getReceiptQualityThreshold(options) {
  const rawThreshold = options.qualityScoreThreshold ?? process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD;
  const parsedThreshold = Number(rawThreshold);
  if (Number.isFinite(parsedThreshold)) {
    return Math.min(1, Math.max(0, parsedThreshold));
  }
  return 0.6;
}

function buildParseQualityMetrics({
  ocrOutput,
  normalizedProviderItems,
  validStructuredLineCount,
  invalidPriceSkippedLines,
  imageCount
}) {
  const extractedLineCount = Array.isArray(normalizedProviderItems) ? normalizedProviderItems.length : 0;
  const malformedJsonCount = (ocrOutput?.parseStageFailures?.invalid_json || 0) + (ocrOutput?.parseStageFailures?.no_items || 0);
  const denominator = Math.max(1, imageCount || 0);
  const malformedRate = Math.min(1, malformedJsonCount / denominator);
  const skippedImageCount = ocrOutput?.skippedImages?.length || 0;
  const skippedRate = Math.min(1, skippedImageCount / denominator);
  const validLineRate = extractedLineCount > 0
    ? Math.min(1, validStructuredLineCount / extractedLineCount)
    : 0;
  const extractedSignal = Math.min(1, extractedLineCount / 4);

  const qualityScore = Number((
    (validLineRate * 0.45) +
    (extractedSignal * 0.20) +
    ((1 - malformedRate) * 0.20) +
    ((1 - skippedRate) * 0.15)
  ).toFixed(4));

  return {
    extractedLineCount,
    linesWithValidQtyPrice: validStructuredLineCount,
    invalidPriceSkippedLines,
    malformedStructureRate: Number(malformedRate.toFixed(4)),
    skippedImageCount,
    qualityScore
  };
}

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
  const qualityThreshold = getReceiptQualityThreshold(options);
  const parseStageFailures = {
    invalid_json: 0,
    no_items: 0,
    all_images_skipped: 0
  };
  const stageMetrics = {
    ocrLinesExtracted: 0,
    linesWithValidQtyPrice: 0,
    upcResolvedCount: 0,
    nameResolvedCount: 0,
    unmatchedCount: 0,
    observationWritesCount: 0
  };

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

  capture.markParsing();
  await capture.save();
  await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor: actorId,
    status: 'PARSING'
  });

  const parseStartedAtMs = Date.now();

  try {
    const draftItems = [];
    const providerSelection = getReceiptOcrProviderSelection(options);
    const ocrQualityConfig = {
      ...getReceiptOcrConfigFromEnv(),
      ...(options.ocrQualityConfig || {})
    };
    const runOcr = async providerSelectionInput => runReceiptOcrWithFallback({
      images: capture.images,
      primary: providerSelectionInput.primaryProvider,
      fallback: providerSelectionInput.fallbackProvider,
      qualityConfig: ocrQualityConfig
    });
    let ocrRun = await runOcr(providerSelection);
    let ocrOutput = ocrRun.result;
    let normalizationResult = normalizeProviderReceiptItemsWithMetrics(ocrOutput.items || []);
    let normalizedProviderItems = normalizationResult.items;
    let validStructuredLineCount = normalizedProviderItems.filter(item => {
      const parsedTotal = sanitizeReceiptNumber(item.totalPrice);
      const parsedUnit = sanitizeReceiptNumber(item.unitPrice);
      const parsedQty = sanitizeReceiptNumber(item.quantity);
      const hasTotal = typeof parsedTotal === 'number' && Number.isFinite(parsedTotal) && parsedTotal > 0;
      const hasUnit = typeof parsedUnit === 'number' && Number.isFinite(parsedUnit) && parsedUnit > 0;
      const hasQty = typeof parsedQty === 'number' && Number.isFinite(parsedQty) && parsedQty > 0;
      return Boolean(item.receiptName && (hasTotal || (hasUnit && hasQty)));
    }).length;

    let qualityMetrics = buildParseQualityMetrics({
      ocrOutput,
      normalizedProviderItems,
      validStructuredLineCount,
      invalidPriceSkippedLines: 0,
      imageCount: capture.images?.length || 0
    });
    let fallbackTriggered = false;
    const shouldRetryStructuring = qualityMetrics.qualityScore < qualityThreshold;
    const canRetryWithAlternateProvider = providerSelection.primaryProvider !== providerSelection.fallbackProvider;
    let qualityScoreBeforeFallback = qualityMetrics.qualityScore;

    if (shouldRetryStructuring && canRetryWithAlternateProvider) {
      fallbackTriggered = true;
      const alternateSelection = {
        primaryProvider: providerSelection.fallbackProvider,
        fallbackProvider: providerSelection.primaryProvider
      };
      const alternateRun = await runOcr(alternateSelection);
      const alternateOutput = alternateRun.result;
      const alternateNormalization = normalizeProviderReceiptItemsWithMetrics(alternateOutput.items || []);
      const alternateItems = alternateNormalization.items;
      const alternateValidStructuredLineCount = alternateItems.filter(item => {
        const parsedTotal = sanitizeReceiptNumber(item.totalPrice);
        const parsedUnit = sanitizeReceiptNumber(item.unitPrice);
        const parsedQty = sanitizeReceiptNumber(item.quantity);
        const hasTotal = typeof parsedTotal === 'number' && Number.isFinite(parsedTotal) && parsedTotal > 0;
        const hasUnit = typeof parsedUnit === 'number' && Number.isFinite(parsedUnit) && parsedUnit > 0;
        const hasQty = typeof parsedQty === 'number' && Number.isFinite(parsedQty) && parsedQty > 0;
        return Boolean(item.receiptName && (hasTotal || (hasUnit && hasQty)));
      }).length;
      const alternateQualityMetrics = buildParseQualityMetrics({
        ocrOutput: alternateOutput,
        normalizedProviderItems: alternateItems,
        validStructuredLineCount: alternateValidStructuredLineCount,
        invalidPriceSkippedLines: 0,
        imageCount: capture.images?.length || 0
      });

      if (alternateQualityMetrics.qualityScore >= qualityMetrics.qualityScore) {
        ocrRun = {
          ...alternateRun,
          attempts: [...(ocrRun.attempts || []), ...(alternateRun.attempts || [])],
          fallbackReason: ocrRun.fallbackReason || 'quality_score_below_threshold'
        };
        ocrOutput = alternateOutput;
        normalizationResult = alternateNormalization;
        normalizedProviderItems = alternateItems;
        validStructuredLineCount = alternateValidStructuredLineCount;
        qualityMetrics = alternateQualityMetrics;
      } else {
        ocrRun = {
          ...ocrRun,
          attempts: [...(ocrRun.attempts || []), ...(alternateRun.attempts || [])],
          fallbackReason: ocrRun.fallbackReason || 'quality_score_below_threshold'
        };
      }
    }

    const geminiOutput = {
      provider: ocrRun.providerUsed,
      rawTextByImage: ocrOutput.rawTextByImage || [],
      parsedByImage: ocrOutput.parsedByImage || [],
      skippedImages: ocrOutput.skippedImages || [],
      confidenceMetadata: ocrOutput.confidenceMetadata || null,
      blockCoordinates: ocrOutput.blockCoordinates || null,
      attempts: ocrRun.attempts || []
    };
    const storeCandidateData = { ...(ocrOutput.storeCandidateData || {}) };

    parseStageFailures.invalid_json = ocrOutput.parseStageFailures?.invalid_json || 0;
    parseStageFailures.no_items = ocrOutput.parseStageFailures?.no_items || 0;
    parseStageFailures.all_images_skipped = ocrOutput.parseStageFailures?.all_images_skipped || 0;

    for (const item of normalizedProviderItems) {
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

        const upc = normalizeReceiptLineUpc(item.upc);
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
    qualityMetrics = buildParseQualityMetrics({
      ocrOutput,
      normalizedProviderItems,
      validStructuredLineCount: draftItems.length,
      invalidPriceSkippedLines,
      imageCount: capture.images?.length || 0
    });

    stageMetrics.ocrLinesExtracted = qualityMetrics.extractedLineCount;
    stageMetrics.linesWithValidQtyPrice = qualityMetrics.linesWithValidQtyPrice;

    skippedImages = geminiOutput.skippedImages;
    skippedImageReason = geminiOutput.skippedImages.map(skip => skip.reason).filter(Boolean);

    if (geminiOutput.skippedImages.length === capture.images.length) {
      parseStageFailures.all_images_skipped += 1;
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

    console.info('Receipt parse stage failures.', {
      captureId: capture._id?.toString?.() || String(capture._id || captureId),
      jobId: null,
      ...parseStageFailures
    });

    if (!storeCandidateData.storeType && storeCandidateData.name) {
      storeCandidateData.storeType = inferStoreType(storeCandidateData.name);
    }

    // Match items to products
    const matchedItems = await matchReceiptItems(draftItems, capture.storeId);
    for (const item of matchedItems) {
      const hasSuggestedProduct = Boolean(item?.suggestedProduct?.id);
      const hasUpc = Boolean(normalizeReceiptLineUpc(item?.upc));
      if (!hasSuggestedProduct) {
        stageMetrics.unmatchedCount += 1;
      } else if (hasUpc) {
        stageMetrics.upcResolvedCount += 1;
      } else {
        stageMetrics.nameResolvedCount += 1;
      }
    }
    const matchedLines = matchedItems.filter(item => item?.suggestedProduct?.id).length;
    const unmatchedLines = matchedItems.length - matchedLines;

    if (isReceiptParseDebugEnabled()) {
      console.info('Receipt parse debug matched items.', {
        captureId: capture._id?.toString?.() || String(capture._id || captureId),
        jobId: null,
        stageMetrics,
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
      jobId: null,
      totalLines,
      matchedLines,
      unmatchedLines,
      invalidPriceSkippedLines,
      stageMetrics
    });

    capture.markParsed(matchedItems);
    capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
    capture.parseMetrics = {
      providerAttempted: ocrRun?.attempts?.[0]?.provider || providerSelection.primaryProvider || null,
      providerUsed: ocrRun?.providerUsed || null,
      fallbackReason: ocrRun?.fallbackReason || null,
      parseDurationMs: Math.max(0, Date.now() - parseStartedAtMs),
      validItemCount: stageMetrics.linesWithValidQtyPrice || 0,
      unmatchedCount: stageMetrics.unmatchedCount || 0
    };
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
      nameCandidate: getReceiptLineNormalizedName(item),
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
          providerAttempted: ocrRun?.attempts?.[0]?.provider || providerSelection.primaryProvider || null,
          providerUsed: ocrRun.providerUsed,
          fallbackReason: ocrRun.fallbackReason,
          parseDurationMs: Math.max(0, Date.now() - parseStartedAtMs),
          validItemCount: stageMetrics.linesWithValidQtyPrice,
          unmatchedCount: stageMetrics.unmatchedCount,
          normalizationMetrics: normalizationResult.metrics,
          ocrAttempts: ocrRun.attempts || [],
          ocrConfig: {
            primaryProvider: providerSelection.primaryProvider,
            fallbackProvider: providerSelection.fallbackProvider,
            qualityConfig: ocrQualityConfig
          },
          parseQuality: {
            extractedLineCount: qualityMetrics.extractedLineCount,
            linesWithValidQtyPrice: qualityMetrics.linesWithValidQtyPrice,
            malformedStructureRate: qualityMetrics.malformedStructureRate,
            skippedImageCount: qualityMetrics.skippedImageCount,
            invalidPriceSkippedLines: qualityMetrics.invalidPriceSkippedLines,
            qualityScore: qualityMetrics.qualityScore,
            qualityScoreThreshold: qualityThreshold,
            qualityScoreBeforeFallback,
            fallbackTriggered
          },
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
      details: `captureId=${capture._id} jobId=${job?._id?.toString?.() || 'unknown'} items=${matchedItems.length} needsReview=${needsReview} providerAttempted=${ocrRun?.attempts?.[0]?.provider || providerSelection.primaryProvider || 'unknown'} providerUsed=${ocrRun?.providerUsed || 'unknown'} fallbackReason=${ocrRun?.fallbackReason || 'none'} parseDurationMs=${Math.max(0, Date.now() - parseStartedAtMs)} ocrLinesExtracted=${stageMetrics.ocrLinesExtracted} linesWithValidQtyPrice=${stageMetrics.linesWithValidQtyPrice} upcResolvedCount=${stageMetrics.upcResolvedCount} nameResolvedCount=${stageMetrics.nameResolvedCount} unmatchedCount=${stageMetrics.unmatchedCount} observationWritesCount=${stageMetrics.observationWritesCount}`
    });

    return job;
  } catch (err) {
    const failureDetails = parseFailureDetails ?? classifyParseError(err);
    parseFailureDetails = failureDetails;
    console.warn('Receipt parse failed with stage counters.', {
      captureId: capture._id?.toString?.() || String(capture._id || captureId),
      jobId: null,
      ...parseStageFailures,
      stageMetrics,
      parseError: failureDetails.parseError,
      parseErrorType: failureDetails.parseErrorType
    });
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
