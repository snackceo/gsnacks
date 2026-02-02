import { test } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import StoreInventory from '../models/StoreInventory.js';

dotenv.config();

test('StoreInventory indexes sync cleanly', async t => {
  if (!process.env.MONGO_URI) {
    t.skip('MONGO_URI not configured');
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);

  t.after(async () => {
    await mongoose.disconnect();
  });

  const result = await StoreInventory.syncIndexes();
  assert.ok(result);

  const indexes = await StoreInventory.collection.indexes();
  const indexNames = indexes.map(index => index.name);

  assert.ok(indexNames.includes('storeId_1_productId_1'));
  assert.ok(indexNames.includes('storeId_1_unmappedProductId_1'));
});
