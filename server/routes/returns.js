import express from 'express';
import ReturnVerification from '../models/ReturnVerification.js';
import ReturnSettlement from '../models/ReturnSettlement.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

// Submit return verification (driver)

// Strict input validation for return verification
function validateReturnVerificationInput(body) {
  const allowed = [
    'orderId', 'driverId', 'customerId', 'scans', 'recognizedCount', 'unrecognizedCount', 'duplicatesCount', 'conditionFlags'
  ];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return `Unknown field: ${key}`;
    }
  }
  if (!body.orderId || typeof body.orderId !== 'string') return 'orderId is required';
  if (!body.driverId || typeof body.driverId !== 'string') return 'driverId is required';
  if (!body.customerId || typeof body.customerId !== 'string') return 'customerId is required';
  if (body.scans && !Array.isArray(body.scans)) return 'scans must be an array';
  if (body.recognizedCount && typeof body.recognizedCount !== 'number') return 'recognizedCount must be a number';
  if (body.unrecognizedCount && typeof body.unrecognizedCount !== 'number') return 'unrecognizedCount must be a number';
  if (body.duplicatesCount && typeof body.duplicatesCount !== 'number') return 'duplicatesCount must be a number';
  if (body.conditionFlags && !Array.isArray(body.conditionFlags)) return 'conditionFlags must be an array';
  return null;
}

router.post('/verify', authRequired, async (req, res) => {
  try {
    const error = validateReturnVerificationInput(req.body);
    if (error) {
      return res.status(400).json({ error });
    }
    const { orderId, driverId, customerId, scans, recognizedCount, unrecognizedCount, duplicatesCount, conditionFlags } = req.body;
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
    console.error('Return verification error:', {
      error,
      user: req?.user || 'unknown',
      body: req?.body,
      time: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to submit return verification. Please try again later or contact support.' });
  }
});

// Get return verifications (owner/admin)

// GET /verifications?orderId=...&driverId=...&customerId=...
router.get('/verifications', authRequired, ownerRequired, async (req, res) => {
  try {
    const { orderId, driverId, customerId, status } = req.query;
    const filter = {};
    if (orderId) filter.orderId = orderId;
    if (driverId) filter.driverId = driverId;
    if (customerId) filter.customerId = customerId;
    if (status) filter.status = status;
    // Only allow known fields
    for (const key of Object.keys(req.query)) {
      if (!['orderId', 'driverId', 'customerId', 'status'].includes(key)) {
        return res.status(400).json({ error: `Unknown query param: ${key}` });
      }
    }
    const verifications = await ReturnVerification.find(filter)
      .sort({ submittedAt: -1 })
      .limit(100);
    if (!verifications || verifications.length === 0) {
      return res.json({ verifications: [], message: 'No return verifications found for the given filters.' });
    }
    res.json({ verifications });
  } catch (error) {
    console.error('Get verifications error:', {
      error,
      user: req?.user || 'unknown',
      query: req?.query,
      time: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to get verifications. Please try again later or contact support.' });
  }
});

// Approve/reject verification and create settlement (owner/admin)

// Strict input validation for settlement
function validateSettlementInput(body) {
  const allowed = [
    'finalAcceptedCount', 'creditAmount', 'cashAmount', 'feesApplied', 'status', 'reviewNotes'
  ];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      return `Unknown field: ${key}`;
    }
  }
  if (body.finalAcceptedCount == null || typeof body.finalAcceptedCount !== 'number') return 'finalAcceptedCount is required and must be a number';
  if (body.creditAmount != null && typeof body.creditAmount !== 'number') return 'creditAmount must be a number';
  if (body.cashAmount != null && typeof body.cashAmount !== 'number') return 'cashAmount must be a number';
  if (body.feesApplied != null && typeof body.feesApplied !== 'number') return 'feesApplied must be a number';
  if (body.status && !['APPROVED', 'REJECTED', 'REVIEWED', 'SUBMITTED'].includes(body.status)) return 'Invalid status';
  if (body.reviewNotes && typeof body.reviewNotes !== 'string') return 'reviewNotes must be a string';
  return null;
}

router.post('/verifications/:id/settle', authRequired, ownerRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const error = validateSettlementInput(req.body);
    if (error) {
      return res.status(400).json({ error });
    }
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
    console.error('Settle verification error:', {
      error,
      user: req?.user || 'unknown',
      params: req?.params,
      body: req?.body,
      time: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to settle verification. Please try again later or contact support.' });
  }
});

// Get settlements (owner/admin)

// GET /settlements?verificationId=...&settledBy=...
router.get('/settlements', authRequired, ownerRequired, async (req, res) => {
  try {
    const { verificationId, settledBy } = req.query;
    const filter = {};
    if (verificationId) filter.verificationId = verificationId;
    if (settledBy) filter.settledBy = settledBy;
    // Only allow known fields
    for (const key of Object.keys(req.query)) {
      if (!['verificationId', 'settledBy'].includes(key)) {
        return res.status(400).json({ error: `Unknown query param: ${key}` });
      }
    }
    const settlements = await ReturnSettlement.find(filter)
      .populate('verificationId')
      .sort({ settledAt: -1 })
      .limit(100);
    if (!settlements || settlements.length === 0) {
      return res.json({ settlements: [], message: 'No settlements found for the given filters.' });
    }
    res.json({ settlements });
  } catch (error) {
    console.error('Get settlements error:', {
      error,
      user: req?.user || 'unknown',
      query: req?.query,
      time: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to get settlements. Please try again later or contact support.' });
  }
});

export default router;
