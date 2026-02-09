import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUnmappedProductUpsert } from '../routes/receipts.js';

test('unmapped upsert keeps rawName insert-only and updates last-seen fields', () => {
  const storeId = 'store-1';
  const normalizedName = 'COKE 20 OZ';
  const firstSeenAt = new Date('2026-01-01T00:00:00.000Z');

  const first = buildUnmappedProductUpsert({
    storeId,
    normalizedName,
    rawName: 'Coke 20 Oz',
    now: firstSeenAt,
    session: null
  });

  assert.equal(first.query.storeId, storeId);
  assert.equal(first.query.normalizedName, normalizedName);
  assert.equal(first.update.$setOnInsert.rawName, 'Coke 20 Oz');
  assert.equal(first.update.$setOnInsert.lastSeenRawName, undefined);
  assert.equal(first.update.$set.lastSeenRawName, 'Coke 20 Oz');
  assert.equal(first.update.$set.lastSeenAt, firstSeenAt);

  const secondSeenAt = new Date('2026-01-02T00:00:00.000Z');
  const second = buildUnmappedProductUpsert({
    storeId,
    normalizedName,
    rawName: 'Coke 20oz Bottle',
    now: secondSeenAt,
    session: null
  });

  assert.equal(second.update.$setOnInsert.rawName, 'Coke 20oz Bottle');
  assert.equal(second.update.$setOnInsert.lastSeenRawName, undefined);
  assert.equal(second.update.$set.lastSeenRawName, 'Coke 20oz Bottle');
  assert.equal(second.update.$set.lastSeenAt, secondSeenAt);
});
