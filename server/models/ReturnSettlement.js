import mongoose from 'mongoose';

const ReturnSettlementSchema = new mongoose.Schema(
  {
    verificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReturnVerification', required: true, index: true },
    finalAcceptedCount: { type: Number, required: true },
    creditAmount: { type: Number, default: 0 },
    cashAmount: { type: Number, default: 0 },
    feesApplied: { type: Number, default: 0 },
    settledAt: { type: Date, default: Date.now },
    settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('ReturnSettlement', ReturnSettlementSchema);