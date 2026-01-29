import 'dotenv/config';
import { isReceiptQueueEnabled, registerReceiptWorker } from '../queues/receiptQueue.js';
import connectDB, { isDbReady } from '../db/connect.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
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

    // FIX 1: Always advance state to 'parsing' and increment parseAttempts
    const updateResult = await ReceiptCapture.updateOne(
      { _id: captureId },
      {
        $inc: { parseAttempts: 1 },
        $set: { status: 'parsing' }
      }
    );

    if (updateResult.matchedCount === 0) {
      console.warn(`Receipt capture missing for job ${job.id}; removing job without retry.`);
      await job.remove();
      return;
    }

    await ReceiptParseJob.findOneAndUpdate(
      { captureId: captureId.toString() },
      {
        captureId: captureId.toString(),
        status: 'PARSING'
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    try {
      // Execute the parsing pipeline (shared with receipt-prices route)
      const parseJob = await executeReceiptParse(captureId, actor || 'worker');
      console.log(`Receipt parsed successfully: ${captureId} → job ${parseJob._id}`);
    } catch (err) {
      console.error(`Receipt parse failed for ${captureId}:`, err?.message);
      // FIX 2: Downgrade to needs_review, do not stall
      try {
        await ReceiptCapture.updateOne(
          { _id: captureId },
          {
            $set: {
              status: 'needs_review',
              parseError: 'AI parse failed'
            }
          }
        );
      } catch (updateErr) {
        console.error('Failed to update capture status:', updateErr?.message);
      }
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
