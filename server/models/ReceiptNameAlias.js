import mongoose from 'mongoose';

const receiptNameAliasSchema = new mongoose.Schema({
  // Normalized receipt name (e.g., "COCA COLA 12 PACK")
  normalizedName: {
    type: String,
    required: true
  },
  
  // Store where this alias was observed
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  
  // Product this alias maps to
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  
  // UPC for quick reference
  upc: {
    type: String,
  },
  
  // How many times a human confirmed this mapping
  confirmedCount: {
    type: Number,
    default: 0
  },
  
  // Last time a human confirmed this mapping
  lastConfirmedAt: Date,
  
  // Last time this alias was seen on a receipt
  lastSeenAt: {
    type: Date,
    default: Date.now
  },
  
  // Confidence score (0-1) based on confirmation count and recency
  matchConfidence: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  
  // Category hint for guardrail (beverage, dairy, snack, etc.)
  category: String,
  
  // Whether size token was detected in normalized name
  hasSizeToken: Boolean,
  
  // Original receipt names that matched this (for debugging)
  rawNames: [{
    name: String,
    firstSeen: Date,
    occurrences: { type: Number, default: 1 }
  }],
  
  // Concurrency control token for alias confirm/reject actions
  lockToken: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString()
  },
  
  lockTokenUpdatedAt: {
    type: Date,
    default: Date.now
  },
  
  // Metadata
  createdBy: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for fast lookups
receiptNameAliasSchema.index({ storeId: 1, normalizedName: 1 }, { unique: true });
receiptNameAliasSchema.index({ storeId: 1, upc: 1 }); // Reverse lookup
receiptNameAliasSchema.index({ storeId: 1, lastSeenAt: -1 }); // Cleanup jobs
receiptNameAliasSchema.index({ confirmedCount: 1, matchConfidence: 1 });

const ReceiptNameAlias = mongoose.model('ReceiptNameAlias', receiptNameAliasSchema);

export default ReceiptNameAlias;
