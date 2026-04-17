import mongoose from 'mongoose';

const cashPayoutSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    driverId: { type: String, default: '', index: true },
    amount: { type: Number, required: true },
    createdBy: { type: String, default: '' },
    status: { type: String, default: 'CREATED' }
  },
  { timestamps: true }
);

export default mongoose.model('CashPayout', cashPayoutSchema);
