import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: { updatedAt: false } }
);

export default mongoose.model('AuditLog', auditLogSchema);
