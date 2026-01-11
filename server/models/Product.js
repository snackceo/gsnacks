import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    stock: { type: Number, required: true },
    category: String,
    image: String,
    isGlass: Boolean,
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model('Product', ProductSchema);
