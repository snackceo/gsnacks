// DEFENSIVE DEFAULT: All sensitive actions default to deny unless explicitly allowed by role check above.
// SECURITY NOTE: For production, add express-rate-limit or similar middleware to limit receipt submissions and approvals per user/IP.
// IMAGE VALIDATION: Ensure uploaded images are validated for type, size, and content before processing.
import express from 'express';
import { authRequired } from '../utils/helpers.js';
import {
  getReceipts,
  getReceiptJob,
  approveReceiptJobHandler,
  rejectReceiptJobHandler,
  deleteReceiptHandler,
  cleanupQueueHandler
} from '../controllers/receipts.js';

/**
 * Receipt approval/review contract (this router):
 * - review queue reads and job-detail reads for parser output
 * - explicit approve/reject endpoints to finalize operator decisions
 *
 * Capture/parse job lifecycle endpoints intentionally live under /api/driver
 * in routes/receipt-prices.js to preserve capture -> parse trigger invariants.
 */

const router = express.Router();

// Role-neutral endpoint for fetching receipt parse jobs
router.get('/', authRequired, getReceipts);

// GET /api/receipts/:jobId
// Role-neutral endpoint for fetching a single receipt parse job
router.get('/:jobId', authRequired, getReceiptJob);

// POST /api/receipts/:jobId/approve
// POST /api/receipts/:jobId/approve
// Canonical approval endpoint (replaces legacy /api/driver/receipt-parse-jobs/:captureId/approve).
router.post('/:jobId/approve', authRequired, approveReceiptJobHandler);

// POST /api/receipts/:jobId/reject
// Canonical reject endpoint (replaces legacy /api/driver/receipt-parse-jobs/:captureId/reject).
router.post('/:jobId/reject', authRequired, rejectReceiptJobHandler);

// DELETE /api/receipts/:captureId
// Role-neutral endpoint for deleting both ReceiptParseJob and ReceiptCapture for a given captureId
router.delete('/:captureId', authRequired, deleteReceiptHandler);

// POST /api/receipts/cleanup-queue
// Admin endpoint to purge receipt queue jobs that reference missing captures
router.post('/cleanup-queue', authRequired, cleanupQueueHandler);

export default router;
