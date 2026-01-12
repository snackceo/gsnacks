import mongoose from 'mongoose';

const scanSessionSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    driverId: { type: String, default: '' },
    sessionId: { type: String, default: '' },
    startedAt: { type: Date },
    stage: { type: String, default: '' },
    summary: { type: Object, default: {} },
    scanEvents: { type: [Object], default: [] },
    quantityEvents: { type: [Object], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model('ScanSession', scanSessionSchema);
