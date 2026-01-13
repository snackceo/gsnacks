import express from 'express';

import Product from '../models/Product.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const docs = await Product.find({}).sort({ createdAt: -1 }).lean();
    const products = docs.map(d => ({
      id: d.frontendId,
      frontendId: d.frontendId,
      name: d.name,
      price: d.price,
      deposit: d.deposit ?? 0,
      stock: d.stock ?? 0,
      sizeOz: d.sizeOz ?? 0,
      category: d.category ?? 'DRINK',
      image: d.image ?? '',
      isGlass: !!d.isGlass
    }));
    res.json({ ok: true, products });
  } catch (err) {
    console.error('GET PRODUCTS ERROR:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

router.post('/', authRequired, ownerRequired, async (req, res) => {
  try {
    const {
      id,
      frontendId,
      name,
      price,
      deposit,
      stock,
      sizeOz,
      category,
      image,
      isGlass
    } = req.body || {};

    const finalFrontendId = (frontendId || id || '').trim();
    if (!finalFrontendId) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'price is required' });
    }

    const created = await Product.create({
      frontendId: finalFrontendId,
      name,
      price: Number(price),
      deposit: Number(deposit || 0),
      stock: Number(stock || 0),
      sizeOz: Number(sizeOz || 0),
      category: category || 'DRINK',
      image: image || '',
      isGlass: !!isGlass
    });

    res.json({
      ok: true,
      product: {
        id: created.frontendId,
        frontendId: created.frontendId,
        name: created.name,
        price: created.price,
        deposit: created.deposit ?? 0,
        stock: created.stock ?? 0,
        sizeOz: created.sizeOz ?? 0,
        category: created.category ?? 'DRINK',
        image: created.image ?? '',
        isGlass: !!created.isGlass
      }
    });
  } catch (err) {
    console.error('CREATE PRODUCT ERROR:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Product ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create product' });
  }
});

router.patch('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const frontendId = req.params.id;

    const updates = {};
    const allowed = [
      'name',
      'price',
      'deposit',
      'stock',
      'sizeOz',
      'category',
      'image',
      'isGlass'
    ];

    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.deposit !== undefined) updates.deposit = Number(updates.deposit);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.sizeOz !== undefined) updates.sizeOz = Number(updates.sizeOz);
    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;

    const updated = await Product.findOneAndUpdate({ frontendId }, updates, {
      new: true
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    res.json({
      ok: true,
      product: {
        id: updated.frontendId,
        frontendId: updated.frontendId,
        name: updated.name,
        price: updated.price,
        deposit: updated.deposit ?? 0,
        stock: updated.stock ?? 0,
        sizeOz: updated.sizeOz ?? 0,
        category: updated.category ?? 'DRINK',
        image: updated.image ?? '',
        isGlass: !!updated.isGlass
      }
    });
  } catch (err) {
    console.error('UPDATE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.delete('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const frontendId = req.params.id;
    const deleted = await Product.findOneAndDelete({ frontendId }).lean();
    if (!deleted) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
