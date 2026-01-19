import mongoose from 'mongoose';

const ledgerEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    delta: { type: Number, required: true },
    reason: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

export default mongoose.model('LedgerEntry', ledgerEntrySchema);
