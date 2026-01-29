
import express from 'express';
import mongoose from 'mongoose';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { isDbReady } from '../db/connect.js';
import { isReceiptQueueEnabled, enqueueReceiptJob } from '../queues/receiptQueue.js';
import { executeReceiptParse } from '../utils/receiptParseHelper.js';

const router = express.Router();

// POST /api/driver/receipt-capture
// Accepts image URL and creates a captureId (stub for now)
router.post('/receipt-capture', async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  // TODO: Implement image upload/capture logic
  const { imageUrl } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl required' });
  }
  // For now, just generate a random captureId
  const captureId = new mongoose.Types.ObjectId().toString();
  res.json({ ok: true, captureId });
});


// POST /api/driver/receipt-parse
// Calls the real pipeline: validates, queues or runs parse
router.post('/receipt-parse', async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const { captureId } = req.body;
  if (!captureId) {
    return res.status(400).json({ error: 'captureId required' });
  }

  // If queue is enabled, enqueue the job for async processing
  if (isReceiptQueueEnabled()) {
    try {
      const result = await enqueueReceiptJob('receipt-parse', { captureId, actor: req.user?._id || 'api' });
      if (result.ok) {
        return res.json({ ok: true, queued: true, jobId: result.jobId });
      } else {
        return res.status(500).json({ error: 'Failed to enqueue receipt parse job', ...result });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to enqueue receipt parse job' });
    }
  }

  // Otherwise, run the parse pipeline directly (synchronous)
  try {
    const parseJob = await executeReceiptParse(captureId, req.user?._id || 'api');
    return res.json({ ok: true, queued: false, job: parseJob });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Receipt parse failed' });
  }
});

export default router;
