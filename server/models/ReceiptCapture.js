import mongoose from 'mongoose';

const receiptCaptureSchema = new mongoose.Schema({
  // Idempotency key for duplicate prevention
  captureRequestId: {
    type: String,
    index: true,
    sparse: true // Allow null for old captures
  },
  
  // Store context
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    index: true
  },
  storeName: String,
  
  // Order context (optional)
  orderId: {
    type: String,
    index: true
  },
  
  // Receipt images (1-3 photos for long receipts)
  images: [{
    url: { type: String, required: true }, // Cloudinary/S3 URL
    thumbnailUrl: String,
    uploadedAt: { type: Date, default: Date.now },
    sequence: { type: Number, default: 0 } // Order for multi-page receipts
  }],
  
  // Parse status
  status: {
    type: String,
    enum: ['pending_parse', 'parsing', 'parsed', 'review_complete', 'committed', 'failed'],
    default: 'pending_parse',
    index: true
  },
  // Expiry for review/cleanup
  reviewExpiresAt: {
    type: Date,
    index: { expireAfterSeconds: 0, sparse: true }
  },
  
  // Draft line items from Gemini parse
  draftItems: [{
    lineIndex: { type: Number, required: true },
    receiptName: String, // Raw text from receipt
    normalizedName: String, // After normalization
    totalPrice: Number,
    quantity: Number,
    unitPrice: Number,
    tokens: {
      brand: String,
      size: String,
      flavor: [String]
    },
    priceDelta: Number,
    matchHistory: [{
      price: Number,
      observedAt: Date,
      matchMethod: String,
      matchConfidence: Number,
      priceType: String,
      promoDetected: Boolean,
      workflowType: String
    }],
    
    // Matching results
    suggestedProduct: {
      id: mongoose.Schema.Types.ObjectId,
      name: String,
      upc: String,
      sku: String
    },
    matchMethod: String, // 'upc' | 'sku' | 'alias_confirmed' | 'fuzzy_suggested' | 'none'
    matchConfidence: Number,
    
    // Review flags
    needsReview: { type: Boolean, default: false },
    reviewReason: String, // 'no_match' | 'low_confidence' | 'no_size_token' | 'large_price_change'
    
    // Binding (set during review)
    boundProductId: mongoose.Schema.Types.ObjectId,
    boundUpc: String,
    confirmedAt: Date,
    confirmedBy: String,
    
    // Promo detection
    promoDetected: { type: Boolean, default: false },
    priceType: { type: String, default: 'unknown' }
  }],
  
  // Parse metadata
  parseAttempts: { type: Number, default: 0 },
  lastParseAt: Date,
  parseError: String,
  geminiRequestId: String,
  parseMetrics: {
    providerAttempted: { type: String, default: null },
    providerUsed: { type: String, default: null },
    fallbackReason: { type: String, default: null },
    parseDurationMs: { type: Number, default: null },
    validItemCount: { type: Number, default: 0 },
    unmatchedCount: { type: Number, default: 0 }
  },
  
  // Stats
  totalItems: { type: Number, default: 0 },
  itemsNeedingReview: { type: Number, default: 0 },
  itemsConfirmed: { type: Number, default: 0 },
  itemsCommitted: { type: Number, default: 0 },
  
  // Audit
  createdBy: String,
  createdByUserId: String,
  createdByRole: {
    type: String,
    enum: ['DRIVER', 'MANAGER', 'OWNER']
  },
  source: {
    type: String,
    enum: ['driver_camera', 'management_upload', 'email_import']
  },
  reviewedBy: [String],
  committedBy: String,
  committedAt: Date,
  
  // Expiration (for pending reviews)
  reviewExpiresAt: Date
}, {
  timestamps: true
});

// Indexes
receiptCaptureSchema.index({ storeId: 1, status: 1 });
receiptCaptureSchema.index({ createdAt: -1 });
receiptCaptureSchema.index({ reviewExpiresAt: 1 }, { 
  sparse: true,
  expireAfterSeconds: 0 // Auto-delete expired reviews
});

// Methods
receiptCaptureSchema.methods.markParsing = function() {
  this.status = 'parsing';
  this.lastParseAt = new Date();
  this.parseAttempts += 1;
};

receiptCaptureSchema.methods.markParsed = function(items) {
  this.status = 'parsed';
  this.draftItems = items;
  this.totalItems = items.length;
  this.itemsNeedingReview = items.filter(i => i.needsReview).length;
  
  // Set review expiration (14 days)
  if (this.itemsNeedingReview > 0) {
    this.reviewExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  }
};

receiptCaptureSchema.methods.confirmItem = function(lineIndex, productId, upc, userId) {
  const item = this.draftItems.find(i => i.lineIndex === lineIndex);
  if (item) {
    item.boundProductId = productId;
    item.boundUpc = upc;
    item.confirmedAt = new Date();
    item.confirmedBy = userId;
    item.needsReview = false;
    
    this.itemsConfirmed = this.draftItems.filter(i => i.confirmedAt).length;
    this.itemsNeedingReview = this.draftItems.filter(i => i.needsReview).length;
    
    if (!this.reviewedBy.includes(userId)) {
      this.reviewedBy.push(userId);
    }
    
    if (this.itemsNeedingReview === 0) {
      this.status = 'review_complete';
      this.reviewExpiresAt = undefined;
    }
  }
};

const ReceiptCapture = mongoose.model('ReceiptCapture', receiptCaptureSchema);

export default ReceiptCapture;
