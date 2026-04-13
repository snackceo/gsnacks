import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReceiptCurrency,
  resolveReceiptUnitPrice,
  buildPriceObservationPayload
} from '../utils/receiptObservation.js';

test('parseReceiptCurrency supports OCR formats', () => {
  assert.equal(parseReceiptCurrency('$4.99'), 4.99);
  assert.equal(parseReceiptCurrency('4.99'), 4.99);
  assert.equal(parseReceiptCurrency('4,99'), 4.99);
  assert.equal(parseReceiptCurrency('499'), 4.99);
  assert.equal(parseReceiptCurrency('100'), 100);
  assert.equal(parseReceiptCurrency('1200'), 1200);
});

test('resolveReceiptUnitPrice handles noisy OCR totals and quantities', () => {
  assert.equal(resolveReceiptUnitPrice({ totalPrice: '4,99', quantity: '1' }), 4.99);
  assert.equal(resolveReceiptUnitPrice({ totalPrice: '499', quantity: '1' }), 4.99);
});

test('buildPriceObservationPayload stores normalized price, cost, quantity for mapped product', () => {
  const result = buildPriceObservationPayload({
    item: { unitPrice: '$4.99', quantity: '2' },
    storeId: 'store-1',
    receiptCaptureId: 'capture-1',
    productId: 'product-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.price, 4.99);
  assert.equal(result.payload.cost, 4.99);
  assert.equal(result.payload.quantity, 2);
  assert.equal(result.payload.matchMethod, 'manual_confirm');
  assert.equal(result.payload.workflowType, 'update_price');
});

test('buildPriceObservationPayload stores identical metadata defaults for unmapped lines', () => {
  const result = buildPriceObservationPayload({
    item: { totalPrice: '4,99', quantity: '1' },
    storeId: 'store-1',
    receiptCaptureId: 'capture-1',
    unmappedProductId: 'unmapped-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.price, 4.99);
  assert.equal(result.payload.cost, 4.99);
  assert.equal(result.payload.quantity, 1);
  assert.equal(result.payload.matchMethod, 'unmapped');
  assert.equal(result.payload.workflowType, 'unmapped');
});

test('buildPriceObservationPayload rejects lines with invalid price, quantity, or missing mapping', () => {
  const badPrice = buildPriceObservationPayload({
    item: { unitPrice: 'free', quantity: 1 },
    storeId: 'store-1'
  });
  assert.equal(badPrice.ok, false);
  assert.equal(badPrice.reason, 'invalid_price');

  const badQuantity = buildPriceObservationPayload({
    item: { unitPrice: '4.99', quantity: 'abc' },
    storeId: 'store-1',
    productId: 'product-1'
  });
  assert.equal(badQuantity.ok, false);
  assert.equal(badQuantity.reason, 'invalid_quantity');

  const missingMapping = buildPriceObservationPayload({
    item: { unitPrice: '4.99', quantity: 1 },
    storeId: 'store-1'
  });
  assert.equal(missingMapping.ok, false);
  assert.equal(missingMapping.reason, 'missing_mapping');
});
