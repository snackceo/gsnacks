import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateReturnFeeSummary, normalizeUpcCounts } from '../utils/helpers.js';

test('normalizeUpcCounts aggregates mixed UPC inputs', () => {
  const input = [
    '123',
    '123',
    { upc: '456', quantity: 2 },
    { upc: '', quantity: 3 },
    null
  ];

  const result = normalizeUpcCounts(input);

  assert.deepEqual(result.upcCounts, [
    { upc: '123', quantity: 2 },
    { upc: '456', quantity: 2 }
  ]);
  assert.deepEqual(result.uniqueUpcs, ['123', '456']);
  assert.equal(result.flattened.length, 4);
});

test('calculateReturnFeeSummary totals fees by container type', () => {
  const { upcCounts } = normalizeUpcCounts(['123', { upc: '456', quantity: 2 }, '123']);
  const upcEntries = [
    { upc: '123', containerType: 'plastic' },
    { upc: '456', containerType: 'glass' }
  ];

  const summary = calculateReturnFeeSummary(upcCounts, upcEntries, {
    returnHandlingFeePerContainer: 0.02,
    glassHandlingFeePerContainer: 0.02
  });

  assert.equal(summary.totalCount, 4);
  assert.equal(summary.glassCount, 2);
  assert.equal(summary.baseFee, 0.08);
  assert.equal(summary.glassFee, 0.04);
  assert.equal(summary.totalFee, 0.12);
});
