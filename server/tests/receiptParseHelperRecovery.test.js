import assert from 'node:assert/strict';
import test from 'node:test';

import { __test__ } from '../utils/receiptParseHelper.js';

const { sanitizeReceiptNumber, parseGeminiJsonPayload, recoverItemsFromRawText } = __test__;

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
