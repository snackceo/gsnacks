import mongoose from 'mongoose';
import { generateSku } from '../utils/sku.js';
import { normalizeReceiptProductName } from '../utils/receiptNameNormalization.js';

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
    normalizedName: { type: String, default: '', index: true },
    price: { type: Number, required: true },
    lastCost: { type: Number },
    lastCostAt: { type: Date },
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


productSchema.pre('validate', function setNormalizedName(next) {
  this.normalizedName = normalizeReceiptProductName(this.name);
  next();
});

productSchema.index({ normalizedName: 1 });
productSchema.index(
  { store: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { store: { $exists: true }, normalizedName: { $type: 'string', $ne: '' } } }
);

productSchema.statics.createReceiptProductStub = async function createReceiptProductStub({
  name,
  unitPrice,
  storeId,
  session
} = {}) {
  const sku = await generateSku();
  const safePrice = Number(unitPrice);

  const [created] = await this.create([
    {
      frontendId: sku,
      sku,
      upc: undefined,
      name: String(name || 'Receipt Item').trim() || 'Receipt Item',
      normalizedName: normalizeReceiptProductName(name || 'Receipt Item'),
      price: Number.isFinite(safePrice) && safePrice > 0 ? safePrice : 0,
      lastCost: Number.isFinite(safePrice) && safePrice > 0 ? safePrice : undefined,
      lastCostAt: Number.isFinite(safePrice) && safePrice > 0 ? new Date() : undefined,
      deposit: 0,
      stock: 0,
      sizeOz: 0,
      brand: '',
      productType: '',
      storageZone: '',
      storageBin: '',
      category: 'DRINK',
      isTaxable: true,
      image: '',
      isGlass: false,
      isHeavy: false,
      store: storeId
    }
  ], { session });

  return created;
};

export default mongoose.model('Product', productSchema);
