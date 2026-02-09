import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertUnmappedProductForReceiptItem } from '../routes/receipts.js';

test('upsertUnmappedProductForReceiptItem updates last-seen fields for existing unmapped product', async () => {
  const existing = { _id: 'unmapped-1', rawName: 'Original Raw Name' };
  const calls = {
    findOne: [],
    updateOne: [],
    create: []
  };

  const UnmappedProductModel = {
    findOne(query) {
      calls.findOne.push(query);
      return {
        session() {
          return Promise.resolve(existing);
        }
      };
    },
    updateOne(filter, update, options) {
      calls.updateOne.push({ filter, update, options });
      return Promise.resolve({ acknowledged: true });
    },
    create(docs) {
      calls.create.push(docs);
      return Promise.resolve([{ _id: 'should-not-create' }]);
    }
  };

  const { unmapped, now } = await upsertUnmappedProductForReceiptItem({
    item: {
      receiptName: 'Coke 20 Oz',
      normalizedName: 'COKE 20 OZ'
    },
    storeId: 'store-1',
    session: 'session-token',
    UnmappedProductModel
  });

  assert.equal(unmapped, existing);
  assert.ok(now instanceof Date);
  assert.deepEqual(calls.findOne, [{ storeId: 'store-1', normalizedName: 'COKE 20 OZ' }]);
  assert.equal(calls.updateOne.length, 1);
  assert.equal(calls.create.length, 0);

  const updateCall = calls.updateOne[0];
  assert.deepEqual(updateCall.filter, { _id: 'unmapped-1' });
  assert.equal(updateCall.options.session, 'session-token');
  assert.equal(updateCall.update.$set.lastSeenRawName, 'Coke 20 Oz');
  assert.equal(updateCall.update.$set.lastSeenAt, now);
});

test('upsertUnmappedProductForReceiptItem creates new unmapped product when missing', async () => {
  const calls = {
    findOne: [],
    updateOne: [],
    create: []
  };

  const createdDoc = { _id: 'new-unmapped-1' };
  const UnmappedProductModel = {
    findOne(query) {
      calls.findOne.push(query);
      return {
        session() {
          return Promise.resolve(null);
        }
      };
    },
    updateOne(filter, update, options) {
      calls.updateOne.push({ filter, update, options });
      return Promise.resolve({ acknowledged: true });
    },
    create(docs, options) {
      calls.create.push({ docs, options });
      return Promise.resolve([createdDoc]);
    }
  };

  const { unmapped, now } = await upsertUnmappedProductForReceiptItem({
    item: {
      receiptName: 'Sprite 2L'
    },
    storeId: 'store-2',
    session: 'session-token',
    UnmappedProductModel
  });

  assert.equal(unmapped, createdDoc);
  assert.ok(now instanceof Date);
  assert.equal(calls.updateOne.length, 0);
  assert.equal(calls.create.length, 1);

  const createCall = calls.create[0];
  assert.equal(createCall.options.session, 'session-token');
  assert.equal(createCall.docs.length, 1);
  const payload = createCall.docs[0];

  assert.equal(payload.storeId, 'store-2');
  assert.equal(payload.rawName, 'Sprite 2L');
  assert.equal(payload.normalizedName, 'SPRITE 2L');
  assert.equal(payload.firstSeenAt, now);
  assert.equal(payload.lastSeenAt, now);
  assert.equal(payload.lastSeenRawName, 'Sprite 2L');
  assert.equal(payload.status, 'NEW');
});
