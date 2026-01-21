// Store selection and multi-waypoint routing for shopping runs
import Store from '../models/Store.js';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;

const resolveProductForCartItem = async (productId) => {
  const candidate = String(productId || '').trim();
  if (!candidate) return null;

  if (mongoose.Types.ObjectId.isValid(candidate)) {
    const byId = await Product.findById(candidate).lean();
    if (byId) return byId;
  }

  return Product.findOne({ frontendId: candidate }).lean();
};

/**
 * Find cheapest stores to fulfill a cart
 * @param {Array} cartItems - [{ productId, quantity }]
 * @returns {Object} { storePlans, unfulfilled }
 */
export const findCheapestStores = async (cartItems) => {
  const storePlans = new Map(); // storeId -> { items: [], totalCost: 0 }
  const unfulfilled = [];
  const resolvePrice = inventory => inventory.cost;

  for (const item of cartItems) {
    const product = await resolveProductForCartItem(item.productId);
    if (!product) {
      unfulfilled.push({ ...item, reason: 'Product not found' });
      continue;
    }

    // Find all stores that carry this product
    const inventory = await StoreInventory.find({
      productId: product._id,
      available: true
    })
      .populate('storeId')
      .lean();

    if (inventory.length === 0) {
      unfulfilled.push({ ...item, productName: product.name, reason: 'Not available at any store' });
      continue;
    }

    // Pick cheapest store for this item
    const cheapest = inventory.reduce((min, curr) =>
      resolvePrice(curr) < resolvePrice(min) ? curr : min
    );
    const basisPrice = resolvePrice(cheapest);

    const storeId = cheapest.storeId._id.toString();
    
    if (!storePlans.has(storeId)) {
      storePlans.set(storeId, {
        storeId: cheapest.storeId._id,
        storeName: cheapest.storeId.name,
        storeType: cheapest.storeId.storeType,
        location: cheapest.storeId.location,
        items: [],
        totalCost: 0
      });
    }

    const plan = storePlans.get(storeId);
    plan.items.push({
      productId: product.frontendId,
      productName: product.name,
      quantity: item.quantity,
      cost: cheapest.cost,
      markup: cheapest.markup,
      observedPrice: cheapest.observedPrice,
      itemTotal: basisPrice * item.quantity
    });
    plan.totalCost += basisPrice * item.quantity;
  }

  return {
    storePlans: Array.from(storePlans.values()),
    unfulfilled
  };
};

/**
 * Optimize store selection (prefer single store when possible)
 * @param {Object} fulfillmentResult - from findCheapestStores
 * @returns {Object} Optimized plan
 */
export const optimizeStoreSelection = async (fulfillmentResult) => {
  const { storePlans } = fulfillmentResult;

  if (storePlans.length <= 1) {
    return fulfillmentResult; // Already optimal
  }

  // Strategy: Check if primary store (most items) can cover everything at reasonable cost
  const primaryStore = storePlans.reduce((max, curr) => 
    curr.items.length > max.items.length ? curr : max
  );

  const primaryStoreId = primaryStore.storeId;
  const otherItems = storePlans
    .filter(p => p.storeId.toString() !== primaryStoreId.toString())
    .flatMap(p => p.items);

  // Check if primary store has these items
  const canConsolidate = await Promise.all(
    otherItems.map(async (item) => {
      const product = await resolveProductForCartItem(item.productId);
      if (!product) return null;
      const alt = await StoreInventory.findOne({
        storeId: primaryStoreId,
        productId: product._id,
        available: true
      }).lean();
      
      if (!alt) return null;
      
      // Accept if price difference is < 15%
      const altBasisPrice = alt.cost;
      const itemBasisPrice = item.cost;
      const priceDiff = ((altBasisPrice - itemBasisPrice) / itemBasisPrice) * 100;
      if (priceDiff > 15) return null;
      
      return { 
        ...item, 
        productId: product.frontendId,
        cost: alt.cost, 
        markup: alt.markup,
        observedPrice: alt.observedPrice
      };
    })
  );

  const allConsolidated = canConsolidate.every(x => x !== null);

  if (allConsolidated) {
    // Use single store
    return {
      storePlans: [{
        ...primaryStore,
        items: [...primaryStore.items, ...canConsolidate.filter(x => x)],
        totalCost: primaryStore.totalCost + canConsolidate.reduce((sum, item) => {
          if (!item) return sum;
          return sum + (item.cost * item.quantity);
        }, 0)
      }],
      unfulfilled: fulfillmentResult.unfulfilled,
      consolidated: true
    };
  }

  // Keep original multi-store plan
  return { ...fulfillmentResult, consolidated: false };
};

