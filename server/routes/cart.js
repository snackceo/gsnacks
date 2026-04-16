import express from 'express';
import { protect } from '../utils/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { calculateRoute, getHubCoords } from '../utils/routeCalculator.js';
import Cart from '../models/Cart.js';
import DriverNotFound from '../models/DriverNotFound.js';
import ReturnUpcs from '../models/ReturnUpcs.js';

const router = express.Router();

// @desc    Get user's synced cart
// @route   GET /api/cart
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    let cart = await Cart.findOne({ userId: req.user._id });
    
    if (!cart) {
      cart = await Cart.create({
        userId: req.user._id,
        items: []
      });
    }

    res.json({
      items: cart.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }))
    });
  } catch (err) {
    console.error('[GET /api/cart] Error:', err);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// @desc    Update user's synced cart
// @route   PUT /api/cart
// @access  Private
router.put('/', protect, async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    // Filter and normalize items
    const validItems = items
      .filter(item => item.productId && item.quantity > 0)
      .map(item => ({
        productId: String(item.productId),
        quantity: Number(item.quantity)
      }));

    // Use findOneAndUpdate with upsert for atomic operation
    const cart = await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { 
        $set: { 
          items: validItems,
          updatedAt: new Date()
        }
      },
      { 
        upsert: true, 
        new: true,
        runValidators: true
      }
    );

    const responseItems = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity
    }));

    // 🚀 Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('cart:updated', { items: responseItems });
    }

    res.json({ items: responseItems });
  } catch (err) {
    console.error('[PUT /api/cart] Error:', err);
    console.error('[PUT /api/cart] Stack:', err.stack);
    res.status(500).json({ error: 'Failed to update cart', details: err.message });
  }
});

// @desc    Clear user's synced cart
// @route   DELETE /api/cart
// @access  Private
router.delete('/', protect, async (req, res) => {
  try {
    await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { items: [], updatedAt: new Date() },
      { upsert: true }
    );

    // 🚀 Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('cart:updated', { items: [] });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/cart] Error:', err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// @desc    Optimize the user's cart
// @route   POST /api/cart/optimize
// @access  Private
router.post('/optimize', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const cart = await Order.findOne({ user: userId, status: 'PENDING' }).populate('items.product');

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(404).json({ message: 'No active cart found for optimization.' });
    }

    // 1. Normalize cart and find all options for each item
    const cartItemOptions = await Promise.all(cart.items.map(async (item) => {
      const originalProduct = await Product.findById(item.product).lean();
      if (!originalProduct) return { ...item.toObject(), options: [] };
      const options = await Product.find({ name: originalProduct.name }).populate('store').lean();
      return {
        ...item.toObject(),
        originalProduct,
        options,
      };
    }));

    // 2. Generate Candidate Plans

    // Plan A: Cheapest Overall
    const cheapestPlan = {
      name: "Cheapest Overall",
      items: [],
      stores: new Map(),
      subtotal: 0,
    };
    for (const item of cartItemOptions) {
      const cheapestOption = item.options.sort((a, b) => a.price - b.price)[0];
      if (cheapestOption) {
        cheapestPlan.items.push({ product: cheapestOption, quantity: item.quantity, originalPrice: item.originalProduct.price });
        cheapestPlan.subtotal += cheapestOption.price * item.quantity;
        if (cheapestOption.store) {
          cheapestPlan.stores.set(cheapestOption.store._id.toString(), cheapestOption.store);
        }
      }
    }

    // Plan B: Fewest Stores (simple version)
    const fewestStoresPlan = {
        name: "Fewest Stores",
        items: [],
        stores: new Map(),
        subtotal: 0,
    };
    const storeCoverage = new Map();
    cartItemOptions.forEach(item => {
        item.options.forEach(option => {
            if (option.store) {
                const storeId = option.store._id.toString();
                storeCoverage.set(storeId, (storeCoverage.get(storeId) || 0) + 1);
            }
        });
    });
    const sortedStores = [...storeCoverage.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    
    const itemsToFulfill = new Set(cartItemOptions.map(i => i.originalProduct.name));
    for (const storeId of sortedStores) {
        if (itemsToFulfill.size === 0) break;
        for (const item of cartItemOptions) {
            if (itemsToFulfill.has(item.originalProduct.name)) {
                const optionInStore = item.options.find(o => o.store && o.store._id.toString() === storeId);
                if (optionInStore) {
                    fewestStoresPlan.items.push({ product: optionInStore, quantity: item.quantity, originalPrice: item.originalProduct.price });
                    fewestStoresPlan.subtotal += optionInStore.price * item.quantity;
                    if (optionInStore.store) {
                      fewestStoresPlan.stores.set(optionInStore.store._id.toString(), optionInStore.store);
                    }
                    itemsToFulfill.delete(item.originalProduct.name);
                }
            }
        }
    }


    const plans = [cheapestPlan, fewestStoresPlan];
    const hubCoords = await getHubCoords();
    const hubAddress = `${hubCoords.lat},${hubCoords.lng}`;
    const customerAddress = cart.address;

    // 3. Evaluate plans
    const evaluatedPlans = await Promise.all(plans.map(async (plan) => {
      const storeAddresses = [...plan.stores.values()].map(store => `${store.address.street}, ${store.address.city}, ${store.address.state}`);
      const waypoints = [hubAddress, ...storeAddresses, customerAddress];
      const routeInfo = waypoints.length > 1 ? await calculateRoute(waypoints) : null;
      
      // Scoring function (simple version)
      const priceScore = plan.subtotal;
      const distanceScore = (routeInfo?.distance || 0) / 1609.34; // in miles
      const stopsScore = plan.stores.size * 5; // penalty of 5 "miles" per stop
      const score = priceScore + distanceScore + stopsScore;

      return {
        ...plan,
        routeInfo,
        score,
      };
    }));

    // 4. Select best plan
    const bestPlan = evaluatedPlans.sort((a, b) => a.score - b.score)[0];

    // 5. Return best plan
    res.json({
      planName: bestPlan.name,
      optimizedCart: {
        items: bestPlan.items,
        subtotal: bestPlan.subtotal,
      },
      routeInfo: bestPlan.routeInfo,
      reason: `Selected '${bestPlan.name}' plan with a score of ${bestPlan.score.toFixed(2)}.`,
    });

  } catch (error) {
    console.error('Cart optimization error:', error);
    res.status(500).json({ message: 'An error occurred during cart optimization.' });
  }
});

