import express from 'express';

import AuditLog from '../models/AuditLog.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const mapAuditLog = (log) => ({
  id: log._id.toString(),
  type: log.type,
  actorId: log.actorId,
  details: log.details || '',
  createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : undefined
});


// Allowed audit log types (must match src/types.ts AuditLogType)
const ALLOWED_TYPES = [
  'LOGIN',
  'LOGOUT',
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_CANCELED',
  'ORDER_RETURN_BACKFILL',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'PRODUCT_DELETED',
  'CREDIT_ADJUSTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'SETTINGS_UPDATED'
];

// GET /api/audit-logs?type=ORDER_CREATED&actorId=foo&range=7d
router.get('/', authRequired, ownerRequired, async (req, res) => {
  try {
    // Validate and parse query params
    const { type, actorId, range } = req.query;
    let filter = {};

    // Type filter (must be allowed)
    if (type) {
      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid audit log type' });
      }
      filter.type = type;
    }

    // Actor filter (username or id)
    if (actorId) {
      if (typeof actorId !== 'string' || actorId.length < 2 || actorId.length > 64) {
        return res.status(400).json({ error: 'Invalid actorId' });
      }
      filter.actorId = actorId;
    }

    // Range filter (24h, 7d, 30d)
    let since;
    if (range) {
      const now = Date.now();
      if (range === '24h') since = now - 24 * 60 * 60 * 1000;
      else if (range === '7d') since = now - 7 * 24 * 60 * 60 * 1000;
      else if (range === '30d') since = now - 30 * 24 * 60 * 60 * 1000;
      else return res.status(400).json({ error: 'Invalid range' });
      filter.createdAt = { $gte: new Date(since) };
    }

    // Only allow known fields in query
    for (const key of Object.keys(req.query)) {
      if (!['type', 'actorId', 'range'].includes(key)) {
        return res.status(400).json({ error: `Unknown query param: ${key}` });
      }
    }

    // Query audit logs
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).lean();
    if (!logs || logs.length === 0) {
      return res.json({ ok: true, auditLogs: [], message: 'No audit logs found for the given filters.' });
    }
    res.json({ ok: true, auditLogs: logs.map(mapAuditLog) });
  } catch (err) {
    // Hardened error: log request context for diagnostics
    console.error('AUDIT LOGS ERROR:', {
      error: err,
      user: req?.user || 'unknown',
      query: req?.query,
      time: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to load audit logs. Please try again later or contact support.' });
  }
});

export default router;
