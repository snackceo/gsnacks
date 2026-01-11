import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    actorId: { type: String, required: true },
    details: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

export default mongoose.model('AuditLog', auditLogSchema);
