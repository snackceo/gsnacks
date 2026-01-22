// API routes for multi-store shopping and batching
import express from 'express';
import crypto from 'crypto';
import { authRequired } from '../utils/helpers.js';
import { findCheapestStores, optimizeStoreSelection, calculateMultiStopRoute } from '../utils/storeRouting.js';
import { calculateOrderLoad, findEligibleBatch, createBatch, addOrderToBatch, getBatchCapacity } from '../utils/batching.js';
import { getDeliveryOptions } from '../utils/deliveryFees.js';
import StoreInventory from '../models/StoreInventory.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

const router = express.Router();

const normalizeCartItems = async (cartItems) => {
  const ids = cartItems.map(item => String(item.productId || '').trim()).filter(Boolean);
  const objectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
  const products = await Product.find({
    $or: [
      { frontendId: { $in: ids } },
      { _id: { $in: objectIds } }
    ]
  }).lean();
  const productsByFrontendId = new Map(products.map(p => [p.frontendId, p]));
  const productsById = new Map(products.map(p => [p._id.toString(), p]));

  const normalizedItems = cartItems.map(item => {
    const key = String(item.productId || '').trim();
    const product = productsByFrontendId.get(key) || productsById.get(key);
    if (!product) return item;
    return { ...item, productId: product.frontendId };
  });

  return { normalizedItems, productsByFrontendId };
};

const resolveStoreSelectionContext = (body, deliveryAddress) => {
  const rawTimestamp = body?.timestamp ?? body?.requestedAt;
  const parsedTimestamp = rawTimestamp ? new Date(rawTimestamp) : null;
  const timestamp = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    ? parsedTimestamp
    : new Date();
  const timeZone = body?.timeZone || deliveryAddress?.timeZone || null;
  return { timestamp, timeZone };
};

const formatMinutesToLabel = minutes => {
  if (!Number.isFinite(minutes)) return null;
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour12 = ((hour24 + 11) % 12) + 1;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const minuteLabel = String(minute).padStart(2, '0');
  return `${hour12}:${minuteLabel} ${suffix}`;
};

const formatDayLabel = dayKey => {
  if (!dayKey) return null;
  return dayKey.slice(0, 1).toUpperCase() + dayKey.slice(1);
};

const formatNextOpenLabel = nextOpen => {
  if (!nextOpen?.dayKey || !Number.isFinite(nextOpen?.minutes)) return null;
  const timeLabel = formatMinutesToLabel(nextOpen.minutes);
  if (!timeLabel) return null;
  const dayLabel = formatDayLabel(nextOpen.dayKey);
  return `${dayLabel} ${timeLabel}`;
};

const geocodeDeliveryAddress = async address => {
  const trimmed = String(address || '').trim();
  if (!trimmed) return null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Google Maps API key not configured');
  }
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', trimmed);
  url.searchParams.set('key', apiKey);
  const response = await fetch(url.toString());
  const data = await response.json();
  if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) {
    throw new Error(`Geocode failed: ${data.status}`);
  }
  const location = data.results[0].geometry.location;
  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: data.results[0].formatted_address
  };
};

