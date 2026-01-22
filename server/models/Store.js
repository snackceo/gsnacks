import mongoose from 'mongoose';

const dayHoursSchema = new mongoose.Schema(
  {
    open: { type: String, default: '' },
    close: { type: String, default: '' },
    closed: { type: Boolean, default: false }
  },
  { _id: false }
);

const weekHoursSchema = new mongoose.Schema(
  {
    mon: { type: dayHoursSchema, default: () => ({}) },
    tue: { type: dayHoursSchema, default: () => ({}) },
    wed: { type: dayHoursSchema, default: () => ({}) },
    thu: { type: dayHoursSchema, default: () => ({}) },
    fri: { type: dayHoursSchema, default: () => ({}) },
    sat: { type: dayHoursSchema, default: () => ({}) },
    sun: { type: dayHoursSchema, default: () => ({}) }
  },
  { _id: false }
);

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    phone: { type: String, default: '' },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zip: { type: String, default: '' },
      country: { type: String, default: '' },
    },
    // Location for routing (optional for receipt-uploaded stores)
    location: {
      lat: { type: Number },
      lng: { type: Number }
    },
    // Store metadata (optional for receipt-uploaded stores)
    storeType: { 
      type: String, 
      enum: ['walmart', 'kroger', 'aldi', 'target', 'meijer', 'hub', 'other']
    },
    // Track how store was created
    createdFrom: {
      type: String,
      enum: ['receipt_upload', 'admin_script', 'manual'],
      default: 'manual'
    },
    // Reliability metrics
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
    outOfStockRate: { type: Number, default: 0, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },
    hours: {
      timezone: { type: String, default: 'America/New_York' },
      weekly: { type: weekHoursSchema, default: () => ({}) }
    }
  },
  { timestamps: true }
);

export default mongoose.model('Store', storeSchema);
