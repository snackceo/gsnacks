import mongoose from 'mongoose';

const receiptNoiseRuleSchema = new mongoose.Schema({
  normalizedName: {
    type: String,
    required: true
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  rawNames: [{
    name: String,
    firstSeen: Date,
    occurrences: { type: Number, default: 1 }
  }],
  createdBy: String,
  lastSeenAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: { createdAt: true, updatedAt: false } });

receiptNoiseRuleSchema.index({ storeId: 1, normalizedName: 1 }, { unique: true });
receiptNoiseRuleSchema.index({ storeId: 1, lastSeenAt: -1 });

const ReceiptNoiseRule = mongoose.model('ReceiptNoiseRule', receiptNoiseRuleSchema);

export default ReceiptNoiseRule;
