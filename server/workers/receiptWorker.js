import 'dotenv/config';
import { isReceiptQueueEnabled, registerReceiptWorker } from '../queues/receiptQueue.js';
import { isDbReady } from '../db/connect.js';
import ReceiptCapture from '../models/ReceiptCapture.js';

if (!isReceiptQueueEnabled()) {
  console.warn('Receipt worker not started because ENABLE_RECEIPT_QUEUE is false or Redis is not configured.');
  process.exit(0);
}

const worker = registerReceiptWorker(async job => {
  if (job.name !== 'receipt-parse') {
    return;
  }

  const { captureId } = job.data || {};
  if (!captureId) {
    throw new Error('captureId is required for receipt-parse job');
  }

  if (!isDbReady()) {
    throw new Error('Database not ready');
  }

  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw new Error('Receipt capture not found');
  }

  // Placeholder: actual parsing logic should be invoked here (Gemini + matching + draft population).
  // For safety during rollout, mark as failed fast so jobs do not pile up silently.
  capture.status = 'failed';
  capture.parseError = 'Receipt parse worker not implemented yet';
  await capture.save();
});

if (worker) {
  worker.on('failed', (job, err) => {
    console.error(`Receipt worker failed job ${job.id}:`, err?.message || err);
  });
  worker.on('completed', job => {
    console.log(`Receipt worker completed job ${job.id}`);
  });
}
