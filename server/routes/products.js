import express from 'express';

import Product from '../models/Product.js';
import { generateSku } from '../utils/sku.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const docs = await Product.find({}).sort({ createdAt: -1 }).lean();
    const products = docs.map(d => ({
      id: d.sku || d.frontendId,
      sku: d.sku || undefined,
      upc: d.upc || undefined,
      frontendId: d.frontendId,
      name: d.name,
      price: d.price,
      deposit: d.deposit ?? 0,
      stock: d.stock ?? 0,
      sizeOz: d.sizeOz ?? 0,
      category: d.category ?? 'DRINK',
      image: d.image ?? '',
      brand: d.brand || '',
      productType: d.productType || '',
      storageZone: d.storageZone || '',
      storageBin: d.storageBin || '',
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
      name,
      price,
      deposit,
      stock,
      sizeOz,
      category,
      image,
      isGlass,
      brand,
      productType,
      storageZone,
      storageBin,
      isHeavy,
      upc
    } = req.body || {};
    const normalizedUpc = upc ? String(upc).trim() : '';

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'price is required' });
    }

    // Generate a SKU and use it as frontendId for backwards compatibility
    const sku = await generateSku();
    const created = await Product.create({
      frontendId: sku,
      sku,
      name,
      price: Number(price),
      deposit: Number(deposit || 0),
      stock: Number(stock || 0),
      sizeOz: Number(sizeOz || 0),
      category: category || 'DRINK',
      image: image || '',
      isGlass: !!isGlass,
      brand: brand || '',
      productType: productType || '',
      storageZone: storageZone || '',
      storageBin: storageBin || '',
      isHeavy: !!isHeavy,
      upc: normalizedUpc || undefined
    });

    res.json({
      ok: true,
      product: {
        id: created.sku || created.frontendId,
        sku: created.sku || undefined,
        upc: created.upc || undefined,
        frontendId: created.frontendId,
        name: created.name,
        price: created.price,
        deposit: created.deposit ?? 0,
        stock: created.stock ?? 0,
        sizeOz: created.sizeOz ?? 0,
        category: created.category ?? 'DRINK',
        image: created.image ?? '',
        brand: created.brand || '',
        productType: created.productType || '',
        storageZone: created.storageZone || '',
        storageBin: created.storageBin || '',
        isGlass: !!created.isGlass,
        isHeavy: !!created.isHeavy
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
    const paramId = req.params.id;

    const updates = {};
    const allowed = [
      'name',
      'price',
      'deposit',
      'stock',
      'sizeOz',
      'category',
      'brand',
      'productType',
      'storageZone',
      'storageBin',
      'image',
      'isGlass',
      'isHeavy',
      'upc'
    ];

    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.deposit !== undefined) updates.deposit = Number(updates.deposit);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.sizeOz !== undefined) updates.sizeOz = Number(updates.sizeOz);
    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;
    if (updates.isHeavy !== undefined) updates.isHeavy = !!updates.isHeavy;
    if (updates.upc !== undefined) {
      const normalizedUpc = String(updates.upc).trim();
      if (normalizedUpc) {
        updates.upc = normalizedUpc;
      } else {
        delete updates.upc;
      }
    }

    const updated = await Product.findOneAndUpdate(
      { $or: [{ frontendId: paramId }, { sku: paramId }] },
      updates,
      {
        new: true
      }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    res.json({
      ok: true,
      product: {
        id: updated.sku || updated.frontendId,
        sku: updated.sku || undefined,
        upc: updated.upc || undefined,
        frontendId: updated.frontendId,
        name: updated.name,
        price: updated.price,
        deposit: updated.deposit ?? 0,
        stock: updated.stock ?? 0,
        sizeOz: updated.sizeOz ?? 0,
        category: updated.category ?? 'DRINK',
        image: updated.image ?? '',
        brand: updated.brand || '',
        productType: updated.productType || '',
        storageZone: updated.storageZone || '',
        storageBin: updated.storageBin || '',
        isGlass: !!updated.isGlass,
        isHeavy: !!updated.isHeavy
      }
    });
  } catch (err) {
    console.error('UPDATE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.delete('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const paramId = req.params.id;
    const deleted = await Product.findOneAndDelete({ $or: [{ frontendId: paramId }, { sku: paramId }] }).lean();
    if (!deleted) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
