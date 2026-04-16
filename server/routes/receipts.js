import express from 'express';
import * as receiptController from '../controllers/receipts.controller.js';
import { isAuthenticated } from '../middleware/auth.js'; // Assuming you have auth middleware

const router = express.Router();

router.get('/', isAuthenticated, receiptController.getReceipts);
router.get('/:jobId', isAuthenticated, receiptController.getReceiptJob);
router.post('/:jobId/approve', isAuthenticated, receiptController.approveReceiptJobHandler);
router.post('/:jobId/reject', isAuthenticated, receiptController.rejectReceiptJobHandler);
router.delete('/:captureId', isAuthenticated, receiptController.deleteReceiptHandler);
router.post('/cleanup-queue', isAuthenticated, receiptController.cleanupQueueHandler);

export default router;
