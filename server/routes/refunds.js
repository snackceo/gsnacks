import ApprovalRequest from '../models/ApprovalRequest.js';
import Order from '../models/Order.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';
import express from 'express';

const router = express.Router();

/**
 * POST /api/orders/:id/request-refund
 * Customer or support requests a refund for a paid order.
 * Creates ApprovalRequest of type REFUND for owner approval.
 */
router.post('/:id/request-refund', authRequired, async (req, res) => {
  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Invalid order id' });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PAID') {
      return res.status(400).json({ error: 'Refunds only allowed for PAID orders.' });
    }

    // Prevent duplicate refund requests
    const existing = await ApprovalRequest.findOne({ orderId, type: 'REFUND', status: 'PENDING' });
    if (existing) {
      return res.status(400).json({ error: 'Refund already requested and pending approval.' });
    }

    const { reason, amount, photoProof } = req.body;
    const refundAmount = typeof amount === 'number' ? amount : order.total;

    const approval = await ApprovalRequest.create({
      type: 'REFUND',
      userId: order.customerId,
      amount: refundAmount,
      orderId,
      reason: reason || 'Refund requested',
      photoProof: photoProof || undefined,
      status: 'PENDING'
    });

    return res.json({ ok: true, approval });
  } catch (err) {
    console.error('REQUEST REFUND ERROR:', err);
    res.status(500).json({ error: 'Failed to request refund' });
  }
});

export default router;
