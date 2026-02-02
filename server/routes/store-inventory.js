import express from 'express';
import mongoose from 'mongoose';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import UnmappedProduct from '../models/UnmappedProduct.js';
import { authRequired, managerOrOwnerRequired } from '../utils/helpers.js';

const router = express.Router();

// GET /api/store-inventory/:storeId
// Returns all inventory for a given store
router.get('/:storeId', authRequired, async (req, res) => {
  try {
    const { storeId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const search = (req.query.search || '').toString().trim();
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Invalid store id.' });
    }
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inventoryFilter = { storeId };
    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      const [matchedProducts, matchedUnmapped] = await Promise.all([
        Product.find({ $or: [{ name: searchRegex }, { sku: searchRegex }, { upc: searchRegex }] })
          .select('_id')
          .lean(),
        UnmappedProduct.find({
          storeId,
          $or: [{ rawName: searchRegex }, { normalizedName: searchRegex }]
        })
          .select('_id')
          .lean()
      ]);
      inventoryFilter.$or = [
        { sku: searchRegex },
        { productId: { $in: matchedProducts.map(item => item._id) } },
        { unmappedProductId: { $in: matchedUnmapped.map(item => item._id) } }
      ];
    }
    const inventoryQuery = StoreInventory.find(inventoryFilter)
      .select('storeId productId unmappedProductId sku cost markup observedPrice observedAt available stockLevel')
      .populate({ path: 'productId', select: 'name sku upc price' })
      .populate({ path: 'unmappedProductId', select: 'rawName normalizedName' })
      .sort({ observedAt: -1 });
    if (skip > 0) {
      inventoryQuery.skip(skip);
    }
    if (limit > 0) {
      inventoryQuery.limit(limit);
    }
    const inventory = await inventoryQuery.lean();
    res.json({ ok: true, inventory });
  } catch (err) {
    console.error('GET STORE INVENTORY ERROR:', err);
    res.status(500).json({ error: 'Failed to load store inventory' });
  }
});

export default router;