// Checkout preview: Calculate route, fees, and total for customer
router.post('/shopping/checkout-preview', authRequired, async (req, res) => {
  try {
    const { cartItems, deliveryAddress } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart items required' });
    }

    let resolvedDeliveryAddress = deliveryAddress;
    if ((!deliveryAddress?.lat || !deliveryAddress?.lng) && deliveryAddress) {
      const addressValue = typeof deliveryAddress === 'string'
        ? deliveryAddress
        : deliveryAddress?.address || deliveryAddress?.formattedAddress;
      if (addressValue) {
        const geocoded = await geocodeDeliveryAddress(addressValue);
        resolvedDeliveryAddress = {
          ...deliveryAddress,
          lat: geocoded.lat,
          lng: geocoded.lng,
          formattedAddress: geocoded.formattedAddress || deliveryAddress?.formattedAddress
        };
      }
    }

    if (!resolvedDeliveryAddress?.lat || !resolvedDeliveryAddress?.lng) {
      return res.status(400).json({ error: 'Valid delivery address required' });
    }

    const { normalizedItems, productsByFrontendId } = await normalizeCartItems(cartItems);
    const storeSelectionContext = resolveStoreSelectionContext(req.body, resolvedDeliveryAddress);

    // Find cheapest stores for fulfillment
    const fulfillment = await findCheapestStores(normalizedItems, storeSelectionContext);
    const optimized = await optimizeStoreSelection(fulfillment, storeSelectionContext);

    if (optimized.unfulfilled.length > 0) {
      const hasClosedStore = optimized.unfulfilled.some(item =>
        item.reason === 'No open stores available'
      );
      return res.status(400).json({
        error: hasClosedStore
          ? 'Some items are unavailable because no stores are open'
          : 'Some items unavailable',
        unfulfilled: optimized.unfulfilled
      });
    }

    // Get store locations
    const stores = await Store.find({
      _id: { $in: optimized.storePlans.map(p => p.storeId) }
    }).lean();

    // Get hub location (DB first, fallback to env HUB_LAT/HUB_LNG)
    let hub = await Store.findOne({ storeType: 'hub' }).lean();
    if (!hub) {
      const envLat = Number(process.env.HUB_LAT);
      const envLng = Number(process.env.HUB_LNG);
      if (Number.isFinite(envLat) && Number.isFinite(envLng)) {
        hub = { location: { lat: envLat, lng: envLng }, name: 'Hub (env)' };
      } else {
        return res.status(500).json({
          error: 'Hub not configured. Add a Store with storeType="hub" or set HUB_LAT and HUB_LNG environment variables.'
        });
      }
    }

    // Calculate route: hub → stores → customer
    const route = await calculateMultiStopRoute(
      [{ location: hub.location }, ...stores.map(s => ({ location: s.location }))],
      [resolvedDeliveryAddress]
    );

    // Get customer-facing prices from Product model
    const roundCurrency = value => Math.round(Number(value || 0) * 100) / 100;
    const storePricingByProductId = new Map();
    const storePricingDetails = optimized.storePlans.map(plan => {
      const items = plan.items.map(item => {
        const useObservedPrice = Number.isFinite(item.observedPrice);
        const observedPriceIsCost = item.observedPriceIsCost === true;
        const basePrice = useObservedPrice
          ? (observedPriceIsCost ? item.observedPrice * item.markup : item.observedPrice)
          : item.cost * item.markup;
        const unitPrice = roundCurrency(basePrice);
        const total = roundCurrency(unitPrice * item.quantity);
        const priceSource = useObservedPrice
          ? (observedPriceIsCost ? 'observedCostWithMarkup' : 'observedShelfPrice')
          : 'costMarkup';
        storePricingByProductId.set(String(item.productId), {
          storeId: plan.storeId,
          storeName: plan.storeName,
          storeType: plan.storeType,
          cost: item.cost,
          markup: item.markup,
          observedPrice: item.observedPrice,
          unitPrice,
          priceSource,
          productName: item.productName,
          availability: item.availability
        });
        return {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          cost: item.cost,
          markup: item.markup,
          observedPrice: item.observedPrice ?? null,
          priceSource,
          unitPrice,
          total,
          availability: item.availability
        };
      });
      const customerTotal = roundCurrency(items.reduce((sum, item) => sum + item.total, 0));
      return {
        storeId: plan.storeId,
        storeName: plan.storeName,
        storeType: plan.storeType,
        totalCost: roundCurrency(plan.totalCost),
        customerTotal,
        items
      };
    });

    // Calculate list amount (what customer pays for products)
    let listAmount = 0;
    const itemizedList = [];
    for (const item of normalizedItems) {
      const product = productsByFrontendId.get(item.productId);
      const storePricing = storePricingByProductId.get(String(item.productId));
      const availability = storePricing?.availability;
      const nextOpenLabel = availability?.nextOpen ? formatNextOpenLabel(availability.nextOpen) : null;
      const unitPrice = storePricing?.unitPrice ?? 0;
      const itemTotal = roundCurrency(unitPrice * item.quantity);
      listAmount += itemTotal;
      itemizedList.push({
        name: storePricing?.productName ?? product?.name ?? 'Unknown',
        quantity: item.quantity,
        price: unitPrice,
        total: itemTotal,
        availability: availability ? {
          status: availability.status,
          reason: availability.reason,
          nextOpen: availability.nextOpen,
          nextOpenLabel,
          timeZone: availability.nextOpen?.timeZone ?? null
        } : null,
        store: storePricing ? {
          id: storePricing.storeId,
          name: storePricing.storeName,
          type: storePricing.storeType,
          cost: storePricing.cost,
          markup: storePricing.markup,
          observedPrice: storePricing.observedPrice ?? null,
          priceSource: storePricing.priceSource
        } : null
      });
    }

    // Get user tier and compute fees via centralized deliveryFees
    const tier = req.user?.tier || 'COMMON';
    const fees = await getDeliveryOptions({
      orderType: 'DELIVERY_PURCHASE',
      tier,
      distanceMiles: route.distance,
      items: normalizedItems,
      productsByFrontendId
    });

    const totalFees = fees.routeFee + fees.distanceFee + fees.largeOrderFee + fees.heavyItemFee;
    const grandTotal = listAmount + totalFees;

    // Check batch eligibility
    const { totalLoad, heavyPoints } = await calculateOrderLoad(normalizedItems);
    const batch = await findEligibleBatch({
      items: normalizedItems,
      deliveryAddress: resolvedDeliveryAddress,
      createdAt: new Date(),
      storeIds: stores.map(s => s._id)
    });

    // Create pricing lock (signed snapshot so fees won't change later)
    const pricingPayload = {
      routeFee: Math.round(fees.routeFee * 100) / 100,
      distanceFee: Math.round(fees.distanceFee * 100) / 100,
      largeOrderFee: Math.round(fees.largeOrderFee * 100) / 100,
      heavyItemFee: Math.round(fees.heavyItemFee * 100) / 100,
      distanceMiles: Math.round(route.distance * 10) / 10,
      tier,
      generatedAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000
    };
    const secret = process.env.PRICING_SECRET || process.env.JWT_SECRET || 'dev-secret';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(pricingPayload))
      .digest('hex');
    const pricingLock = { payload: pricingPayload, signature };

    const scheduledItems = [];
    for (const plan of optimized.storePlans) {
      for (const item of plan.items) {
        if (item.availability?.status === 'scheduled') {
          scheduledItems.push({
            productId: item.productId,
            productName: item.productName,
            storeId: plan.storeId,
            storeName: plan.storeName,
            nextOpen: item.availability.nextOpen,
            nextOpenLabel: formatNextOpenLabel(item.availability.nextOpen),
            timeZone: item.availability.nextOpen?.timeZone ?? null
          });
        }
      }
    }

    const fulfillment = scheduledItems.length > 0 ? {
      status: 'scheduled',
      message: 'Some items are only available when stores reopen. Checkout will schedule fulfillment for the next opening time.',
      scheduledItems
    } : {
      status: 'open',
      message: 'All items are available for immediate fulfillment.',
      scheduledItems: []
    };

    // Return customer preview with delivery options and pricing lock
    return res.json({
      ok: true,
      items: itemizedList,
      listAmount: Math.round(listAmount * 100) / 100,
      fees: {
        routeFee: fees.routeFee,
        distanceFee: fees.distanceFee,
        largeOrderFee: fees.largeOrderFee,
        heavyItemFee: fees.heavyItemFee,
        total: Math.round(totalFees * 100) / 100
      },
      total: Math.round(grandTotal * 100) / 100,
      pricingLock,
      deliveryOptions: {
        standard: {
          type: 'standard',
          eta: `${Math.round(route.duration + 30)} minutes`,
          description: 'Direct delivery - fastest',
          fees: Math.round(totalFees * 100) / 100,
          total: Math.round(grandTotal * 100) / 100
        },
        batch: batch ? {
          type: 'batch',
          eta: `${Math.round(route.duration + 60)}-${Math.round(route.duration + 120)} minutes`,
          description: 'Grouped delivery - may take longer but same price',
          fees: Math.round(totalFees * 100) / 100,
          total: Math.round(grandTotal * 100) / 100,
          batchId: batch.batchId,
          customersInBatch: batch.customerCount
        } : null
      },
      route: {
        distance: route.distance,
        duration: route.duration
      },
      capacity: {
        orderLoad: totalLoad,
        heavyPoints
      },
      fulfillment,
      tier: {
        name: tier,
        discount: fees.routeFeeDiscountPercent
      },
      stores: stores.map(s => ({ id: s._id, name: s.name, type: s.storeType })),
      storePricing: storePricingDetails
    });
  } catch (error) {
    console.error('Checkout preview error:', error);
    return res.status(500).json({ error: 'Failed to calculate checkout preview' });
  }
});

