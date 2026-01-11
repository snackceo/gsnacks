import express from 'express';

import ApprovalRequest from '../models/ApprovalRequest.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const mapApproval = (approval) => ({
  id: approval._id.toString(),
  type: approval.type,
  userId: approval.userId,
  amount: Number(approval.amount || 0),
  orderId: approval.orderId || undefined,
  reason: approval.reason || undefined,
  photoProof: approval.photoProof || undefined,
  status: approval.status || 'PENDING',
  createdAt: approval.createdAt
    ? new Date(approval.createdAt).toISOString()
    : new Date().toISOString(),
  processedAt: approval.processedAt
    ? new Date(approval.processedAt).toISOString()
    : undefined
});

const updateApprovalStatus = async (req, res, status) => {
  try {
    const approvalId = String(req.params.id || '').trim();
    if (!approvalId) {
      return res.status(400).json({ error: 'Approval id is required' });
    }

    const approval = await ApprovalRequest.findById(approvalId);
    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    approval.status = status;
    approval.processedAt = new Date();
    await approval.save();

    return res.json({ ok: true, approval: mapApproval(approval) });
  } catch (err) {
    console.error('APPROVAL UPDATE ERROR:', err);
    return res.status(500).json({ error: 'Failed to update approval' });
  }
};

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const approvals = await ApprovalRequest.find({})
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, approvals: approvals.map(mapApproval) });
  } catch (err) {
    console.error('APPROVAL LIST ERROR:', err);
    res.status(500).json({ error: 'Failed to load approvals' });
  }
});

router.post('/:id/approve', authRequired, ownerRequired, (req, res) =>
  updateApprovalStatus(req, res, 'APPROVED')
);

router.post('/:id/reject', authRequired, ownerRequired, (req, res) =>
  updateApprovalStatus(req, res, 'REJECTED')
);

export default router;
