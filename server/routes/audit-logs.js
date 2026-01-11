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

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, auditLogs: logs.map(mapAuditLog) });
  } catch (err) {
    console.error('AUDIT LOGS ERROR:', err);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

export default router;
