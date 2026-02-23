import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateRetail } from './pricing.js';

test('calculateRetail applies multiplier and rounds to .99', () => {
  const retail = calculateRetail(3.5, { multiplier: 1.2 });
  assert.equal(retail, 4.99);
});

test('calculateRetail enforces min and max guardrails', () => {
  assert.equal(calculateRetail(0.2, { multiplier: 1, minRetail: 0.99 }), 0.99);
  assert.equal(calculateRetail(500, { multiplier: 3, maxRetail: 999.99 }), 999.99);
});

test('calculateRetail handles null/invalid cost values', () => {
  assert.equal(calculateRetail(null), null);
  assert.equal(calculateRetail(undefined), null);
  assert.equal(calculateRetail(-2), null);
});
