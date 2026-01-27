import express from 'express';

import ScanSession from '../models/ScanSession.js';
import { authRequired, isDriverUsername, isOwnerUsername } from '../utils/helpers.js';

const router = express.Router();


// Strict input validation for scan session
function validateScanSessionInput(body) {
  const allowed = [
    'orderId', 'driverId', 'sessionId', 'startedAt', 'stage', 'summary', 'scanEvents', 'quantityEvents'
  ];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return `Unknown field: ${key}`;
    }
  }
  if (!body.orderId || typeof body.orderId !== 'string') return 'orderId is required';
  if (body.driverId && typeof body.driverId !== 'string') return 'driverId must be a string';
  if (body.sessionId && typeof body.sessionId !== 'string') return 'sessionId must be a string';
  if (body.startedAt && isNaN(Date.parse(body.startedAt))) return 'startedAt must be a valid date';
  if (body.stage && typeof body.stage !== 'string') return 'stage must be a string';
  if (body.summary && typeof body.summary !== 'object') return 'summary must be an object';
  if (body.scanEvents && !Array.isArray(body.scanEvents)) return 'scanEvents must be an array';
  if (body.quantityEvents && !Array.isArray(body.quantityEvents)) return 'quantityEvents must be an array';
  return null;
}

router.post('/', authRequired, async (req, res) => {
  try {
    const username = req.user?.username || '';
    if (!isOwnerUsername(username) && !isDriverUsername(username)) {
      return res.status(403).json({ error: 'Driver access required' });
    }
    const error = validateScanSessionInput(req.body);
    if (error) {
      return res.status(400).json({ error });
    }
    const orderId = String(req.body?.orderId || '').trim();
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
    console.error('SCAN SESSION ERROR:', {
      error: err,
      user: req?.user || 'unknown',
      body: req?.body,
      time: new Date().toISOString()
    });
    return res.status(500).json({ error: 'Failed to record scan session. Please try again later or contact support.' });
  }
});

export default router;
