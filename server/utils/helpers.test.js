import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUpcCounts, sumReturnCredits } from './helpers.js';

test('return credits match for counts and flattened UPC payloads', () => {
  const upcEntries = [
    { upc: '000111', depositValue: 0.1, isEligible: true },
    { upc: '000222', depositValue: 0.05, isEligible: true }
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
