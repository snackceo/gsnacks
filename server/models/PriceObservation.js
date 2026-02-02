import mongoose from 'mongoose';

const priceObservationSchema = new mongoose.Schema({
  unmappedProductId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UnmappedProduct',
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    index: true
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  price: {
    type: Number,
    required: true
  },
  observedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  receiptCaptureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReceiptCapture'
  },
  matchMethod: {
    type: String
  },
  workflowType: {
    type: String
  }
}, {
  timestamps: true
});

priceObservationSchema.index({ storeId: 1, observedAt: -1 });
priceObservationSchema.index({ productId: 1, observedAt: -1 });
priceObservationSchema.index({ unmappedProductId: 1, observedAt: -1 });

priceObservationSchema.pre('validate', function (next) {
  if (!this.productId && !this.unmappedProductId) {
    return next(new Error('PriceObservation requires productId or unmappedProductId'));
  }
  return next();
});

const PriceObservation = mongoose.model('PriceObservation', priceObservationSchema);

export default PriceObservation;
