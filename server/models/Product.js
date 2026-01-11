import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true }, // used by frontend/cart
    name: { type: String, required: true },
    price: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },

    category: { type: String, default: 'DRINK' },
    image: { type: String, default: '' },
    isGlass: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Prevent model overwrite on hot reload / repeated imports
const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

export default Product;
