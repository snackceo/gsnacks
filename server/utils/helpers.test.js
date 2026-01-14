import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReturnCountUpdates, normalizeUpcCounts, sumReturnCredits } from './helpers.js';

test('return credits match for counts and flattened UPC payloads', () => {
  const upcEntries = [
    { upc: '000111', depositValue: 0.1, isEligible: true },
    { upc: '000222', depositValue: 0.1, isEligible: true }
  ];
  const countsPayload = [
    { upc: '000111', quantity: 2 },
    { upc: '000222', quantity: 1 }
  ];
  const flattenedPayload = ['000111', '000111', '000222'];

  const countsNormalized = normalizeUpcCounts(countsPayload);
  const flattenedNormalized = normalizeUpcCounts(flattenedPayload);

  const countsCredit = sumReturnCredits(countsNormalized.upcCounts, upcEntries);
  const flattenedCredit = sumReturnCredits(flattenedNormalized.upcCounts, upcEntries);

  assert.equal(countsCredit, flattenedCredit);
});

test('buildReturnCountUpdates backfills missing counts from flattened arrays', () => {
  const order = {
    returnUpcs: ['000111', '000111', '000222'],
    returnUpcCounts: [],
    verifiedReturnUpcs: ['000333', '000333', '000444'],
    verifiedReturnUpcCounts: undefined
  };

  const updates = buildReturnCountUpdates(order);

  assert.deepEqual(updates.returnUpcCounts, [
    { upc: '000111', quantity: 2 },
    { upc: '000222', quantity: 1 }
  ]);
  assert.deepEqual(updates.verifiedReturnUpcCounts, [
    { upc: '000333', quantity: 2 },
    { upc: '000444', quantity: 1 }
  ]);
});

test('buildReturnCountUpdates leaves existing counts untouched', () => {
  const order = {
    returnUpcs: ['000111'],
    returnUpcCounts: [{ upc: '000111', quantity: 3 }],
    verifiedReturnUpcs: ['000222'],
    verifiedReturnUpcCounts: [{ upc: '000222', quantity: 2 }]
  };

  const updates = buildReturnCountUpdates(order);

  assert.deepEqual(updates, {});
});
