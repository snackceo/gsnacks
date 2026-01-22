import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Store from '../models/Store.js';
import connectDB from '../db/connect.js';

dotenv.config();

const DEFAULT_STORE_HOURS = {
  timezone: 'America/New_York',
  weekly: {
    mon: { open: '08:00', close: '22:00' },
    tue: { open: '08:00', close: '22:00' },
    wed: { open: '08:00', close: '22:00' },
    thu: { open: '08:00', close: '22:00' },
    fri: { open: '08:00', close: '23:00' },
    sat: { open: '09:00', close: '23:00' },
    sun: { open: '09:00', close: '21:00' }
  }
};

const STORES_TO_ADD = [
  { name: 'walmart dearborn', hours: DEFAULT_STORE_HOURS },
  { name: 'walmert telegraph', hours: DEFAULT_STORE_HOURS },
  { name: 'kroger dearborn', hours: DEFAULT_STORE_HOURS }
];

async function addStores() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    for (const storeData of STORES_TO_ADD) {
      const existing = await Store.findOne({ name: storeData.name });
      
      if (existing) {
        console.log(`✓ Store already exists: ${storeData.name}`);
      } else {
        const store = new Store({
          name: storeData.name,
          createdFrom: 'admin_script',
          hours: storeData.hours,
          createdAt: new Date()
        });
        await store.save();
        console.log(`✓ Created store: ${storeData.name} (${store._id})`);
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
