import assert from 'node:assert/strict';
import test from 'node:test';

import { __test__ } from '../utils/receiptParseHelper.js';

const {
  sanitizeReceiptNumber,
  parseGeminiJsonPayload,
  recoverItemsFromRawText,
  normalizeProviderReceiptItems,
  normalizeProviderReceiptItemsWithMetrics,
  buildParseQualityMetrics,
  getReceiptQualityThreshold
} = __test__;

test('parseGeminiJsonPayload recovers JSON from code fences with extra text and trailing commas', () => {
  const raw = `
Here is your result:

audit info before object {"not": "the payload"}

\`\`\`json
{
  “items”: [
    {"receiptName": "CHIPS", "quantity": "2", "totalPrice": "12.99 USD",},
  ],
}
\`\`\`

thanks
`;

  const parsed = parseGeminiJsonPayload(raw);
  assert.ok(parsed);
  assert.equal(parsed.items[0].receiptName, 'CHIPS');
});

test('sanitizeReceiptNumber supports spaced tokens and suffix currency forms', () => {
  assert.equal(sanitizeReceiptNumber('1 2 . 9 9'), 12.99);
  assert.equal(sanitizeReceiptNumber('$12.99'), 12.99);
  assert.equal(sanitizeReceiptNumber('12.99 USD'), 12.99);
  assert.equal(sanitizeReceiptNumber('1.234,56 EUR'), 1234.56);
  assert.equal(sanitizeReceiptNumber('1,234.56 USD'), 1234.56);
});

test('recoverItemsFromRawText handles mixed separators, multiline names, and OCR typos', () => {
  const raw = `
SUBTOTAL 26.00
MTN DEW BAJA
BLAST 2 x 3,50
C0CA C0LA 12PK 1 x 12.99 USD
TAX 1.20
`;

  const recovered = recoverItemsFromRawText(raw);
  assert.equal(recovered.length, 2);
  assert.equal(recovered[0].receiptName, 'MTN DEW BAJA BLAST');
  assert.equal(recovered[0].quantity, 2);
  assert.equal(recovered[0].totalPrice, 3.5);
  assert.equal(recovered[1].receiptName, 'C0CA C0LA 12PK');
  assert.equal(recovered[1].totalPrice, 12.99);
});


test('parseGeminiJsonPayload returns null when tolerant parse still fails', () => {
  const raw = '```json\n{ "items": [ }\n```';
  const parsed = parseGeminiJsonPayload(raw);
  assert.equal(parsed, null);
});

test('fallback item extraction is used when parsed.items is missing', () => {
  const raw = `
{"storeName":"Store Only"}
SPRITE 2 x 4.00
`;

  const parsed = parseGeminiJsonPayload(raw);
  assert.ok(parsed);
  assert.equal(parsed.items, undefined);

  const recovered = recoverItemsFromRawText(raw);
  assert.equal(recovered.length, 1);
  assert.match(recovered[0].receiptName, /SPRITE/);
  assert.equal(recovered[0].quantity, 2);
  assert.equal(recovered[0].totalPrice, 4);
});


test('normalizeProviderReceiptItems emits unified shape with shared sanitizers', () => {
  const normalized = normalizeProviderReceiptItems([
    {
      description: '  C0CA\nCOLA 12PK  ',
      qty: 'I',
      priceEach: '1,99',
      lineTotal: '3,98',
      barcode: 'O12345I89'
    },
    {
      receiptName: ' LAYS  ',
      quantity: null,
      unitPrice: '$2.50',
      totalPrice: '$2.50',
      upc: ''
    }
  ]);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    receiptName: 'C0CA COLA 12PK',
    quantity: 1,
    unitPrice: 1.99,
    totalPrice: 3.98,
    upc: '012345189'
  });
  assert.deepEqual(normalized[1], {
    receiptName: 'LAYS',
    quantity: null,
    unitPrice: 2.5,
    totalPrice: 2.5,
    upc: null
  });
});

test('normalizeProviderReceiptItemsWithMetrics tracks sanitizer activity', () => {
  const result = normalizeProviderReceiptItemsWithMetrics([
    {
      description: '  PEPSI\nZERO  ',
      qty: 'I',
      priceEach: '1,50',
      lineTotal: '1,50',
      barcode: 'O1234'
    }
  ]);

  assert.equal(result.items.length, 1);
  assert.equal(result.metrics.inputItems, 1);
  assert.equal(result.metrics.outputItems, 1);
  assert.equal(result.metrics.lineBreakNormalizedCount, 1);
  assert.equal(result.metrics.commaDecimalNormalizedCount, 1);
  assert.equal(result.metrics.ocrTypoFixCount, 1);
  assert.equal(result.metrics.withUpcCount, 1);
});

test('buildParseQualityMetrics computes expected diagnostics and quality score', () => {
  const metrics = buildParseQualityMetrics({
    ocrOutput: {
      parseStageFailures: { invalid_json: 1, no_items: 1 },
      skippedImages: [{ reason: 'blur' }]
    },
    normalizedProviderItems: [{}, {}, {}, {}],
    validStructuredLineCount: 2,
    invalidPriceSkippedLines: 2,
    imageCount: 4
  });

  assert.equal(metrics.extractedLineCount, 4);
  assert.equal(metrics.linesWithValidQtyPrice, 2);
  assert.equal(metrics.invalidPriceSkippedLines, 2);
  assert.equal(metrics.malformedStructureRate, 0.5);
  assert.equal(metrics.skippedImageCount, 1);
  assert.equal(metrics.qualityScore, 0.6375);
});

test('getReceiptQualityThreshold clamps and defaults values', () => {
  const original = process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD;
  process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD = '1.2';
  assert.equal(getReceiptQualityThreshold({}), 1);
  assert.equal(getReceiptQualityThreshold({ qualityScoreThreshold: -1 }), 0);
  assert.equal(getReceiptQualityThreshold({ qualityScoreThreshold: 0.42 }), 0.42);
  process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD = 'not-a-number';
  assert.equal(getReceiptQualityThreshold({}), 0.6);
  if (original === undefined) {
    delete process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD;
  } else {
    process.env.RECEIPT_PARSE_QUALITY_SCORE_THRESHOLD = original;
  }
});
