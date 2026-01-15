import express from 'express';
import InventoryAudit from '../models/InventoryAudit.js';
import { authRequired } from '../utils/helpers.js';

const router = express.Router();

// GET /api/inventory-audit - get audits, optionally filter by auditId
router.get('/', authRequired, async (req, res) => {
  try {
    const { auditId } = req.query;
    const query = auditId ? { auditId } : {};
    const audits = await InventoryAudit.find(query).populate('productId', 'name sku').sort({ createdAt: -1 }).lean();
    res.json({ ok: true, audits });
  } catch (err) {
    console.error('Error fetching inventory audits:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch audits' });
  }
});

// POST /api/inventory-audit - create or update an audit entry
router.post('/', authRequired, async (req, res) => {
  try {
    const { auditId, location, productId, countedQuantity } = req.body;
    if (!auditId || !location || !productId || typeof countedQuantity !== 'number') {
      return res.status(400).json({ ok: false, error: 'Missing or invalid required fields' });
    }
    // Find existing or create new
    let audit = await InventoryAudit.findOne({ auditId, location, productId });
    if (audit) {
      audit.countedQuantity = countedQuantity;
      await audit.save();
    } else {
      audit = new InventoryAudit({ auditId, location, productId, countedQuantity });
      await audit.save();
    }
    res.json({ ok: true, audit });
  } catch (err) {
    console.error('Error saving inventory audit:', err);
    res.status(500).json({ ok: false, error: 'Failed to save audit' });
  }
});

// DELETE /api/inventory-audit - delete an audit entry (optional)
router.delete('/', authRequired, async (req, res) => {
  try {
    const { auditId, location, productId } = req.body;
    if (!auditId || !location || !productId) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    await InventoryAudit.deleteOne({ auditId, location, productId });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting inventory audit:', err);
    res.status(500).json({ ok: false, error: 'Failed to delete audit' });
  }
});

export default router;