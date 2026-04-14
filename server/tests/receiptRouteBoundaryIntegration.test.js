import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import receiptDriverRouter from '../routes/receipt-prices.js';
import receiptsRouter from '../routes/receipts.js';

const ROOT_DIR = path.resolve(process.cwd(), '..');

const FRONTEND_RECEIPT_CALLERS = [
  'src/components/ReceiptCapture.tsx',
  'src/components/ReceiptCaptureFlow.tsx',
  'src/views/management/ManagementReceipt.tsx',
  'src/views/management/ManagementDashboard.tsx'
];

const hasRoute = (router, method, endpoint) =>
  router.stack.some(
    layer =>
      layer?.route?.path === endpoint &&
      Boolean(layer?.route?.methods?.[String(method || '').toLowerCase()])
  );

test('receipt capture -> parse -> approve route boundary remains mounted', async () => {
  assert.equal(hasRoute(receiptDriverRouter, 'post', '/receipt-capture'), true);
  assert.equal(hasRoute(receiptDriverRouter, 'post', '/receipt-parse'), true);
  assert.equal(hasRoute(receiptsRouter, 'post', '/:jobId/approve'), true);
});

test('frontend receipt callers route through shared receiptApiClient', async () => {
  for (const file of FRONTEND_RECEIPT_CALLERS) {
    const fullPath = path.join(ROOT_DIR, file);
    const contents = fs.readFileSync(fullPath, 'utf8');

    assert.match(
      contents,
      /receiptApiClient/,
      `${file} must route receipt calls through receiptApiClient`
    );

    assert.doesNotMatch(
      contents,
      /apiFetch\s*\([^\n]*['"]\/api\/(driver|receipts)/,
      `${file} should not call receipt endpoints directly via apiFetch`
    );
  }
});
