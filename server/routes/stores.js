import express from 'express';
import Store from '../models/Store.js';
import { authRequired } from '../utils/helpers.js';

const router = express.Router();

/**
 * GET /api/stores
 * List all stores
 * Returns stores sorted by name
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const stores = await Store.find({})
      .sort({ name: 1 })
      .lean();

    res.json({
      ok: true,
      stores: stores.map(store => ({
        id: store._id.toString(),
        name: store.name,
        address: store.address,
        createdFrom: store.createdFrom,
        createdAt: store.createdAt ? new Date(store.createdAt).toISOString() : undefined
      }))
    });
  } catch (err) {
    console.error('GET STORES ERROR:', err);
    res.status(500).json({ error: 'Failed to load stores' });
  }
});

export default router;
