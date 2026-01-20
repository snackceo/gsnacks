import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true }, // legacy frontend id (kept for compatibility)
    sku: { type: String, required: false, unique: true, sparse: true }, // business identifier NP-000001
    brand: { type: String, default: '' },
    productType: { type: String, default: '' },
    storageZone: { type: String, default: '' },
    storageBin: { type: String, default: '' },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    sizeOz: { type: Number, default: 0 },

    category: { type: String, default: 'DRINK' },
    image: { type: String, default: '' },
    isGlass: { type: Boolean, default: false },
    // Operational flag for heavy item handling
    isHeavy: { type: Boolean, default: false },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      index: true
    }
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