// Get store catalog (cheapest stores for cart)
router.post('/shopping/find-stores', authRequired, async (req, res) => {
  try {
    const { cartItems } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart items required' });
    }

    // Find cheapest stores
    const storeSelectionContext = resolveStoreSelectionContext(req.body);
    const fulfillment = await findCheapestStores(cartItems, storeSelectionContext);
    
    // Optimize (try to consolidate)
    const optimized = await optimizeStoreSelection(fulfillment, storeSelectionContext);

    return res.json({
      ok: true,
      storePlans: optimized.storePlans,
      unfulfilled: optimized.unfulfilled,
      consolidated: optimized.consolidated || false,
      storeCount: optimized.storePlans.length
    });
  } catch (error) {
    console.error('Store finding error:', error);
    return res.status(500).json({ error: 'Failed to find stores' });
  }
});

// Calculate route and delivery quote
router.post('/shopping/quote', authRequired, async (req, res) => {
  try {
    const { cartItems, deliveryAddress, storePlans } = req.body;

    if (!cartItems || !deliveryAddress || !storePlans) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Calculate order load
    const { normalizedItems, productsByFrontendId } = await normalizeCartItems(cartItems);
    const { totalLoad, heavyPoints } = await calculateOrderLoad(normalizedItems);

    // Get store locations
    const stores = await Store.find({
      _id: { $in: storePlans.map(p => p.storeId) }
    }).lean();

    // Get hub location (DB first, fallback to env HUB_LAT/HUB_LNG)
    let hub = await Store.findOne({ storeType: 'hub' }).lean();
    if (!hub) {
      const envLat = Number(process.env.HUB_LAT);
      const envLng = Number(process.env.HUB_LNG);
      if (Number.isFinite(envLat) && Number.isFinite(envLng)) {
        hub = { location: { lat: envLat, lng: envLng }, name: 'Hub (env)' };
      } else {
        return res.status(500).json({
          error: 'Hub not configured. Add a Store with storeType="hub" or set HUB_LAT and HUB_LNG environment variables.'
        });
      }
    }

    // Calculate multi-stop route (hub → stores → customer)
    const route = await calculateMultiStopRoute(
      [{ location: hub.location }, ...stores.map(s => ({ location: s.location }))],
      [deliveryAddress]
    );

    // Check if batch eligible
    const batch = await findEligibleBatch({
      items: normalizedItems,
      deliveryAddress,
      createdAt: new Date(),
      storeIds: stores.map(s => s._id)
    });

    // Get user tier
    const user = req.user;
    const tier = user?.tier || 'COMMON';

    // Build product map for heavy item calculation
    // Calculate standard delivery fees via centralized calculator
    const standardFees = await getDeliveryOptions({
      orderType: 'DELIVERY_PURCHASE',
      tier,
      distanceMiles: route.distance,
      items: normalizedItems,
      productsByFrontendId
    });

    const standardTotal = standardFees.routeFee + standardFees.distanceFee + 
                         standardFees.largeOrderFee + standardFees.heavyItemFee;

    // Batch delivery option (same fees - batching benefits business efficiency, not customer pricing)
    let batchDelivery = null;
    if (batch) {
      batchDelivery = {
        available: true,
        batchId: batch.batchId,
        routeFee: standardFees.routeFee,
        distanceFee: standardFees.distanceFee,
        largeOrderFee: standardFees.largeOrderFee,
        heavyItemFee: standardFees.heavyItemFee,
        total: standardTotal,
        customerCount: batch.customerCount + 1,
        eta: `${Math.round(route.duration + 60)}-${Math.round(route.duration + 120)} minutes`,
        description: 'Grouped with nearby orders - may take slightly longer'
      };
    }

    return res.json({
      ok: true,
      route,
      capacity: {
        orderLoad: totalLoad,
        heavyPoints,
        handlingPointsBreakdown: 'See product details'
      },
      deliveryOptions: {
        standard: {
          routeFee: standardFees.routeFee,
          distanceFee: standardFees.distanceFee,
          largeOrderFee: standardFees.largeOrderFee,
          heavyItemFee: standardFees.heavyItemFee,
          total: standardTotal,
          tierDiscount: standardFees.routeFeeDiscountPercent,
          eta: `${Math.round(route.duration + 30)} minutes`,
          description: 'Dedicated delivery - fastest'
        },
        batch: batchDelivery
      },
      stores: stores.map(s => ({
        id: s._id,
        name: s.name,
        type: s.storeType
      })),
      tier: {
        name: tier,
        routeDiscount: standardFees.routeFeeDiscountPercent
      }
    });
  } catch (error) {
    console.error('Quote calculation error:', error);
    return res.status(500).json({ error: 'Failed to calculate quote' });
  }
});

