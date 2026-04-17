import mongoose from 'mongoose';


const CREDIT_ORIGINS = ['RETURN', 'POINTS', 'MANUAL'];

const ledgerEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    delta: { type: Number, required: true },
    reason: { type: String, default: '' },
    origin: { type: String, enum: CREDIT_ORIGINS, required: true },
  },
  { timestamps: { updatedAt: false } }
);

export const CREDIT_ORIGINS_ENUM = CREDIT_ORIGINS;
export default mongoose.model('LedgerEntry', ledgerEntrySchema);
