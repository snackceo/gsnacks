import mongoose from 'mongoose';

const returnUpcsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // One return session per user
  },
  upcs: [{
    upc: {
      type: String,
      required: true
    },
    productName: String,
    count: {
      type: Number,
      default: 1
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  eligibilityCache: {
    type: Map,
    of: Boolean
  },
}, {
  timestamps: true
});

// Index for fast user lookups
returnUpcsSchema.index({ userId: 1 });

const ReturnUpcs = mongoose.model('ReturnUpcs', returnUpcsSchema);

export default ReturnUpcs;
