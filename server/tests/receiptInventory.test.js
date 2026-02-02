import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInventoryUpdate, buildStoreInventoryQuery } from '../utils/receiptInventory.js';

test('buildStoreInventoryQuery returns productId query when productId is present', () => {
  const query = buildStoreInventoryQuery({ storeId: 'store-1', productId: 'prod-1' });
  assert.deepEqual(query, { storeId: 'store-1', productId: 'prod-1' });
});

test('buildStoreInventoryQuery returns unmappedProductId query when unmappedProductId is present', () => {
  const query = buildStoreInventoryQuery({ storeId: 'store-1', unmappedProductId: 'unmapped-1' });
  assert.deepEqual(query, { storeId: 'store-1', unmappedProductId: 'unmapped-1' });
});

test('buildStoreInventoryQuery returns null when no ids are provided', () => {
  const query = buildStoreInventoryQuery({ storeId: 'store-1' });
  assert.equal(query, null);
});

test('buildInventoryUpdate builds update with productId', () => {
  const update = buildInventoryUpdate({
    storeId: 'store-1',
    productId: 'prod-1',
    price: 2.5,
    inventoryId: 'inv-1',
    lineIndex: 3
  });
  assert.deepEqual(update, {
    storeId: 'store-1',
    productId: 'prod-1',
    price: 2.5,
    inventoryId: 'inv-1',
    lineIndex: 3
  });
});

test('buildInventoryUpdate builds update with unmappedProductId', () => {
  const update = buildInventoryUpdate({
    storeId: 'store-1',
    unmappedProductId: 'unmapped-1',
    price: 1.25,
    inventoryId: 'inv-2',
    lineIndex: 1
  });
  assert.deepEqual(update, {
    storeId: 'store-1',
    unmappedProductId: 'unmapped-1',
    price: 1.25,
    inventoryId: 'inv-2',
    lineIndex: 1
  });
});

test('buildInventoryUpdate throws when both ids are provided', () => {
  assert.throws(() => {
    buildInventoryUpdate({
      storeId: 'store-1',
      productId: 'prod-1',
      unmappedProductId: 'unmapped-1',
      price: 1.25,
      inventoryId: 'inv-2',
      lineIndex: 1
    });
  }, /Exactly one of productId or unmappedProductId/);
});

test('buildInventoryUpdate throws when no ids are provided', () => {
  assert.throws(() => {
    buildInventoryUpdate({
      storeId: 'store-1',
      price: 1.25,
      inventoryId: 'inv-2',
      lineIndex: 1
    });
  }, /Exactly one of productId or unmappedProductId/);
});
