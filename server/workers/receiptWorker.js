import 'dotenv/config';
import { isReceiptQueueEnabled, registerReceiptWorker } from '../queues/receiptQueue.js';
import { isDbReady } from '../db/connect.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import { executeReceiptParse } from '../utils/receiptParseHelper.js';

if (!isReceiptQueueEnabled()) {
  console.warn('Receipt worker not started because ENABLE_RECEIPT_QUEUE is false or Redis is not configured.');
  process.exit(0);
}

const worker = registerReceiptWorker(async job => {
  if (job.name !== 'receipt-parse') {
    return;
  }

  const { captureId, actor } = job.data || {};
  if (!captureId) {
    throw new Error('captureId is required for receipt-parse job');
  }

  if (!isDbReady()) {
    throw new Error('Database not ready');
  }

  try {
    // Execute the parsing pipeline (shared with receipt-prices route)
    const parseJob = await executeReceiptParse(captureId, actor || 'worker');
    console.log(`Receipt parsed successfully: ${captureId} → job ${parseJob._id}`);
  } catch (err) {
    console.error(`Receipt parse failed for ${captureId}:`, err?.message);
    // Mark capture as failed
    try {
      const capture = await ReceiptCapture.findById(captureId);
      if (capture) {
        capture.status = 'failed';
        capture.parseError = err?.message || 'Unknown error';
        await capture.save();
      }
    } catch (updateErr) {
      console.error('Failed to update capture status:', updateErr?.message);
    }
    throw err;
  }
});

if (worker) {
  worker.on('failed', (job, err) => {
    console.error(`Receipt worker failed job ${job.id}:`, err?.message || err);
  });
  worker.on('completed', job => {
    console.log(`Receipt worker completed job ${job.id}`);
  });
}
