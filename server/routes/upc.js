import express from 'express';

import UpcItem from '../models/UpcItem.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

router.get('/eligibility/:upc', async (req, res) => {
  try {
    const upc = String(req.params.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });

    const entry = await UpcItem.findOne({ upc }).lean();
    if (!entry) {
      return res.status(404).json({ error: 'UPC not found', isEligible: false });
    }

    res.json({
      ok: true,
      upc: entry.upc,
      isEligible: entry.isEligible !== false
    });
  } catch (err) {
    console.error('UPC ELIGIBILITY ERROR:', err);
    res.status(500).json({ error: 'Failed to check UPC eligibility' });
  }
});

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const entries = await UpcItem.find({}).sort({ updatedAt: -1 }).lean();
    const upcItems = entries.map(entry => ({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: Number(entry.depositValue || 0),
      isGlass: !!entry.isGlass,
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

    const updates = {
      upc,
      name: req.body?.name ?? '',
      depositValue: Number(req.body?.depositValue ?? 0.1),
      isGlass: !!req.body?.isGlass,
      isEligible: req.body?.isEligible !== false
    };

    if (!Number.isFinite(updates.depositValue)) {
      return res.status(400).json({ error: 'depositValue must be a number' });
    }

    const entry = await UpcItem.findOneAndUpdate({ upc }, updates, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }).lean();

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        name: entry.name || '',
        depositValue: Number(entry.depositValue || 0),
        isGlass: !!entry.isGlass,
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

router.patch('/:upc', authRequired, ownerRequired, async (req, res) => {
  try {
    const upc = String(req.params.upc || '').trim();
    if (!upc) return res.status(400).json({ error: 'upc is required' });

    const updates = {};
    const allowed = ['name', 'depositValue', 'isGlass', 'isEligible'];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.depositValue !== undefined) {
      updates.depositValue = Number(updates.depositValue);
      if (!Number.isFinite(updates.depositValue)) {
        return res.status(400).json({ error: 'depositValue must be a number' });
      }
    }

    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;
    if (updates.isEligible !== undefined) updates.isEligible = !!updates.isEligible;

    const entry = await UpcItem.findOneAndUpdate({ upc }, updates, {
      new: true
    }).lean();

    if (!entry) return res.status(404).json({ error: 'UPC not found' });

    res.json({
      ok: true,
      upcItem: {
        upc: entry.upc,
        name: entry.name || '',
        depositValue: Number(entry.depositValue || 0),
        isGlass: !!entry.isGlass,
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
