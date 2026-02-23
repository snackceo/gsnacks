import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReceiptProductName } from '../utils/receiptNameNormalization.js';

test('normalizes canonical oreo examples', () => {
  assert.equal(normalizeReceiptProductName('Oreo Cookies 14 oz'), 'oreo 14oz');
  assert.equal(normalizeReceiptProductName('OREO 14OZ'), 'oreo 14oz');
  assert.equal(normalizeReceiptProductName('oreo 14 oz'), 'oreo 14oz');
});

test('collapses spaces and strips punctuation/noise', () => {
  assert.equal(normalizeReceiptProductName('  Oreo,,,   14   oz!!!  '), 'oreo 14oz');
  assert.equal(normalizeReceiptProductName('Coke (Zero) 12 oz.'), 'coke zero 12oz');
});
