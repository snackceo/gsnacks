import mongoose from 'mongoose';

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
    // Location for routing
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    // Store metadata
    storeType: { 
      type: String, 
      enum: ['walmart', 'kroger', 'aldi', 'target', 'meijer', 'hub'], 
      required: true 
    },
    // Reliability metrics
    reliabilityScore: { type: Number, default: 100, min: 0, max: 100 },
    outOfStockRate: { type: Number, default: 0, min: 0, max: 100 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model('Store', storeSchema);
