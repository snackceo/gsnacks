import mongoose from 'mongoose';

const ReturnVerificationSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scans: [{
      upc: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }],
    recognizedCount: { type: Number, default: 0 },
    unrecognizedCount: { type: Number, default: 0 },
    duplicatesCount: { type: Number, default: 0 },
    conditionFlags: [{ type: String }],
    submittedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED'],
      default: 'SUBMITTED'
    },
    reviewNotes: { type: String }
  },
  { timestamps: true }
);

export default mongoose.model('ReturnVerification', ReturnVerificationSchema);