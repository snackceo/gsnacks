import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Store from '../models/Store.js';
import connectDB from '../db/connect.js';

dotenv.config();

const STORES_TO_ADD = [
  'walmart dearborn',
  'walmert telegraph',
  'kroger dearborn'
];

async function addStores() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    for (const storeName of STORES_TO_ADD) {
      const existing = await Store.findOne({ name: storeName });
      
      if (existing) {
        console.log(`✓ Store already exists: ${storeName}`);
      } else {
        const store = new Store({
          name: storeName,
          createdFrom: 'admin_script',
          createdAt: new Date()
        });
        await store.save();
        console.log(`✓ Created store: ${storeName} (${store._id})`);
      }
    }

    console.log('\nAll stores processed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error adding stores:', error);
    process.exit(1);
  }
}

addStores();
