import mongoose from 'mongoose';
import { normalizeReceiptProductName } from '../utils/receiptNameNormalization.js';

const unmappedProductSchema = new mongoose.Schema({
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  rawName: {
    type: String,
    required: true,
    trim: true
  },
  lastSeenRawName: {
    type: String,
    trim: true
  },
  normalizedName: {
    type: String,
    required: true,
    trim: true
  },
  firstSeenAt: {
    type: Date,
    default: Date.now
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['NEW', 'IGNORED', 'MAPPED'],
    default: 'NEW',
    index: true
  },
  mappedProductId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }
}, {
  timestamps: true
});

unmappedProductSchema.pre('validate', function setCanonicalNormalizedName(next) {
  this.normalizedName = normalizeReceiptProductName(this.normalizedName || this.rawName);
  next();
});

unmappedProductSchema.index({ storeId: 1, normalizedName: 1 }, { unique: true });
unmappedProductSchema.index({ normalizedName: 1 });

const UnmappedProduct = mongoose.model('UnmappedProduct', unmappedProductSchema);

export default UnmappedProduct;
