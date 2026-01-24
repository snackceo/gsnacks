/**
 * Receipt item classification utility
 * Classifies items into buckets: A (auto-update), B (review), C (no-match), D (noise)
 */

import { ClassifiedReceiptItem, ReceiptItemClassification } from '../types';

interface RawReceiptItem {
  receiptName: string;
  normalizedName?: string;
  quantity: number;
  totalPrice: number;
  tokens?: ClassifiedReceiptItem['tokens'];
  priceDelta?: ClassifiedReceiptItem['priceDelta'];
  matchHistory?: ClassifiedReceiptItem['matchHistory'];
  suggestedProduct?: ClassifiedReceiptItem['suggestedProduct'];
  matchConfidence?: ClassifiedReceiptItem['matchConfidence'];
  matchMethod?: ClassifiedReceiptItem['matchMethod'];
  isNoiseRule?: ClassifiedReceiptItem['isNoiseRule'];
}

interface ClassificationConfig {
  autoUpdateThreshold?: number; // Confidence threshold for bucket A
  reviewThreshold?: number; // Confidence threshold for bucket B
}

const noisePattern = /\b(coupon|discount|savings|tax|taxes|sales\s*tax|subtotal|sub\s*total)\b/i;

/**
 * Classify a single receipt item
 * @param item - Raw receipt item from Gemini
 * @param config - Classification thresholds
 * @returns Classified item
 */
export function classifyItem(
  item: RawReceiptItem,
  config: ClassificationConfig = {}
): ClassifiedReceiptItem {
  const {
    autoUpdateThreshold = 0.85,
    reviewThreshold = 0.5
  } = config;

  const unitPrice = item.totalPrice / item.quantity;

  // For now, use simple heuristics
  // In production, this would call product lookup APIs
  let classification: ReceiptItemClassification;
  let reason: string;
  const hasProvidedConfidence = typeof item.matchConfidence === 'number';
  let matchConfidence = hasProvidedConfidence ? item.matchConfidence : 0;

  // Heuristic 0: Explicit noise rule
  if (item.isNoiseRule) {
    classification = 'D';
    reason = 'noise_rule';
  }
  // Heuristic 1: Noise lines (coupons, taxes, subtotals)
  else if (isNoiseItem(item.receiptName, item.normalizedName, item.totalPrice)) {
    classification = 'D';
    reason = 'noise_item';
  }
  // Heuristic 1: Price validation
  else if (unitPrice < 0.50 || unitPrice > 500) {
    classification = 'C';
    reason = 'price_out_of_range';
  }
  // Heuristic 2: Item name length and quality
  else if (item.receiptName.length < 3) {
    classification = 'C';
    reason = 'name_too_short';
  }
  // Heuristic 3: Common brand keywords
  else if (isCommonBrand(item.receiptName)) {
    if (!hasProvidedConfidence) {
      matchConfidence = 0.9;
    }
    classification = matchConfidence >= autoUpdateThreshold ? 'A' : 'B';
    reason = 'common_brand_match';
  }
  // Heuristic 4: Full UPC-like names
  else if (/^\d+$/.test(item.receiptName.trim())) {
    classification = 'C';
    reason = 'upc_only_no_name';
  }
  // Default: Medium confidence - needs review
  else {
    if (!hasProvidedConfidence) {
      matchConfidence = 0.7;
    }
    classification = 'B';
    reason = 'unconfirmed_match';
  }

  const resolvedMatchConfidence =
    typeof item.matchConfidence === 'number'
      ? item.matchConfidence
      : matchConfidence > 0
        ? matchConfidence
        : undefined;

  return {
    receiptName: item.receiptName,
    normalizedName: item.normalizedName,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    unitPrice: Number(unitPrice.toFixed(2)),
    classification,
    reason,
    tokens: item.tokens,
    priceDelta: item.priceDelta,
    matchHistory: item.matchHistory,
    suggestedProduct: item.suggestedProduct,
    matchConfidence: resolvedMatchConfidence,
    matchMethod: item.matchMethod,
    isNoiseRule: item.isNoiseRule
  };
}

/**
 * Classify multiple receipt items
 * @param items - Raw receipt items from Gemini
 * @param config - Classification thresholds
 * @returns Array of classified items with bucket counts
 */
export function classifyItems(
  items: RawReceiptItem[],
  config: ClassificationConfig = {}
) {
  const classified = items.map(item => classifyItem(item, config));

  const bucketCounts = {
    A: classified.filter(item => item.classification === 'A').length,
    B: classified.filter(item => item.classification === 'B').length,
    C: classified.filter(item => item.classification === 'C').length,
    D: classified.filter(item => item.classification === 'D').length
  };

  return {
    items: classified,
    bucketCounts
  };
}

/**
 * Check if item name contains common brand keywords
 */
function isCommonBrand(name: string): boolean {
  const commonBrands = [
    'coca cola',
    'pepsi',
    'sprite',
    'fanta',
    'mountain dew',
    'gatorade',
    'powerade',
    'tropicana',
    'orange juice',
    'apple juice',
    'lays',
    'doritos',
    'cheetos',
    'fritos',
    'pringles',
    'cheez-it',
    'nabisco',
    'heinz',
    'campbell',
    'progresso',
    'dole',
    'del monte',
    'kellogg',
    'cheerios',
    'frosted flakes',
    'froot loops',
    'raisin bran',
    'white castle',
    'jimmy dean',
    'tyson',
    'perdue',
    'boneless',
    'skinless',
    'butter',
    'milk',
    'eggs',
    'bread',
    'yogurt',
    'cheese',
    'deli'
  ];

  const lowerName = name.toLowerCase();
  return commonBrands.some(brand => lowerName.includes(brand));
}

/**
 * Check if item is a non-product line like coupons, taxes, or subtotals
 */
function isNoiseItem(receiptName: string, normalizedName: string | undefined, totalPrice: number): boolean {
  const combinedName = [receiptName, normalizedName]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ');

  if (!combinedName) return false;

  if (noisePattern.test(combinedName)) return true;

  const lowerName = combinedName.toLowerCase();
  if (totalPrice <= 0 && /\b(coupon|discount|savings)\b/i.test(lowerName)) {
    return true;
  }

  return false;
}

/**
 * Get bucket display info
 */
export function getBucketInfo(classification: ReceiptItemClassification) {
  const info: Record<ReceiptItemClassification, { label: string; color: string; description: string }> = {
    A: {
      label: 'Auto-Update OK',
      color: 'bg-green-500/20 border-green-500/50',
      description: 'High confidence - will be auto-added to inventory'
    },
    B: {
      label: 'Needs Review',
      color: 'bg-yellow-500/20 border-yellow-500/50',
      description: 'Medium confidence - requires manual confirmation'
    },
    C: {
      label: 'No Match',
      color: 'bg-red-500/20 border-red-500/50',
      description: 'Low confidence - manual entry or skip'
    },
    D: {
      label: 'Noise / Non-Product',
      color: 'bg-slate-500/20 border-slate-500/50',
      description: 'Coupons, taxes, and subtotals that should not hit inventory'
    }
  };

  return info[classification];
}