// @desc    Update the user's cart with optimized items
// @route   POST /api/cart/update
// @access  Private
router.post('/update', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { items, subtotal } = req.body;

    if (!items || !subtotal) {
      return res.status(400).json({ message: 'Missing items or subtotal in request body.' });
    }

    const cart = await Order.findOne({ user: userId, status: 'PENDING' });

    if (!cart) {
      return res.status(404).json({ message: 'No active cart found to update.' });
    }

    cart.items = items;
    cart.subtotal = subtotal;

    // Recalculate total. This is a simplified calculation.
    // In a real app, taxes, fees, etc. would need to be recalculated here.
    cart.total = subtotal; 

    await cart.save();

    res.json(cart);

  } catch (error) {
    console.error('Cart update error:', error);
    res.status(500).json({ message: 'An error occurred while updating the cart.' });
  }
});

// ======================= DRIVER NOT-FOUND ITEMS SYNC =======================

// GET driver's "not found" items for a specific order
router.get('/driver-not-found/:orderId', protect, async (req, res) => {
  try {
    const data = await DriverNotFound.findOne({
      driverId: req.user._id,
      orderId: req.params.orderId
    });
    res.json({ items: data?.items || [] });
  } catch (error) {
    console.error('Driver not-found fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch not-found items' });
  }
});

// PUT driver's "not found" items for a specific order
router.put('/driver-not-found/:orderId', protect, async (req, res) => {
  try {
    const { items } = req.body;
    
    const data = await DriverNotFound.findOneAndUpdate(
      { driverId: req.user._id, orderId: req.params.orderId },
      { items },
      { upsert: true, new: true }
    );

    // Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('driver-not-found:updated', {
        orderId: req.params.orderId,
        items
      });
    }

    res.json({ success: true, items: data.items });
  } catch (error) {
    console.error('Driver not-found update error:', error);
    res.status(500).json({ message: 'Failed to update not-found items' });
  }
});

// DELETE driver's "not found" items for a specific order
router.delete('/driver-not-found/:orderId', protect, async (req, res) => {
  try {
    await DriverNotFound.deleteOne({
      driverId: req.user._id,
      orderId: req.params.orderId
    });

    // Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('driver-not-found:deleted', {
        orderId: req.params.orderId
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Driver not-found delete error:', error);
    res.status(500).json({ message: 'Failed to delete not-found items' });
  }
});

// ======================= RETURN UPCS SYNC =======================

// GET customer's return UPCs
router.get('/return-upcs', protect, async (req, res) => {
  try {
    const data = await ReturnUpcs.findOne({ userId: req.user._id });
    res.json({ 
      upcs: data?.upcs || [], 
      eligibilityCache: data?.eligibilityCache || {} 
    });
  } catch (error) {
    console.error('Return UPCs fetch error:', error);
    res.status(500).json({ message: 'Failed to fetch return UPCs' });
  }
});

// PUT customer's return UPCs
router.put('/return-upcs', protect, async (req, res) => {
  try {
    const { upcs, eligibilityCache } = req.body;
    
    const data = await ReturnUpcs.findOneAndUpdate(
      { userId: req.user._id },
      { upcs, eligibilityCache },
      { upsert: true, new: true }
    );

    // Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('return-upcs:updated', {
        upcs,
        eligibilityCache
      });
    }

    res.json({ success: true, upcs: data.upcs, eligibilityCache: data.eligibilityCache });
  } catch (error) {
    console.error('Return UPCs update error:', error);
    res.status(500).json({ message: 'Failed to update return UPCs' });
  }
});

// DELETE customer's return UPCs
router.delete('/return-upcs', protect, async (req, res) => {
  try {
    await ReturnUpcs.deleteOne({ userId: req.user._id });

    // Emit WebSocket event for real-time sync
    if (req.app.locals.io) {
      req.app.locals.io.to(`user:${req.user._id}`).emit('return-upcs:deleted', {});
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Return UPCs delete error:', error);
    res.status(500).json({ message: 'Failed to delete return UPCs' });
  }
});

export default router;
