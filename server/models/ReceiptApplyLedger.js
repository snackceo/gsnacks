import mongoose from 'mongoose';

const receiptApplyLedgerSchema = new mongoose.Schema(
  {
    captureId: { type: String, required: true, index: true },
    lineIndex: { type: Number, required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
    idempotencyKey: { type: String, required: true },
    appliedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

// Enforce single application per (capture,line,product)
receiptApplyLedgerSchema.index({ captureId: 1, lineIndex: 1, productId: 1 }, { unique: true });

export default mongoose.model('ReceiptApplyLedger', receiptApplyLedgerSchema);
