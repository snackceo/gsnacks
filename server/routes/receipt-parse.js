import express from 'express';
import mongoose from 'mongoose';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { isDbReady } from '../db/connect.js';

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
// Enqueues parse job as a draft proposal
router.post('/receipt-parse', async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }
  const { captureId, rawText, structured, storeCandidate, items } = req.body;
  if (!captureId) {
    return res.status(400).json({ error: 'captureId required' });
  }
  const job = new ReceiptParseJob({
    captureId,
    status: 'QUEUED',
    rawText,
    structured,
    storeCandidate,
    items
  });
  await job.save();
  res.json({ ok: true, jobId: job._id });
});

export default router;
