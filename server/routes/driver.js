import express from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Batch from '../models/Batch.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import {
  authRequired,
  isDriverUsername,
  mapOrderForFrontend
} from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { resolveDistanceMiles } from '../utils/distance.js';
import { isDbReady } from '../db/connect.js';

const router = express.Router();

/**
 * Middleware: Verify driver access
 */
const driverOnly = (req, res, next) => {
  if (!isDriverUsername(req.user?.username)) {
    return res.status(403).json({ error: 'Driver access required' });
  }
  next();
};

/**
 * GET /api/driver/pending-orders
 * List orders awaiting assignment (status: PENDING)
 * Drivers can browse available work
 */
router.get('/pending-orders', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  try {
    const orders = await Order.find({
      status: 'PENDING',
      driverId: { $in: [null, ''] }
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();

    const result = orders.map(mapOrderForFrontend);
    res.json({ ok: true, orders: result });
  } catch (err) {
    console.error('PENDING ORDERS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
});

/**
 * GET /api/driver/assigned-orders
 * List orders assigned to current driver
 */
router.get('/assigned-orders', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  try {
    const driverId = req.user?.username || req.user?.id;
    const orders = await Order.find({
      driverId,
      status: { $in: ['ASSIGNED', 'PICKED_UP', 'ARRIVING', 'DELIVERED'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    const result = orders.map(mapOrderForFrontend);
    res.json({ ok: true, orders: result });
  } catch (err) {
    console.error('ASSIGNED ORDERS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch assigned orders' });
  }
});

/**
 * POST /api/driver/accept-order
 * Driver accepts and assigns themselves to an order
 */
router.post('/accept-order', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const driverId = req.user?.username || req.user?.id;

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(sessionDb);
      if (!order) {
        throw new Error('Order not found');
      }
      if (order.status !== 'PENDING') {
        throw new Error('Order is no longer pending');
      }

      order.driverId = driverId;
      order.status = 'ASSIGNED';
      await order.save({ session: sessionDb });

      await recordAuditLog({
        type: 'ORDER_ASSIGNED',
        actorId: driverId,
        details: `Driver ${driverId} assigned to order ${orderId}`
      });
    });

    const updated = await Order.findOne({ orderId }).lean();
    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    console.error('ACCEPT ORDER ERROR:', err);
    res.status(400).json({ error: err?.message || 'Failed to accept order' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * POST /api/driver/pickup-order
 * Driver picks up items from store(s)
 */
router.post('/pickup-order', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const driverId = req.user?.username || req.user?.id;

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(sessionDb);
      if (!order) {
        throw new Error('Order not found');
      }
      if (order.driverId !== driverId) {
        throw new Error('This order is not assigned to you');
      }
      if (order.status !== 'ASSIGNED') {
        throw new Error('Order is not in ASSIGNED status');
      }

      order.status = 'PICKED_UP';
      order.pickedUpAt = new Date();
      await order.save({ session: sessionDb });

      await recordAuditLog({
        type: 'ORDER_PICKED_UP',
        actorId: driverId,
        details: `Order ${orderId} picked up`
      });
    });

    const updated = await Order.findOne({ orderId }).lean();
    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    console.error('PICKUP ORDER ERROR:', err);
    res.status(400).json({ error: err?.message || 'Failed to pick up order' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * POST /api/driver/start-delivery
 * Driver starts delivery route (navigating to customer)
 */
router.post('/start-delivery', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const driverId = req.user?.username || req.user?.id;

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(sessionDb);
      if (!order) {
        throw new Error('Order not found');
      }
      if (order.driverId !== driverId) {
        throw new Error('This order is not assigned to you');
      }
      if (order.status !== 'PICKED_UP') {
        throw new Error('Order must be picked up before delivery');
      }

      order.status = 'ARRIVING';
      order.deliveryStartedAt = new Date();
      await order.save({ session: sessionDb });

      await recordAuditLog({
        type: 'ORDER_DELIVERY_STARTED',
        actorId: driverId,
        details: `Order ${orderId} delivery started - driver en route`
      });
    });

    const updated = await Order.findOne({ orderId }).lean();
    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    console.error('START DELIVERY ERROR:', err);
    res.status(400).json({ error: err?.message || 'Failed to start delivery' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * POST /api/driver/complete-delivery
 * Driver completes delivery with optional photo
 */
router.post('/complete-delivery', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.body?.orderId || '').trim();
    const deliveryPhotoBase64 = req.body?.deliveryPhoto || null;
    const customerSignature = req.body?.customerSignature || null;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const driverId = req.user?.username || req.user?.id;

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(sessionDb);
      if (!order) {
        throw new Error('Order not found');
      }
      if (order.driverId !== driverId) {
        throw new Error('This order is not assigned to you');
      }
      if (order.status !== 'ARRIVING') {
        throw new Error('Order must be in ARRIVING status');
      }

      order.status = 'DELIVERED';
      order.deliveredAt = new Date();
      if (deliveryPhotoBase64) {
        order.deliveryProof = {
          photo: deliveryPhotoBase64,
          capturedAt: new Date()
        };
      }
      if (customerSignature) {
        order.customerSignature = {
          signature: customerSignature,
          signedAt: new Date()
        };
      }
      await order.save({ session: sessionDb });

      await recordAuditLog({
        type: 'ORDER_DELIVERED',
        actorId: driverId,
        details: `Order ${orderId} delivered to customer`
      });
    });

    const updated = await Order.findOne({ orderId }).lean();
    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    console.error('COMPLETE DELIVERY ERROR:', err);
    res.status(400).json({ error: err?.message || 'Failed to complete delivery' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * GET /api/driver/order/:orderId/shopping-list
 * Get detailed shopping list with stores and items
 */
router.get('/order/:orderId/shopping-list', driverOnly, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  try {
    const orderId = String(req.params?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const order = await Order.findOne({ orderId }).lean();
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const driverId = req.user?.username || req.user?.id;
    if (order.driverId !== driverId) {
      return res.status(403).json({ error: 'This order is not assigned to you' });
    }

    // Fetch product details and organize by store (assuming single store for now)
    const productIds = (order.items || []).map(it => it.productId);
    const products = await Product.find({ frontendId: { $in: productIds } }).lean();
    const productMap = new Map(products.map(p => [p.frontendId, p]));

    const shoppingList = (order.items || []).map(item => {
      const product = productMap.get(item.productId);
      return {
        productId: item.productId,
        name: product?.name || item.productId,
        quantity: item.quantity,
        price: product?.price || 0,
        instructions: product?.storageInstructions || ''
      };
    });

    res.json({
      ok: true,
      orderId,
      address: order.address,
      shoppingList,
      itemCount: shoppingList.reduce((sum, it) => sum + it.quantity, 0),
      estimatedTime: order.distanceMiles ? Math.ceil(order.distanceMiles / 30 * 60) : 30
    });
  } catch (err) {
    console.error('SHOPPING LIST ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch shopping list' });
  }
});

/**
 * GET /api/driver/earnings
 * Driver earnings summary (today, this week, this month)
 */
router.get('/earnings', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  try {
    const driverId = req.user?.username || req.user?.id;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayOrders, weekOrders, monthOrders] = await Promise.all([
      Order.find({
        driverId,
        deliveredAt: { $gte: today },
        status: 'DELIVERED'
      }).lean(),
      Order.find({
        driverId,
        deliveredAt: { $gte: weekStart },
        status: 'DELIVERED'
      }).lean(),
      Order.find({
        driverId,
        deliveredAt: { $gte: monthStart },
        status: 'DELIVERED'
      }).lean()
    ]);

    const sumRouteFees = (orders) =>
      orders.reduce((sum, o) => sum + Number(o.routeFeeFinal || 0), 0);
    const sumDistanceFees = (orders) =>
      orders.reduce((sum, o) => sum + Number(o.distanceFeeFinal || 0), 0);
    const sumAllFees = (orders) =>
      sumRouteFees(orders) + sumDistanceFees(orders) + 
      orders.reduce((sum, o) => sum + Number(o.largeOrderFee || 0) + Number(o.heavyItemFee || 0), 0);

    res.json({
      ok: true,
      today: {
        deliveries: todayOrders.length,
        routeFees: sumRouteFees(todayOrders),
        distanceFees: sumDistanceFees(todayOrders),
        totalFees: sumAllFees(todayOrders),
        totalDistance: todayOrders.reduce((sum, o) => sum + Number(o.distanceMiles || 0), 0)
      },
      week: {
        deliveries: weekOrders.length,
        routeFees: sumRouteFees(weekOrders),
        distanceFees: sumDistanceFees(weekOrders),
        totalFees: sumAllFees(weekOrders),
        totalDistance: weekOrders.reduce((sum, o) => sum + Number(o.distanceMiles || 0), 0)
      },
      month: {
        deliveries: monthOrders.length,
        routeFees: sumRouteFees(monthOrders),
        distanceFees: sumDistanceFees(monthOrders),
        totalFees: sumAllFees(monthOrders),
        totalDistance: monthOrders.reduce((sum, o) => sum + Number(o.distanceMiles || 0), 0)
      }
    });
  } catch (err) {
    console.error('EARNINGS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch earnings' });
  }
});

/**
 * GET /api/driver/performance
 * Driver performance metrics
 */
router.get('/performance', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  try {
    const driverId = req.user?.username || req.user?.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [allOrders, completedOrders] = await Promise.all([
      Order.find({
        driverId,
        createdAt: { $gte: thirtyDaysAgo }
      }).lean(),
      Order.find({
        driverId,
        status: 'DELIVERED',
        deliveredAt: { $gte: thirtyDaysAgo }
      }).lean()
    ]);

    const avgCompletionTime = completedOrders.length > 0
      ? completedOrders.reduce((sum, o) => {
          const start = new Date(o.deliveryStartedAt || o.createdAt);
          const end = new Date(o.deliveredAt);
          return sum + (end - start) / 1000 / 60; // minutes
        }, 0) / completedOrders.length
      : 0;

    res.json({
      ok: true,
      thirtyDayStats: {
        totalOrders: allOrders.length,
        completedOrders: completedOrders.length,
        completionRate: allOrders.length > 0 ? (completedOrders.length / allOrders.length) : 0,
        avgCompletionTimeMinutes: Math.round(avgCompletionTime),
        totalDeliveries: completedOrders.length,
        totalDistance: completedOrders.reduce((sum, o) => sum + Number(o.distanceMiles || 0), 0),
        avgDeliveryDistance: completedOrders.length > 0
          ? completedOrders.reduce((sum, o) => sum + Number(o.distanceMiles || 0), 0) / completedOrders.length
          : 0
      }
    });
  } catch (err) {
    console.error('PERFORMANCE ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

export default router;
