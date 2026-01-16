import express from 'express';
import ReturnVerification from '../models/ReturnVerification.js';
import ReturnSettlement from '../models/ReturnSettlement.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

// Submit return verification (driver)
router.post('/verify', authRequired, async (req, res) => {
  try {
    const { orderId, driverId, customerId, scans, recognizedCount, unrecognizedCount, duplicatesCount, conditionFlags } = req.body;

    if (!orderId || !driverId || !customerId) {
      return res.status(400).json({ error: 'orderId, driverId, and customerId are required' });
    }

    const verification = new ReturnVerification({
      orderId,
      driverId,
      customerId,
      scans: scans || [],
      recognizedCount: recognizedCount || 0,
      unrecognizedCount: unrecognizedCount || 0,
      duplicatesCount: duplicatesCount || 0,
      conditionFlags: conditionFlags || []
    });

    await verification.save();

    res.json({ verification });
  } catch (error) {
    console.error('Return verification error:', error);
    res.status(500).json({ error: 'Failed to submit return verification' });
  }
});

// Get return verifications (owner/admin)
router.get('/verifications', ownerRequired, async (req, res) => {
  try {
    const verifications = await ReturnVerification.find()
      .sort({ submittedAt: -1 })
      .limit(100);

    res.json({ verifications });
  } catch (error) {
    console.error('Get verifications error:', error);
    res.status(500).json({ error: 'Failed to get verifications' });
  }
});

// Approve/reject verification and create settlement (owner/admin)
router.post('/verifications/:id/settle', ownerRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { finalAcceptedCount, creditAmount, cashAmount, feesApplied, status, reviewNotes } = req.body;

    const verification = await ReturnVerification.findById(id);
    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    // Update verification status
    verification.status = status || 'APPROVED';
    if (reviewNotes) {
      verification.reviewNotes = reviewNotes;
    }
    await verification.save();

    // Create settlement if approved
    let settlement = null;
    if (status === 'APPROVED') {
      settlement = new ReturnSettlement({
        verificationId: verification._id,
        finalAcceptedCount,
        creditAmount: creditAmount || 0,
        cashAmount: cashAmount || 0,
        feesApplied: feesApplied || 0,
        settledBy: req.user.username || req.user.id
      });
      await settlement.save();
    }

    res.json({ verification, settlement });
  } catch (error) {
    console.error('Settle verification error:', error);
    res.status(500).json({ error: 'Failed to settle verification' });
  }
});

// Get settlements (owner/admin)
router.get('/settlements', ownerRequired, async (req, res) => {
  try {
    const settlements = await ReturnSettlement.find()
      .populate('verificationId')
      .sort({ settledAt: -1 })
      .limit(100);

    res.json({ settlements });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(500).json({ error: 'Failed to get settlements' });
  }
});

export default router;