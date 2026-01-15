import express from 'express';

import UpcItem from '../models/UpcItem.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const normalizeContainerType = value => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'glass') return 'glass';
  if (raw === 'plastic') return 'plastic';
  if (raw === 'aluminum' || raw === 'can' || raw === 'cans') return 'aluminum';
  return undefined;
};

const coerceNumber = value => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const MICHIGAN_DEPOSIT_VALUE = 0.1;

const getMichiganDepositValue = async () => MICHIGAN_DEPOSIT_VALUE;

const buildEligibilityPayload = (entry, depositValue) => {
  const containerType =
    normalizeContainerType(entry?.containerType) ||
    (entry?.isGlass ? 'glass' : 'plastic');
  const payload = {
    eligible: entry ? entry.isEligible !== false : false,
    depositValue: entry
      ? Number(entry.depositValue || depositValue)
      : depositValue,
    containerType,
    sizeOz: entry ? coerceNumber(entry.sizeOz) : 0,
    price: entry ? coerceNumber(entry.price) : 0
  };

  if (entry?.name) {
    payload.name = entry.name;
  }

  return payload;
};

const normalizeUpcList = value => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map(item => String(item || '').trim())
    .filter(Boolean);
};

const synchronizeContainerType = (updates) => {
  const newUpdates = { ...updates };
  if (newUpdates.isGlass !== undefined) newUpdates.isGlass = !!newUpdates.isGlass;
  if (newUpdates.containerType) {
    newUpdates.containerType = normalizeContainerType(newUpdates.containerType);
  }
  if (newUpdates.containerType && newUpdates.isGlass === undefined) {
    newUpdates.isGlass = newUpdates.containerType === 'glass';
  } else if (newUpdates.isGlass !== undefined && !newUpdates.containerType) {
    newUpdates.containerType = newUpdates.isGlass ? 'glass' : 'plastic';
  }
  return newUpdates;
};

router.get('/eligibility', async (req, res) => {
  try {
    const upc = String(req.query?.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const depositValue = await getMichiganDepositValue();
    const entry = await UpcItem.findOne({ upc }).lean();
    res.json(buildEligibilityPayload(entry, depositValue));
  } catch (err) {
    console.error('UPC ELIGIBILITY ERROR:', err);
    res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
});

router.post('/eligibility', async (req, res) => {
  try {
    const body = req.body;
    const upcs = normalizeUpcList(Array.isArray(body) ? body : body?.upcs);
    const depositValue = await getMichiganDepositValue();

    if (upcs.length > 0) {
      const entries = await UpcItem.find({ upc: { $in: upcs } }).lean();
      const entryMap = new Map(entries.map(entry => [entry.upc, entry]));
      const results = upcs.map(upc => ({
        upc,
        ...buildEligibilityPayload(entryMap.get(upc), depositValue)
      }));

      return res.json({ results });
    }

    const upc = String(body?.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });

    const entry = await UpcItem.findOne({ upc }).lean();
    return res.json(buildEligibilityPayload(entry, depositValue));
  } catch (err) {
    console.error('UPC ELIGIBILITY BULK ERROR:', err);
    return res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
});

router.get('/eligibility/:upc', async (req, res) => {
  try {
    const upc = String(req.params.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const depositValue = await getMichiganDepositValue();

    const entry = await UpcItem.findOne({ upc }).lean();
    if (!entry) {
      return res.json({ ok: true, upc, isEligible: false, depositValue });
    }

    res.json({
      ok: true,
      upc,
      isEligible: entry.isEligible !== false,
      depositValue: Number(entry.depositValue || depositValue)
    });
  } catch (err) {
    console.error('UPC ELIGIBILITY ERROR:', err);
    res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
});

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const entries = await UpcItem.find({}).sort({ updatedAt: -1 }).lean();
    const depositValue = await getMichiganDepositValue();
    const upcItems = entries.map(entry => ({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: depositValue,
      price: coerceNumber(entry.price),
      containerType:
        normalizeContainerType(entry.containerType) ||
        (entry.isGlass ? 'glass' : 'plastic'),
      sizeOz: coerceNumber(entry.sizeOz),
      isEligible: entry.isEligible !== false,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
    }));

    res.json({ ok: true, upcItems });
  } catch (err) {
    console.error('GET UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to load UPC list' });
  }
});

