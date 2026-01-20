import express from 'express';
import { authRequired } from '../utils/auth.js';
import Order from '../models/Order.js';
import { recordAuditLog } from '../utils/audit.js';

const router = express.Router();

/**
 * GET /api/driver/order/:orderId/items-not-found
 * Fetch the list of items not found for an order
 */
router.get('/order/:orderId/items-not-found', authRequired, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      orderId,
      itemsNotFound: order.itemsNotFound || [],
      lastUpdated: order.updatedAt
    });
  } catch (err) {
    console.error('Error fetching items not found:', err);
    res.status(500).json({ error: 'Failed to fetch items not found' });
  }
});

/**
 * POST /api/driver/order/:orderId/items-not-found
 * Upsert items not found (create or update)
 */
router.post('/order/:orderId/items-not-found', authRequired, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Initialize if not present
    if (!order.itemsNotFound) {
      order.itemsNotFound = [];
    }

    // Merge incoming items with existing ones
    items.forEach(incomingItem => {
      const existingIdx = order.itemsNotFound.findIndex(
        item => item.sku === incomingItem.sku && !item.removedAt
      );

      if (existingIdx >= 0) {
        // Update existing
        order.itemsNotFound[existingIdx] = {
          ...order.itemsNotFound[existingIdx],
          ...incomingItem
        };
      } else {
        // Add new
        order.itemsNotFound.push(incomingItem);
      }
    });

    await order.save();

    await recordAuditLog({
      type: 'DRIVER_ITEMS_NOT_FOUND_UPDATED',
      actorId: req.user?.username || req.user?.id || 'UNKNOWN',
      details: `Updated ${items.length} items not found for order ${orderId}.`
    });

    res.json({
      ok: true,
      orderId,
      itemsNotFound: order.itemsNotFound
    });
  } catch (err) {
    console.error('Error updating items not found:', err);
    res.status(500).json({ error: 'Failed to update items not found' });
  }
});

/**
 * PATCH /api/driver/order/:orderId/items-not-found/:sku
 * Mark an item as found or remove it from tracking
 */
router.patch('/order/:orderId/items-not-found/:sku', authRequired, async (req, res) => {
  try {
    const { orderId, sku } = req.params;
    const { action, foundAt, attemptedStores } = req.body;

    if (!['found', 'remove', 'update'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use found, remove, or update' });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemIdx = order.itemsNotFound?.findIndex(i => i.sku === sku && !i.removedAt);
    if (itemIdx === undefined || itemIdx < 0) {
      return res.status(404).json({ error: 'Item not found in tracking' });
    }

    const item = order.itemsNotFound[itemIdx];

    if (action === 'found') {
      item.foundAt = foundAt || 'UNSPECIFIED_STORE';
      item.foundAtTime = new Date();
    } else if (action === 'remove') {
      item.removedAt = new Date();
    } else if (action === 'update') {
      if (attemptedStores) {
        item.attemptedStores = attemptedStores;
      }
    }

    await order.save();

    await recordAuditLog({
      type: 'DRIVER_ITEM_NOT_FOUND_ACTION',
      actorId: req.user?.username || req.user?.id || 'UNKNOWN',
      details: `${action.toUpperCase()} action on item ${sku} (${item.name}) for order ${orderId}${
        foundAt ? ` at ${foundAt}` : ''
      }.`
    });

    res.json({
      ok: true,
      action,
      sku,
      item: order.itemsNotFound[itemIdx]
    });
  } catch (err) {
    console.error('Error updating item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/**
 * GET /api/driver/analytics/items-not-found
 * Get analytics on items not found across all orders (owner-only or driver-specific)
 */
router.get('/analytics/items-not-found', authRequired, async (req, res) => {
  try {
    const driverId = req.query.driverId || req.user?.id;
    const limit = parseInt(req.query.limit || '100', 10);

    const pipeline = [
      { $match: { driverId, 'itemsNotFound.0': { $exists: true } } },
      { $unwind: '$itemsNotFound' },
      { $match: { 'itemsNotFound.removedAt': { $exists: false } } },
      {
        $group: {
          _id: '$itemsNotFound.sku',
          name: { $first: '$itemsNotFound.name' },
          count: { $sum: 1 },
          totalAttempts: { $sum: { $size: '$itemsNotFound.attemptedStores' } },
          foundCount: {
            $sum: {
              $cond: [{ $ne: ['$itemsNotFound.foundAt', null] }, 1, 0]
            }
          },
          stores: { $push: '$itemsNotFound.originalStore' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit }
    ];

    const stats = await Order.aggregate(pipeline);

    res.json({
      driverId,
      totalNotFoundEntries: stats.reduce((sum, s) => sum + s.count, 0),
      itemsTracked: stats.length,
      items: stats
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;
