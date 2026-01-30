import mongoose from 'mongoose';

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

unmappedProductSchema.index({ storeId: 1, normalizedName: 1 }, { unique: true });

const UnmappedProduct = mongoose.model('UnmappedProduct', unmappedProductSchema);

export default UnmappedProduct;
