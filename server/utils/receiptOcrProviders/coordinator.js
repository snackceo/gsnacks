import { geminiProvider } from './geminiProvider.js';
import { visionProvider } from './visionProvider.js';

const DEFAULT_QUALITY_CONFIG = {
  minItemCount: 1,
  invalidJsonRateThreshold: 0.5,
  minItemCountWhenImagesSkipped: 2,
  enableFallback: true
};

const PROVIDERS = {
  gemini: geminiProvider,
  vision: visionProvider
};

const toNumberOrDefault = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBooleanOrDefault = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

export const getReceiptOcrConfigFromEnv = () => ({
  minItemCount: toNumberOrDefault(process.env.RECEIPT_OCR_MIN_ITEMS, DEFAULT_QUALITY_CONFIG.minItemCount),
  invalidJsonRateThreshold: toNumberOrDefault(process.env.RECEIPT_OCR_INVALID_JSON_THRESHOLD, DEFAULT_QUALITY_CONFIG.invalidJsonRateThreshold),
  minItemCountWhenImagesSkipped: toNumberOrDefault(process.env.RECEIPT_OCR_SKIPPED_MIN_ITEMS, DEFAULT_QUALITY_CONFIG.minItemCountWhenImagesSkipped),
  enableFallback: toBooleanOrDefault(process.env.RECEIPT_OCR_ENABLE_FALLBACK, DEFAULT_QUALITY_CONFIG.enableFallback)
});

const isLowQualityResult = (result, qualityConfig) => {
  const itemCount = result?.items?.length || 0;
  const skippedCount = result?.skippedImages?.length || 0;
  const allSkipped = result?.parseStageFailures?.all_images_skipped > 0;
  const invalidJsonRate = result?.confidenceMetadata?.invalidJsonRate;

  if (allSkipped) return 'all_images_skipped';
  if (itemCount < qualityConfig.minItemCount) return 'no_items_extracted';
  if (typeof invalidJsonRate === 'number' && invalidJsonRate >= qualityConfig.invalidJsonRateThreshold) return 'high_invalid_json_rate';
  if (skippedCount > 0 && itemCount < qualityConfig.minItemCountWhenImagesSkipped) return 'partial_images_and_low_items';
  return null;
};

export async function runReceiptOcrWithFallback({
  images,
  primary = 'gemini',
  fallback = 'vision',
  providers = PROVIDERS,
  qualityConfig: qualityConfigInput = {}
}) {
  const qualityConfig = { ...DEFAULT_QUALITY_CONFIG, ...qualityConfigInput };
  const primaryFn = providers[primary];
  const fallbackFn = providers[fallback];

  if (!primaryFn) throw new Error(`Unknown primary OCR provider: ${primary}`);
  if (!fallbackFn) throw new Error(`Unknown fallback OCR provider: ${fallback}`);

  let primaryResult;
  try {
    primaryResult = await primaryFn({ images });
  } catch (error) {
    if (!qualityConfig.enableFallback) {
      throw error;
    }
    const fallbackResult = await fallbackFn({ images });
    return {
      providerUsed: fallback,
      fallbackReason: 'primary_provider_error',
      result: fallbackResult,
      attempts: [
        { provider: primary, status: 'error', reason: error?.message || 'unknown' },
        { provider: fallback, status: 'success', reason: null }
      ]
    };
  }

  const lowQualityReason = isLowQualityResult(primaryResult, qualityConfig);

  if (!lowQualityReason || !qualityConfig.enableFallback) {
    return {
      providerUsed: primary,
      fallbackReason: null,
      result: primaryResult,
      attempts: [{ provider: primary, status: 'success' }]
    };
  }

  try {
    const fallbackResult = await fallbackFn({ images });
    const fallbackLowQualityReason = isLowQualityResult(fallbackResult, qualityConfig);
    const useFallback = !fallbackLowQualityReason || (fallbackResult.items?.length || 0) >= (primaryResult.items?.length || 0);

    return {
      providerUsed: useFallback ? fallback : primary,
      fallbackReason: lowQualityReason,
      result: useFallback ? fallbackResult : primaryResult,
      attempts: [
        { provider: primary, status: 'low_quality', reason: lowQualityReason },
        { provider: fallback, status: fallbackLowQualityReason ? 'low_quality' : 'success', reason: fallbackLowQualityReason || null }
      ]
    };
  } catch (fallbackError) {
    return {
      providerUsed: primary,
      fallbackReason: `${lowQualityReason}_fallback_error`,
      result: primaryResult,
      attempts: [
        { provider: primary, status: 'low_quality', reason: lowQualityReason },
        { provider: fallback, status: 'error', reason: fallbackError?.message || 'unknown' }
      ]
    };
  }
}
