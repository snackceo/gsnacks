import 'dotenv/config';
import { isReceiptQueueEnabled, registerReceiptWorker } from '../queues/receiptQueue.js';
import connectDB, { isDbReady } from '../db/connect.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import { executeReceiptParse } from '../utils/receiptParseHelper.js';

if (!isReceiptQueueEnabled()) {
  console.warn('Receipt worker not started because ENABLE_RECEIPT_QUEUE is false or Redis is not configured.');
  await new Promise(() => {});
} else {
  // Connect to MongoDB before starting worker
  await connectDB();

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

    const captureExists = await ReceiptCapture.exists({ _id: captureId });
    if (!captureExists) {
      console.warn(`Receipt capture missing for job ${job.id}; removing job without retry.`);
      await job.remove();
      return;
    }

    try {
      // Execute the parsing pipeline (shared with receipt-prices route)
      const parseJob = await executeReceiptParse(captureId, actor || 'worker');
      console.log(`Receipt parsed successfully: ${captureId} → job ${parseJob._id}`);
    } catch (err) {
      console.error(`Receipt parse failed for ${captureId}:`, err?.message);
      throw err;
    }
  });

  if (worker) {
    console.log('Receipt worker running for receipt-parse queue.');
    worker.on('failed', (job, err) => {
      console.error(`Receipt worker failed job ${job.id}:`, err?.message || err);
    });
    worker.on('completed', job => {
      console.log(`Receipt worker completed job ${job.id}`);
    });
  }
}
