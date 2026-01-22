/**
 * Receipt item classification utility
 * Classifies items into buckets: A (auto-update), B (review), C (no-match)
 */

import { ClassifiedReceiptItem, ReceiptItemClassification } from '../types';

interface RawReceiptItem {
  receiptName: string;
  quantity: number;
  totalPrice: number;
}

interface ClassificationConfig {
  autoUpdateThreshold?: number; // Confidence threshold for bucket A
  reviewThreshold?: number; // Confidence threshold for bucket B
}

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
  let matchConfidence = 0;

  // Heuristic 1: Price validation
  if (unitPrice < 0.50 || unitPrice > 500) {
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
    matchConfidence = 0.9;
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
    matchConfidence = 0.7;
    classification = 'B';
    reason = 'unconfirmed_match';
  }

  return {
    receiptName: item.receiptName,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
    unitPrice: Number(unitPrice.toFixed(2)),
    classification,
    reason,
    matchConfidence: matchConfidence > 0 ? matchConfidence : undefined
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
    C: classified.filter(item => item.classification === 'C').length
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
    }
  };

  return info[classification];
}
