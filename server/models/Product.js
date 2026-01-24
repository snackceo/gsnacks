import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true }, // legacy frontend id (kept for compatibility)
    sku: { type: String, required: false, unique: true, sparse: true }, // business identifier NP-000001
    upc: { type: String, required: false, unique: true, sparse: true, index: true },
    brand: { type: String, default: '' },
    productType: { type: String, default: '' },
    storageZone: { type: String, default: '' },
    storageBin: { type: String, default: '' },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    sizeOz: { type: Number, default: 0 },
    isTaxable: { type: Boolean, default: true },

    category: { type: String, default: 'DRINK' },
    image: { type: String, default: '' },
    isGlass: { type: Boolean, default: false },
    // Operational flag for heavy item handling
    isHeavy: { type: Boolean, default: false },
    // Capacity model: weighted handling points for batching
    // Normal item: 1, Bulky: 2, Heavy: 3, Very heavy (cases): 6-10
    handlingPoints: { type: Number, default: 1 },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      index: true
    }
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
