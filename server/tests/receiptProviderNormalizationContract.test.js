import assert from 'node:assert/strict';
import test from 'node:test';

import { providerNormalizationFixtures } from './fixtures/receiptProviderNormalization.fixtures.js';
import { __test__ } from '../utils/receiptParseHelper.js';

const { normalizeProviderReceiptItemsWithMetrics } = __test__;

for (const fixture of providerNormalizationFixtures) {
  test(`provider normalization contract: ${fixture.name}`, () => {
    const result = normalizeProviderReceiptItemsWithMetrics(fixture.input);

    assert.deepEqual(result.items, fixture.expected);
    assert.equal(result.metrics.inputItems, fixture.input.length);
    assert.equal(result.metrics.outputItems, fixture.expected.length);
    assert.ok(result.metrics.commaDecimalNormalizedCount >= 0);
    assert.ok(result.metrics.ocrTypoFixCount >= 0);
    assert.ok(result.metrics.whitespaceCollapsedCount >= 0);
    assert.ok(result.metrics.lineBreakNormalizedCount >= 0);
  });
}
