import mongoose from 'mongoose';

const ApprovalRequestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['REFUND', 'CREDIT_ADJUSTMENT', 'MEMBERSHIP_UPGRADE'],
      required: true
    },
    userId: { type: String, required: true },
    amount: { type: Number, default: 0 },
    orderId: { type: String },
    reason: { type: String },
    photoProof: { type: String },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    },
    processedAt: { type: Date }
  },
  { timestamps: true }
);

const ApprovalRequest =
  mongoose.models.ApprovalRequest ||
  mongoose.model('ApprovalRequest', ApprovalRequestSchema);

export default ApprovalRequest;
