import express from 'express';

import ScanSession from '../models/ScanSession.js';
import { authRequired, isDriverUsername, isOwnerUsername } from '../utils/helpers.js';

const router = express.Router();

router.post('/', authRequired, async (req, res) => {
  try {
    const username = req.user?.username || '';
    if (!isOwnerUsername(username) && !isDriverUsername(username)) {
      return res.status(403).json({ error: 'Driver access required' });
    }

    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const payload = {
      orderId,
      driverId: String(req.body?.driverId || '').trim(),
      sessionId: String(req.body?.sessionId || '').trim(),
      startedAt: req.body?.startedAt ? new Date(req.body.startedAt) : undefined,
      stage: String(req.body?.stage || '').trim(),
      summary: req.body?.summary || {},
      scanEvents: Array.isArray(req.body?.scanEvents) ? req.body.scanEvents : [],
      quantityEvents: Array.isArray(req.body?.quantityEvents)
        ? req.body.quantityEvents
        : []
    };

    const doc = await ScanSession.create(payload);
    return res.json({ ok: true, id: doc._id.toString() });
  } catch (err) {
    console.error('SCAN SESSION ERROR:', err);
    return res.status(500).json({ error: 'Failed to record scan session' });
  }
});

export default router;
