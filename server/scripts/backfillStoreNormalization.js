import dotenv from 'dotenv';
import connectDB from '../db/connect.js';
import Store from '../models/Store.js';
import { normalizePhone, normalizeStoreNumber } from '../utils/storeMatcher.js';

dotenv.config();

const shouldDryRun = process.argv.includes('--dry-run');
const onlyMissing = process.argv.includes('--only-missing');

const run = async () => {
  await connectDB();

  const stores = await Store.find({}).lean();
  let updated = 0;

  for (const store of stores) {
    const nextPhoneNormalized = normalizePhone(store.phone);
    const nextStoreNumber = normalizeStoreNumber(store.storeNumber);
    const updates = {};

    if (store.phoneNormalized !== nextPhoneNormalized) {
      if (onlyMissing && store.phoneNormalized) {
        // skip
      } else {
        updates.phoneNormalized = nextPhoneNormalized;
      }
    }

    if (store.storeNumber !== nextStoreNumber) {
      if (onlyMissing && store.storeNumber) {
        // skip
      } else {
        updates.storeNumber = nextStoreNumber;
      }
    }

    if (Object.keys(updates).length > 0) {
      updated += 1;
      if (!shouldDryRun) {
        await Store.updateOne({ _id: store._id }, { $set: updates });
      }
    }
  }

  const suffix = shouldDryRun ? ' (dry run)' : '';
  const onlyMissingLabel = onlyMissing ? ' (only missing)' : '';
  console.log(`Store normalization updates: ${updated}${suffix}${onlyMissingLabel}`);
  process.exit(0);
};

run().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
