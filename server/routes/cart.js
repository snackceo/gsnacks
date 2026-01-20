import express from 'express';
import { protect } from '../utils/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { calculateRoute, getHubCoords } from '../utils/routeCalculator.js';

const router = express.Router();

// @desc    Optimize the user's cart
// @route   POST /api/cart/optimize
// @access  Private
router.post('/optimize', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Find the user's current pending order (cart)
    const cart = await Order.findOne({ customerId: userId, status: 'PENDING' });

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(404).json({ message: 'No active cart found for optimization.' });
    }

    const optimizedItems = [];
    const storeIds = new Set();
    let newSubtotal = 0;

    // 2. Find cheaper alternatives for each item
    for (const item of cart.items) {
      const originalProduct = await Product.findById(item.product);
      if (!originalProduct) continue;

      const cheaperAlternative = await Product.findOne({
        name: originalProduct.name,
        price: { $lt: originalProduct.price },
      }).sort({ price: 1 });

      if (cheaperAlternative) {
        optimizedItems.push({
          product: cheaperAlternative,
          quantity: item.quantity,
          originalPrice: originalProduct.price,
        });
        newSubtotal += cheaperAlternative.price * item.quantity;
        if (cheaperAlternative.store) {
          storeIds.add(cheaperAlternative.store.toString());
        }
      } else {
        // Keep the original item if no cheaper one is found
        optimizedItems.push({
          product: originalProduct,
          quantity: item.quantity,
        });
        newSubtotal += originalProduct.price * item.quantity;
        if (originalProduct.store) {
            storeIds.add(originalProduct.store.toString());
        }
      }
    }
    
    // 3. Get store addresses
    const stores = await Store.find({ _id: { $in: [...storeIds] } });
    const storeAddresses = stores.map(store => `${store.address.street}, ${store.address.city}, ${store.address.state}`);

    // 4. Get hub and customer addresses
    const hubCoords = await getHubCoords();
    const hubAddress = `${hubCoords.lat},${hubCoords.lng}`;
    const customerAddress = cart.address;

    // 5. Calculate route
    const waypoints = [hubAddress, ...storeAddresses, customerAddress];
    let routeInfo = null;
    if (waypoints.length > 1) {
        routeInfo = await calculateRoute(waypoints);
    }

    res.json({
      optimizedCart: {
        items: optimizedItems,
        subtotal: newSubtotal,
      },
      routeInfo,
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

    const cart = await Order.findOne({ customerId: userId, status: 'PENDING' });

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

export default router;
