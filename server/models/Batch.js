import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    
    // Batch status
    status: {
      type: String,
      enum: ['pending', 'assigned', 'in-progress', 'completed', 'cancelled'],
      default: 'pending',
      index: true
    },
    
    // Orders in this batch
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true }],
    
    // Store stops
    storeStops: [{
      storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
      storeName: String,
      sequence: Number, // Order in route
      estimatedArrival: Date
    }],
    
    // Customer stops
    customerStops: [{
      orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
      address: String,
      sequence: Number,
      estimatedArrival: Date
    }],
    
    // Capacity tracking
    totalLoad: { type: Number, default: 0 }, // Sum of handling points
    totalHeavyPoints: { type: Number, default: 0 }, // Sum of heavy item points
    customerCount: { type: Number, default: 0 },
    
    // Route details
    totalDistance: { type: Number, default: 0 }, // miles
    totalDuration: { type: Number, default: 0 }, // minutes
    estimatedStartTime: { type: Date },
    estimatedEndTime: { type: Date },
    
    // Assignment
    driverId: { type: String, index: true },
    assignedAt: { type: Date },
    
    // Delivery window
    windowStart: { type: Date, required: true, index: true },
    windowEnd: { type: Date, required: true },
    
    // Delivery zone
    zone: { type: String, index: true }, // Geographic cluster identifier
    
    // Optimization metadata
    primaryStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
    routeOptimized: { type: Boolean, default: false },
    lastRouteUpdate: { type: Date }
  },
  { timestamps: true }
);

// Indexes for efficient querying
batchSchema.index({ status: 1, windowStart: 1 });
batchSchema.index({ zone: 1, status: 1 });
batchSchema.index({ driverId: 1, status: 1 });

export default mongoose.model('Batch', batchSchema);
