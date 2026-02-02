import express from 'express';
import mongoose from 'mongoose';
import StoreInventory from '../models/StoreInventory.js';
import Store from '../models/Store.js';
import { authRequired, managerOrOwnerRequired } from '../utils/helpers.js';

const router = express.Router();

// GET /api/store-inventory/:storeId
// Returns all inventory for a given store
router.get('/:storeId', authRequired, async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Invalid store id.' });
    }
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const items = await StoreInventory.find({
      storeId,
      $or: [
        { productId: { $exists: true, $ne: null } },
        { unmappedProductId: { $exists: true, $ne: null } }
      ]
    })
      .populate('productId')
      .populate('unmappedProductId')
      .sort({ observedAt: -1 })
      .lean();

    res.json({ ok: true, items });
  } catch (err) {
    console.error('GET STORE INVENTORY ERROR:', err);
    res.status(500).json({ error: 'Failed to load store inventory' });
  }
});

export default router;
