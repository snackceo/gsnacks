import mongoose from 'mongoose';

const ItemMatchSchema = new mongoose.Schema(
  {
    rawLine: String,
    nameCandidate: String,
    brandCandidate: String,
    sizeCandidate: String,
    quantity: Number,
    unitPrice: Number,
    lineTotal: Number,
    upcCandidate: String,
    requiresUpc: Boolean,
    match: {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      registryUpcId: { type: mongoose.Schema.Types.ObjectId, ref: 'UpcLookupCache' },
      confidence: Number,
      reason: String
    },
    actionSuggestion: {
      type: String,
      enum: ['LINK_UPC_TO_PRODUCT', 'CREATE_UPC', 'CREATE_PRODUCT', 'IGNORE']
    },
    warnings: [String]
  },
  { _id: false }
);

const StoreCandidateSchema = new mongoose.Schema(
  {
    name: String,
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: String
    },
    phone: String,
    storeType: String,
    confidence: Number,
    matchReason: String,
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' }
  },
  { _id: false }
);

const ReceiptParseJobSchema = new mongoose.Schema(
  {
    captureId: { type: String, required: true, index: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['QUEUED', 'PARSING', 'PARSED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'],
      default: 'QUEUED'
    },
    rawText: String,
    structured: mongoose.Schema.Types.Mixed,
    geminiOutput: mongoose.Schema.Types.Mixed,
    storeCandidate: StoreCandidateSchema,
    items: [ItemMatchSchema],
    warnings: [String],
    metadata: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

export default mongoose.model('ReceiptParseJob', ReceiptParseJobSchema);
