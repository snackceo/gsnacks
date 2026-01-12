import mongoose from 'mongoose';

const UpcItemSchema = new mongoose.Schema(
  {
    upc: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    depositValue: { type: Number, default: 0.1 },
    price: { type: Number, default: 0 },
    isGlass: { type: Boolean, default: false },
    containerType: {
      type: String,
      enum: ['glass', 'plastic', 'aluminum'],
      default: 'plastic'
    },
    sizeOz: { type: Number, default: 0 },
    isEligible: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model('UpcItem', UpcItemSchema);
