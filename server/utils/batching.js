// Batching logic for multi-order delivery optimization
import Batch from '../models/Batch.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

// Capacity constraints
const MAX_BATCH_LOAD = 45; // Total handling points
const MAX_HEAVY_POINTS = 20; // Prevent all-water batches
const MAX_CUSTOMERS_PER_BATCH = 4;
const BATCH_WINDOW_MINUTES = 30; // Orders must be within 30 min of each other
const DELIVERY_ZONE_RADIUS_MILES = 5; // Addresses must be within 5 miles

/**
 * Calculate order load (handling points)
 * @param {Array} items - Cart items with productId and quantity
 * @returns {Object} { totalLoad, heavyPoints }
 */
export const calculateOrderLoad = async (items) => {
  let totalLoad = 0;
  let heavyPoints = 0;

  for (const item of items) {
    const candidate = String(item?.productId || '').trim();
    if (!candidate) continue;
    let product = null;
    if (mongoose.Types.ObjectId.isValid(candidate)) {
      product = await Product.findById(candidate).lean();
    }
    if (!product) {
      product = await Product.findOne({ frontendId: candidate }).lean();
    }
    if (!product) continue;

    const points = product.handlingPoints || 1;
    const itemLoad = points * item.quantity;

    totalLoad += itemLoad;
    
    // Track heavy items (handlingPoints >= 3)
    if (points >= 3) {
      heavyPoints += itemLoad;
    }
  }

  return { totalLoad, heavyPoints };
};

/**
 * Calculate simple geographic zone from address
 * (In production, use geocoding API)
 * @param {String} address
 * @returns {String} zone identifier
 */
export const calculateZone = (address) => {
  // Simplified: extract zip code or use first 5 chars
  const zipMatch = address.match(/\b\d{5}\b/);
  if (zipMatch) return `ZIP-${zipMatch[0]}`;
  
  // Fallback: hash of address
  return `ZONE-${address.substring(0, 10).replace(/\s/g, '')}`;
};

/**
 * Find eligible batch for a new order
 * @param {Object} orderData - { items, deliveryAddress, createdAt, storeIds }
 * @returns {Object|null} Batch or null if no match
 */
export const findEligibleBatch = async (orderData) => {
  const { items, deliveryAddress, createdAt, storeIds } = orderData;
  
  // Calculate order metrics
  const { totalLoad, heavyPoints } = await calculateOrderLoad(items);
  const zone = calculateZone(deliveryAddress);
  const orderTime = new Date(createdAt);

  // Find active batches in same window
  const windowStart = new Date(orderTime.getTime() - BATCH_WINDOW_MINUTES * 60 * 1000);
  const windowEnd = new Date(orderTime.getTime() + BATCH_WINDOW_MINUTES * 60 * 1000);

  const candidates = await Batch.find({
    status: 'pending',
    zone,
    windowStart: { $gte: windowStart },
    windowEnd: { $lte: windowEnd }
  }).lean();

  for (const batch of candidates) {
    // Check capacity constraints
    const wouldExceedLoad = (batch.totalLoad + totalLoad) > MAX_BATCH_LOAD;
    const wouldExceedHeavy = (batch.totalHeavyPoints + heavyPoints) > MAX_HEAVY_POINTS;
    const wouldExceedCustomers = batch.customerCount >= MAX_CUSTOMERS_PER_BATCH;

    if (wouldExceedLoad || wouldExceedHeavy || wouldExceedCustomers) {
      continue;
    }

    // Check store compatibility (same stores or overlapping)
    const batchStoreIds = batch.storeStops.map(s => s.storeId.toString());
    const hasOverlap = storeIds.some(id => batchStoreIds.includes(id.toString()));
    
    if (hasOverlap || batchStoreIds.length === 0) {
      return batch;
    }
  }

  return null;
};

/**
 * Create a new batch for an order
 * @param {Object} orderData
 * @returns {Object} New batch
 */
export const createBatch = async (orderData) => {
  const { items, deliveryAddress, createdAt, orderId } = orderData;
  
  const { totalLoad, heavyPoints } = await calculateOrderLoad(items);
  const zone = calculateZone(deliveryAddress);
  const orderTime = new Date(createdAt);
  
  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  
  const batch = new Batch({
    batchId,
    orderIds: [orderId],
    zone,
    totalLoad,
    totalHeavyPoints: heavyPoints,
    customerCount: 1,
    windowStart: new Date(orderTime.getTime() - BATCH_WINDOW_MINUTES * 60 * 1000),
    windowEnd: new Date(orderTime.getTime() + BATCH_WINDOW_MINUTES * 60 * 1000),
    customerStops: [{
      orderId,
      address: deliveryAddress,
      sequence: 1
    }]
  });

  await batch.save();
  return batch;
};

/**
 * Add order to existing batch
 * @param {String} batchId
 * @param {Object} orderData
 * @returns {Object} Updated batch
 */
export const addOrderToBatch = async (batchId, orderData) => {
  const { items, deliveryAddress, orderId } = orderData;
  const { totalLoad, heavyPoints } = await calculateOrderLoad(items);

  const batch = await Batch.findOne({ batchId });
  if (!batch) throw new Error('Batch not found');

  // Update capacity
  batch.totalLoad += totalLoad;
  batch.totalHeavyPoints += heavyPoints;
  batch.customerCount += 1;
  batch.orderIds.push(orderId);
  
  batch.customerStops.push({
    orderId,
    address: deliveryAddress,
    sequence: batch.customerStops.length + 1
  });

  batch.routeOptimized = false; // Mark for re-optimization
  await batch.save();
  
  return batch;
};

/**
 * Get batch capacity summary
 * @param {String} batchId
 * @returns {Object} Capacity metrics
 */
export const getBatchCapacity = async (batchId) => {
  const batch = await Batch.findOne({ batchId }).lean();
  if (!batch) return null;

  return {
    totalLoad: batch.totalLoad,
    maxLoad: MAX_BATCH_LOAD,
    loadPercent: Math.round((batch.totalLoad / MAX_BATCH_LOAD) * 100),
    totalHeavyPoints: batch.totalHeavyPoints,
    maxHeavyPoints: MAX_HEAVY_POINTS,
    customerCount: batch.customerCount,
    maxCustomers: MAX_CUSTOMERS_PER_BATCH,
    canAddMore: batch.totalLoad < MAX_BATCH_LOAD && batch.customerCount < MAX_CUSTOMERS_PER_BATCH
  };
};

export default {
  calculateOrderLoad,
  calculateZone,
  findEligibleBatch,
  createBatch,
  addOrderToBatch,
  getBatchCapacity,
  MAX_BATCH_LOAD,
  MAX_HEAVY_POINTS,
  MAX_CUSTOMERS_PER_BATCH
};
