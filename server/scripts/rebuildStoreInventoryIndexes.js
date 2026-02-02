import mongoose from 'mongoose';
import dotenv from 'dotenv';

import StoreInventory from '../models/StoreInventory.js';

dotenv.config();

const rebuildStoreInventoryIndexes = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not found in environment variables.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  try {
    const result = await StoreInventory.syncIndexes();
    console.log('StoreInventory indexes synced:', result);
  } catch (error) {
    console.error('Failed to sync StoreInventory indexes:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

rebuildStoreInventoryIndexes();
