import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getInventoryDisplay } from '../../.tmp-test/utils/inventoryDisplay.js';

describe('getInventoryDisplay', () => {
  it('uses unmapped names and placeholder values when product data is missing', () => {
    const entry = {
      productId: null,
      unmappedProductId: { rawName: 'Raw', normalizedName: 'Normalized' },
      observedPrice: null,
      cost: null
    };

    const display = getInventoryDisplay(entry);

    assert.equal(display.name, 'Raw');
    assert.equal(display.sku, '—');
    assert.equal(display.upc, '—');
    assert.equal(display.price, null);
    assert.equal(display.source, '—');
  });

  it('prefers product fields and observed price when present', () => {
    const entry = {
      productId: { name: 'Product', sku: 'NP-000001', upc: '123' },
      unmappedProductId: null,
      observedPrice: 1.5,
      cost: 1.0
    };

    const display = getInventoryDisplay(entry);

    assert.equal(display.name, 'Product');
    assert.equal(display.sku, 'NP-000001');
    assert.equal(display.upc, '123');
    assert.equal(display.price, 1.5);
    assert.equal(display.source, 'Observed');
  });

  it('keeps observed price at 0 when cost is nonzero', () => {
    const entry = {
      productId: { name: 'Product', sku: 'NP-000001', upc: '123' },
      unmappedProductId: null,
      observedPrice: 0,
      cost: 1.0
    };

    const display = getInventoryDisplay(entry);

    assert.equal(display.name, 'Product');
    assert.equal(display.price, 0);
    assert.equal(display.source, 'Observed');
  });

  it('falls back to cost of 0 when observed price is null', () => {
    const entry = {
      productId: { name: 'Product', sku: 'NP-000001', upc: '123' },
      unmappedProductId: null,
      observedPrice: null,
      cost: 0
    };

    const display = getInventoryDisplay(entry);

    assert.equal(display.name, 'Product');
    assert.equal(display.price, 0);
    assert.equal(display.source, 'Cost');
  });

  it('uses normalized unmapped name when productId is missing and rawName is empty', () => {
    const entry = {
      productId: null,
      unmappedProductId: { rawName: '', normalizedName: 'Normalized' },
      observedPrice: null,
      cost: null
    };

    const display = getInventoryDisplay(entry);

    assert.equal(display.name, 'Normalized');
    assert.equal(display.price, null);
    assert.equal(display.source, '—');
  });
});
