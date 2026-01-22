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
    cost: { type: Number, required: true }, // Internal base cost (used when no observed price)
    markup: { type: Number, default: 1.2 }, // Multiplier for customer price
    
    // Receipt-based observed pricing (real-world verification)
    observedPrice: { type: Number }, // Last observed shelf/regular price (preferred for selection/pricing)
    observedAt: { type: Date }, // When price was last observed
    
    priceHistory: [{
      price: { type: Number, required: true },
      observedAt: { type: Date, required: true },
      storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
      captureId: { type: String }, // Receipt capture ID (idempotency key)
      orderId: { type: String },
      quantity: { type: Number },
      receiptImageUrl: { type: String }, // Cloudinary/S3 URL
      receiptThumbnailUrl: { type: String }, // Small preview
      matchMethod: { 
        type: String, 
        enum: ['upc', 'sku', 'alias_confirmed', 'fuzzy_confirmed', 'fuzzy_suggested', 'manual_confirm'] 
      },
      matchConfidence: { type: Number, min: 0, max: 1 },
      confirmedBy: { type: String }, // User ID
      priceType: { 
        type: String, 
        enum: ['regular', 'net_paid', 'promo', 'unknown'], 
        default: 'unknown' 
      },
      promoDetected: { type: Boolean, default: false },
      workflowType: {
        type: String,
        enum: ['new_product', 'update_price']
      }
    }],
    
    // Track which captures have been applied (idempotency)
    appliedCaptures: [{
      captureId: String,
      lineIndex: Number,
      appliedAt: Date
    }],
    
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
storeInventorySchema.index({ storeId: 1, updatedAt: -1 }); // Performance monitoring

// Add virtual for UPC lookup from Product
storeInventorySchema.virtual('upc').get(function() {
  return this.productId?.upc;
});

export default mongoose.model('StoreInventory', storeInventorySchema);
