import Product from '../models/Product.js';
import { generateSku } from '../utils/sku.js';

export const findProducts = async () => {
  return await Product.find({}).sort({ createdAt: -1 }).lean();
};

export const findOneProduct = async (paramId) => {
  return await Product.findOne({ $or: [{ frontendId: paramId }, { sku: paramId }] }).lean();
};

export const searchProducts = async (query) => {
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\]/g, '\$&'), 'i');
  return await Product.find({
    $or: [{ name: regex }, { sku: regex }, { upc: regex }]
  })
    .sort({ updatedAt: -1 })
    .limit(25)
    .lean();
};

export const createProduct = async (productData) => {
  const sku = await generateSku();
  const newProduct = { ...productData, sku, frontendId: sku };
  return await Product.create(newProduct);
};

export const updateProduct = async (paramId, updates) => {
  return await Product.findOneAndUpdate(
    { $or: [{ frontendId: paramId }, { sku: paramId }] },
    updates,
    { new: true }
  ).lean();
};

export const deleteProduct = async (paramId) => {
  return await Product.findOneAndDelete({ $or: [{ frontendId: paramId }, { sku: paramId }] }).lean();
};