router.post('/', authRequired, ownerRequired, async (req, res) => {
  try {
    const upc = String(req.body?.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const depositValue = await getMichiganDepositValue();

    let updates = {
      upc,
      name: req.body?.name ?? '',
      depositValue: depositValue,
      sku: req.body?.sku ? String(req.body.sku).trim() : undefined,
      price: coerceNumber(req.body?.price),
      containerType: normalizeContainerType(req.body?.containerType),
      sizeOz: coerceNumber(req.body?.sizeOz),
      isEligible: req.body?.isEligible !== false
    };
    if (req.body.isGlass !== undefined) updates.isGlass = req.body.isGlass;
    updates = synchronizeContainerType(updates);

    const entry = await UpcItem.findOneAndUpdate({ upc }, updates, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }).lean();

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        sku: entry.sku || undefined,
        name: entry.name || '',
        depositValue: depositValue,
        price: coerceNumber(entry.price),
        containerType:
          normalizeContainerType(entry.containerType) ||
          (entry.isGlass ? 'glass' : 'plastic'),
        sizeOz: coerceNumber(entry.sizeOz),
        isEligible: entry.isEligible !== false,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('UPSERT UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to save UPC' });
  }
});

// Scan and apply a UPC: increment product stock by `qty` (default 1) or create product if unmapped.
router.post('/scan', authRequired, ownerRequired, async (req, res) => {
  try {
    const upc = String(req.body?.upc || '').trim();
    const qty = Number.isFinite(Number(req.body?.qty)) ? Math.floor(Number(req.body.qty)) : 1;
    if (!upc) return res.status(400).json({ error: 'upc is required' });

    const upcEntry = await UpcItem.findOne({ upc }).lean();
    const UpcModel = UpcItem;
    // If mapped SKU exists, increment that product's stock
    const Product = (await import('../models/Product.js')).default;
    if (upcEntry?.sku) {
      const updated = await Product.findOneAndUpdate({ sku: upcEntry.sku }, { $inc: { stock: qty } }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Mapped product not found' });
      return res.json({ ok: true, action: 'updated', product: updated });
    }

    // No mapping: return unmapped action for frontend to handle
    return res.json({ ok: true, action: 'unmapped', upc, upcEntry });
  } catch (err) {
    console.error('UPC SCAN ERROR:', err);
    res.status(500).json({ error: 'Failed to apply UPC scan' });
  }
});

router.patch('/:upc', authRequired, ownerRequired, async (req, res) => {
  try {
    const upc = String(req.params.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });
    const depositValue = await getMichiganDepositValue();

    const updates = {};
    const allowed = [
      'name',
      'price',
      'containerType',
      'sizeOz',
      'isGlass',
      'isEligible'
    ];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    let processedUpdates = { ...updates };
    if (updates.price !== undefined) updates.price = coerceNumber(updates.price);
    if (updates.sizeOz !== undefined) updates.sizeOz = coerceNumber(updates.sizeOz);
    if (updates.isEligible !== undefined) updates.isEligible = !!updates.isEligible;

    processedUpdates = synchronizeContainerType(processedUpdates);

    const entry = await UpcItem.findOneAndUpdate({ upc }, processedUpdates, {
      new: true
    }).lean();

    if (!entry) return res.status(404).json({ error: 'UPC not found' });

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        name: entry.name || '',
        depositValue: depositValue,
        price: coerceNumber(entry.price),
        containerType:
          normalizeContainerType(entry.containerType) ||
          (entry.isGlass ? 'glass' : 'plastic'),
        sizeOz: coerceNumber(entry.sizeOz),
        isEligible: entry.isEligible !== false,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('PATCH UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to update UPC' });
  }
});

router.delete('/:upc', authRequired, ownerRequired, async (req, res) => {
  try {
    const upc = String(req.params.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });

    const deleted = await UpcItem.findOneAndDelete({ upc }).lean();
    if (!deleted) return res.status(404).json({ error: 'UPC not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE UPC ERROR:', err);
    res.status(500).json({ error: 'Failed to delete UPC' });
  }
});

export default router;
