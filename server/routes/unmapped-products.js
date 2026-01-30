import express from 'express';
import mongoose from 'mongoose';
import UnmappedProduct from '../models/UnmappedProduct.js';
import PriceObservation from '../models/PriceObservation.js';
import { authRequired, managerOrOwnerRequired } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';

const router = express.Router();

const normalizeQuery = value => String(value || '').trim();

// GET /api/unmapped-products
router.get('/', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const storeId = normalizeQuery(req.query.storeId);
    const status = normalizeQuery(req.query.status);
    const search = normalizeQuery(req.query.q);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const query = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      query.storeId = storeId;
    }
    if (status) {
      const statuses = status
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (statuses.length) {
        query.status = { $in: statuses };
      }
    }
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { rawName: regex },
        { normalizedName: regex }
      ];
    }

    const items = await UnmappedProduct.find(query)
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean();

    res.json({ ok: true, items });
  } catch (err) {
    console.error('Failed to fetch unmapped products', err);
    res.status(500).json({ error: 'Failed to fetch unmapped products' });
  }
});

// POST /api/unmapped-products/:id/map
router.post('/:id/map', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { productId, migrateObservations } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid unmapped product id' });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Valid productId required' });
    }

    const unmapped = await UnmappedProduct.findById(id);
    if (!unmapped) {
      return res.status(404).json({ error: 'Unmapped product not found' });
    }

    unmapped.mappedProductId = productId;
    unmapped.status = 'MAPPED';
    await unmapped.save();

    if (migrateObservations) {
      await PriceObservation.updateMany(
        {
          unmappedProductId: unmapped._id,
          $or: [{ productId: { $exists: false } }, { productId: null }]
        },
        { $set: { productId } }
      );
    }

    await recordAuditLog({
      type: 'unmapped_product_mapped',
      actorId: req.user?.username || req.user?.id || 'unknown',
      details: `unmappedProductId=${unmapped._id} productId=${productId} migrateObservations=${Boolean(migrateObservations)}`
    });

    res.json({ ok: true, item: unmapped });
  } catch (err) {
    console.error('Failed to map unmapped product', err);
    res.status(500).json({ error: 'Failed to map unmapped product' });
  }
});

// POST /api/unmapped-products/:id/ignore
router.post('/:id/ignore', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid unmapped product id' });
    }

    const unmapped = await UnmappedProduct.findById(id);
    if (!unmapped) {
      return res.status(404).json({ error: 'Unmapped product not found' });
    }

    unmapped.status = 'IGNORED';
    await unmapped.save();

    await recordAuditLog({
      type: 'unmapped_product_ignored',
      actorId: req.user?.username || req.user?.id || 'unknown',
      details: `unmappedProductId=${unmapped._id}`
    });

    res.json({ ok: true, item: unmapped });
  } catch (err) {
    console.error('Failed to ignore unmapped product', err);
    res.status(500).json({ error: 'Failed to ignore unmapped product' });
  }
});

export default router;
