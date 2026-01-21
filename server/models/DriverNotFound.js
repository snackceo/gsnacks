import mongoose from 'mongoose';

const driverNotFoundSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: String,
    required: true
  },
  items: [{
    name: {
      type: String,
      required: true
    },
    sku: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    price: {
      type: Number,
      required: true
    },
    store: {
      type: String,
      required: true
    },
    storeId: {
      type: String,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for fast lookups
driverNotFoundSchema.index({ driverId: 1, orderId: 1 });

const DriverNotFound = mongoose.model('DriverNotFound', driverNotFoundSchema);

export default DriverNotFound;