// Get batch status
router.get('/batches/:batchId', authRequired, async (req, res) => {
  try {
    const { batchId } = req.params;
    const capacity = await getBatchCapacity(batchId);

    if (!capacity) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    return res.json({ ok: true, ...capacity });
  } catch (error) {
    console.error('Batch status error:', error);
    return res.status(500).json({ error: 'Failed to get batch status' });
  }
});

// Admin: Get all active batches
router.get('/batches', authRequired, async (req, res) => {
  try {
    const Batch = (await import('../models/Batch.js')).default;
    const batches = await Batch.find({ status: { $in: ['pending', 'assigned', 'in-progress'] } })
      .populate('orderIds')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, batches });
  } catch (error) {
    console.error('Batches list error:', error);
    return res.status(500).json({ error: 'Failed to list batches' });
  }
});

// Admin: Manage store inventory
router.post('/store-inventory', authRequired, async (req, res) => {
  try {
    const { storeId, productId, cost, markup, available } = req.body;

    const inventory = await StoreInventory.findOneAndUpdate(
      { storeId, productId },
      { cost, markup, available, lastVerified: new Date() },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, inventory });
  } catch (error) {
    console.error('Store inventory error:', error);
    return res.status(500).json({ error: 'Failed to update inventory' });
  }
});

// Get store inventory for a product
router.get('/store-inventory/product/:productId', authRequired, async (req, res) => {
  try {
    const { productId } = req.params;

    const inventory = await StoreInventory.find({ productId, available: true })
      .populate('storeId')
      .lean();

    return res.json({ ok: true, inventory });
  } catch (error) {
    console.error('Product inventory error:', error);
    return res.status(500).json({ error: 'Failed to get product inventory' });
  }
});

export default router;
