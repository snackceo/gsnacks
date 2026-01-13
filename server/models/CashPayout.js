import mongoose from 'mongoose';

const cashPayoutSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    userId: { type: String, required: true },
    driverId: { type: String, default: '' },
    amount: { type: Number, required: true },
    createdBy: { type: String, default: '' },
    status: { type: String, default: 'CREATED' }
  },
  { timestamps: true }
);

export default mongoose.model('CashPayout', cashPayoutSchema);
