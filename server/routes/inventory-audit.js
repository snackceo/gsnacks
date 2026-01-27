import express from 'express';
import InventoryAudit from '../models/InventoryAudit.js';
import { authRequired, managerOrOwnerRequired } from '../utils/helpers.js';

const router = express.Router();

// GET /api/inventory-audit - get audits, optionally filter by auditId
router.get('/', authRequired, async (req, res) => {
  try {
    const { auditId } = req.query;
    const query = auditId ? { auditId } : {};
    const audits = await InventoryAudit.find(query).populate('productId', 'name sku').sort({ createdAt: -1 }).lean();
    if (!audits || audits.length === 0) {
      return res.json({ ok: true, audits: [], message: 'No inventory audits found for the given criteria.' });
    }
    res.json({ ok: true, audits });
  } catch (err) {
    console.error('Error fetching inventory audits:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch audits', details: err?.message || err });
  }
});

// POST /api/inventory-audit - create or update an audit entry (manager or owner only)
router.post('/', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const { auditId, location, productId, countedQuantity } = req.body;
    if (!auditId || !location || !productId || typeof countedQuantity !== 'number') {
      return res.status(400).json({ ok: false, error: 'Missing or invalid required fields' });
    }
    // Idempotent upsert
    let audit = await InventoryAudit.findOne({ auditId, location, productId });
    if (audit) {
      audit.countedQuantity = countedQuantity;
      await audit.save();
      return res.json({ ok: true, audit, message: 'Audit entry updated.' });
    } else {
      audit = new InventoryAudit({ auditId, location, productId, countedQuantity });
      await audit.save();
      return res.json({ ok: true, audit, message: 'Audit entry created.' });
    }
  } catch (err) {
    console.error('Error saving inventory audit:', err);
    res.status(500).json({ ok: false, error: 'Failed to save audit', details: err?.message || err });
  }
});

// DELETE /api/inventory-audit - delete an audit entry (manager or owner only)
router.delete('/', authRequired, managerOrOwnerRequired, async (req, res) => {
  try {
    const { auditId, location, productId } = req.body;
    if (!auditId || !location || !productId) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    const result = await InventoryAudit.deleteOne({ auditId, location, productId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ ok: false, error: 'Audit entry not found or already deleted.' });
    }
    res.json({ ok: true, message: 'Audit entry deleted.' });
  } catch (err) {
    console.error('Error deleting inventory audit:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete audit', details: err?.message || err });
  }
});

export default router;