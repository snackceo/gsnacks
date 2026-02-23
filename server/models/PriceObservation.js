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
  cost: {
    type: Number
  },
  quantity: {
    type: Number,
    default: 1,
    min: 0
  },
  source: {
    type: String,
    default: 'receipt'
  },
  lineIndex: {
    type: Number
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

  if (this.cost === null || this.cost === undefined) {
    this.cost = this.price;
  }

  if ((this.price === null || this.price === undefined) && (this.cost !== null && this.cost !== undefined)) {
    this.price = this.cost;
  }

  if (this.quantity === null || this.quantity === undefined || Number.isNaN(Number(this.quantity))) {
    this.quantity = 1;
  }

  if (!this.source) {
    this.source = 'receipt';
  }

  return next();
});

const PriceObservation = mongoose.model('PriceObservation', priceObservationSchema);

export default PriceObservation;
