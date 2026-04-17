import mongoose from 'mongoose';

const inventoryAuditSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    location: { type: String, required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    countedQuantity: { type: Number, required: true }
  },
  { timestamps: true }
);

export default mongoose.model('InventoryAudit', inventoryAuditSchema);