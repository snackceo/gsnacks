import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../db/connect.js';
import { flushStaleReceiptJobs } from '../utils/receiptQueueCleanup.js';

/**
 * Maintenance helper: remove receipt-parse queue jobs that reference missing receipt captures.
 *
 * Usage:
 *  node scripts/cleanupReceiptQueue.js
 *  node scripts/cleanupReceiptQueue.js --capture-id <captureId>
 *  node scripts/cleanupReceiptQueue.js --dry-run
 */

dotenv.config();

const parseArgs = () => {
  const args = process.argv.slice(2);
  const captureIds = [];
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--capture-id' && args[i + 1]) {
      captureIds.push(args[i + 1]);
      i += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { captureIds, dryRun };
};

const run = async () => {
  await connectDB();

  const { captureIds, dryRun } = parseArgs();
  const result = await flushStaleReceiptJobs({
    captureIds: captureIds.length ? captureIds : null,
    dryRun
  });

  if (!result.ok) {
    console.error(`Receipt queue cleanup skipped: ${result.reason || 'queue_unavailable'}`);
  } else {
    console.log('Receipt queue cleanup summary:', result);
  }

  await mongoose.disconnect();
};

run().catch(err => {
  console.error('Receipt queue cleanup failed:', err);
  process.exit(1);
});
