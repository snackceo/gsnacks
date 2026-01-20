import mongoose from 'mongoose';

// Maps products to stores with store-specific pricing and availability
const storeInventorySchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    sku: { type: String, index: true }, // Denormalized for fast lookups
    
    // Store-specific pricing
    cost: { type: Number, required: true }, // What you pay to buy it
    markup: { type: Number, default: 1.2 }, // Multiplier for customer price
    
    // Availability
    available: { type: Boolean, default: true },
    stockLevel: { 
      type: String, 
      enum: ['in-stock', 'low-stock', 'out-of-stock'], 
      default: 'in-stock' 
    },
    
    // Metadata
    lastVerified: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

// Compound index for fast store+product lookups
storeInventorySchema.index({ storeId: 1, productId: 1 }, { unique: true });
storeInventorySchema.index({ storeId: 1, sku: 1 });

export default mongoose.model('StoreInventory', storeInventorySchema);
