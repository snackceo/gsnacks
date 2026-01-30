import express from 'express';
import mongoose from 'mongoose';
import PriceObservation from '../models/PriceObservation.js';
import { authRequired, managerOrOwnerRequired } from '../utils/helpers.js';

const router = express.Router();

const normalizeQuery = value => String(value || '').trim();

// GET /api/price-observations
router.get('/', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const storeId = normalizeQuery(req.query.storeId);
    const productId = normalizeQuery(req.query.productId);
    const unmappedProductId = normalizeQuery(req.query.unmappedProductId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    if (!productId && !unmappedProductId) {
      return res.status(400).json({ error: 'productId or unmappedProductId required' });
    }

    const query = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      query.storeId = storeId;
    }
    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      query.productId = productId;
    }
    if (unmappedProductId && mongoose.Types.ObjectId.isValid(unmappedProductId)) {
      query.unmappedProductId = unmappedProductId;
    }

    const items = await PriceObservation.find(query)
      .sort({ observedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ ok: true, items });
  } catch (err) {
    console.error('Failed to fetch price observations', err);
    res.status(500).json({ error: 'Failed to fetch price observations' });
  }
});

export default router;
