import assert from 'node:assert/strict';
import test from 'node:test';

import { runReceiptOcrWithFallback } from '../utils/receiptOcrProviders/coordinator.js';

const okResult = ({ items = [{ receiptName: 'A', totalPrice: 1, quantity: 1 }], invalidJsonRate = 0, skippedImages = [] } = {}) => ({
  items,
  skippedImages,
  parseStageFailures: { all_images_skipped: 0 },
  confidenceMetadata: { invalidJsonRate }
});

test('uses primary provider when output quality is sufficient', async () => {
  const result = await runReceiptOcrWithFallback({
    images: [{ url: 'data:image/jpeg;base64,abc' }],
    primary: 'gemini',
    fallback: 'vision',
    providers: {
      gemini: async () => okResult(),
      vision: async () => {
        throw new Error('fallback should not run');
      }
    }
  });

  assert.equal(result.providerUsed, 'gemini');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.attempts.length, 1);
});

test('falls back when primary returns low quality', async () => {
  const result = await runReceiptOcrWithFallback({
    images: [{ url: 'data:image/jpeg;base64,abc' }],
    primary: 'gemini',
    fallback: 'vision',
    providers: {
      gemini: async () => okResult({ items: [], invalidJsonRate: 0.8 }),
      vision: async () => okResult({ items: [{ receiptName: 'B', totalPrice: 3, quantity: 1 }] })
    }
  });

  assert.equal(result.providerUsed, 'vision');
  assert.equal(result.fallbackReason, 'no_items_extracted');
  assert.equal(result.attempts[0].status, 'low_quality');
  assert.equal(result.attempts[1].status, 'success');
});

test('falls back when primary provider throws', async () => {
  const result = await runReceiptOcrWithFallback({
    images: [{ url: 'data:image/jpeg;base64,abc' }],
    primary: 'gemini',
    fallback: 'vision',
    providers: {
      gemini: async () => {
        throw new Error('rate limit');
      },
      vision: async () => okResult({ items: [{ receiptName: 'C', totalPrice: 5, quantity: 1 }] })
    }
  });

  assert.equal(result.providerUsed, 'vision');
  assert.equal(result.fallbackReason, 'primary_provider_error');
  assert.equal(result.attempts[0].status, 'error');
  assert.equal(result.attempts[1].status, 'success');
});

test('quality thresholds are configurable', async () => {
  const result = await runReceiptOcrWithFallback({
    images: [{ url: 'data:image/jpeg;base64,abc' }],
    primary: 'gemini',
    fallback: 'vision',
    qualityConfig: { minItemCount: 0, invalidJsonRateThreshold: 0.95 },
    providers: {
      gemini: async () => okResult({ items: [], invalidJsonRate: 0.8 }),
      vision: async () => {
        throw new Error('fallback should not run');
      }
    }
  });

  assert.equal(result.providerUsed, 'gemini');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.attempts.length, 1);
});


test('throws when primary provider is unknown', async () => {
  await assert.rejects(
    () =>
      runReceiptOcrWithFallback({
        images: [{ url: 'data:image/jpeg;base64,abc' }],
        primary: 'unknown_primary',
        fallback: 'vision',
        providers: {
          vision: async () => okResult()
        }
      }),
    /Unknown primary OCR provider/
  );
});

test('throws when fallback provider is unknown', async () => {
  await assert.rejects(
    () =>
      runReceiptOcrWithFallback({
        images: [{ url: 'data:image/jpeg;base64,abc' }],
        primary: 'gemini',
        fallback: 'unknown_fallback',
        providers: {
          gemini: async () => okResult()
        }
      }),
    /Unknown fallback OCR provider/
  );
});

test('rethrows primary error when fallback is disabled', async () => {
  await assert.rejects(
    () =>
      runReceiptOcrWithFallback({
        images: [{ url: 'data:image/jpeg;base64,abc' }],
        primary: 'gemini',
        fallback: 'vision',
        qualityConfig: { enableFallback: false },
        providers: {
          gemini: async () => {
            throw new Error('rate limit');
          },
          vision: async () => okResult()
        }
      }),
    /rate limit/
  );
});
