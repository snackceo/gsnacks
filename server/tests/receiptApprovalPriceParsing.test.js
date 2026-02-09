import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUnitPrice, toNumber } from '../routes/receipts.js';

test('toNumber parses currency strings and OCR-like formats', () => {
  assert.equal(toNumber('$2.94'), 2.94);
  assert.equal(toNumber('USD 2.94'), 2.94);
  assert.equal(toNumber('2,94'), 2.94);
  assert.equal(toNumber('  '), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('-1.00'), null);
});

test('resolveUnitPrice prefers valid unitPrice before fallback', () => {
  const value = resolveUnitPrice({
    unitPrice: '$2.94',
    totalPrice: 'USD 10.00',
    quantity: '2'
  });
  assert.equal(value, 2.94);
});

test('resolveUnitPrice falls back to totalPrice/quantity with mixed OCR formats', () => {
  const value = resolveUnitPrice({
    unitPrice: 'N/A',
    totalPrice: 'USD 11,76',
    quantity: '4'
  });
  assert.equal(value, 2.94);
});

test('resolveUnitPrice returns null when both unit and fallback values are unusable', () => {
  const value = resolveUnitPrice({
    unitPrice: '',
    totalPrice: '$0.00',
    quantity: '0'
  });
  assert.equal(value, null);
});
