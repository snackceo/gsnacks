import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

export default mongoose.model('AuditLog', auditLogSchema);