/**
 * Calculate route with multiple waypoints (hub -> stores -> customers)
 * @param {Array} storeStops - [{ location: { lat, lng } }] - First should be hub
 * @param {Array} customerAddresses - [{ lat, lng }] or address strings
 * @returns {Object} { distance, duration, route }
 */
export const calculateMultiStopRoute = async (storeStops, customerAddresses) => {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Google Maps API key not configured');
  }

  if (!storeStops || storeStops.length === 0) {
    throw new Error('Store stops required');
  }

  // First stop is the hub (origin)
  const hub = storeStops[0];
  const origin = `${hub.location.lat},${hub.location.lng}`;
  
  // Last customer is destination
  const lastCustomer = customerAddresses[customerAddresses.length - 1];
  const destination = typeof lastCustomer === 'string' 
    ? lastCustomer 
    : `${lastCustomer.lat},${lastCustomer.lng}`;
  
  // Middle waypoints: remaining stores + intermediate customers
  const waypoints = [
    ...storeStops.slice(1).map(s => `${s.location.lat},${s.location.lng}`),
    ...customerAddresses.slice(0, -1).map(c => 
      typeof c === 'string' ? c : `${c.lat},${c.lng}`
    )
  ].join('|');

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  if (waypoints) {
    url.searchParams.set('waypoints', `optimize:true|${waypoints}`);
  }
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);

  try {
    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      throw new Error(`Route calculation failed: ${data.status}`);
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    // Sum all legs
    const totalDistance = route.legs.reduce((sum, l) => sum + l.distance.value, 0) / 1609.34; // meters to miles
    const totalDuration = route.legs.reduce((sum, l) => sum + l.duration.value, 0) / 60; // seconds to minutes

    return {
      distance: Math.round(totalDistance * 10) / 10,
      duration: Math.round(totalDuration),
      route: route.legs.map((l, i) => ({
        from: l.start_address,
        to: l.end_address,
        distance: Math.round(l.distance.value / 1609.34 * 10) / 10,
        duration: Math.round(l.duration.value / 60)
      }))
    };
  } catch (error) {
    console.error('Multi-stop route calculation failed:', error);
    throw error;
  }
};

/**
 * Calculate simple nearest-neighbor route order
 * (Heuristic alternative to Google optimization)
 * @param {Object} hubLocation - { lat, lng }
 * @param {Array} stops - [{ address, location: {lat, lng} }]
 * @returns {Array} Ordered stops
 */
export const orderStopsNearestNeighbor = (hubLocation, stops) => {
  if (stops.length <= 1) return stops;

  const ordered = [];
  let current = { location: hubLocation };
  const remaining = [...stops];

  while (remaining.length > 0) {
    // Find nearest stop to current position
    let nearestIndex = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(current.location, remaining[i].location);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    }

    const nearest = remaining.splice(nearestIndex, 1)[0];
    ordered.push(nearest);
    current = nearest;
  }

  return ordered;
};

/**
 * Haversine distance between two lat/lng points
 */
function haversineDistance(coord1, coord2) {
  const R = 3959; // Earth radius in miles
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default {
  findCheapestStores,
  optimizeStoreSelection,
  calculateMultiStopRoute,
  orderStopsNearestNeighbor
};
