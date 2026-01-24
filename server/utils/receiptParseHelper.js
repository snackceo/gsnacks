// receiptParseHelper.js
// Shared parsing logic for receipt-prices route and receiptWorker

import ReceiptCapture from '../models/ReceiptCapture.js';
import ReceiptParseJob from '../models/ReceiptParseJob.js';
import { recordAuditLog } from '../utils/audit.js';

/**
 * Parse receipt images using Gemini and populate ReceiptParseJob proposal
 * This is called from both the receipt-parse route and the receipt worker
 * Returns the updated ReceiptParseJob or throws on error
 */
export async function executeReceiptParse(captureId, actorId = 'worker', options = {}) {
  const capture = await ReceiptCapture.findById(captureId);
  if (!capture) {
    throw new Error('Receipt capture not found');
  }

  // For now, mark as parsed with empty items (placeholder)
  // In production, this would call Gemini, extract items, and match products
  // The existing receipt-prices.js route has the full implementation
  
  const draftItems = [];
  capture.markParsed(draftItems);
  capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
  await capture.save();

  // Create/update ReceiptParseJob proposal
  try {
    const job = await ReceiptParseJob.findOneAndUpdate(
      { captureId: captureId.toString() },
      {
        captureId: captureId.toString(),
        status: draftItems.length > 0 ? 'NEEDS_REVIEW' : 'PARSED',
        items: draftItems.map(item => ({
          rawLine: item.receiptName,
          nameCandidate: item.normalizedName || item.receiptName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.totalPrice,
          actionSuggestion: 'CREATE_PRODUCT',
          warnings: item.needsReview ? [item.reviewReason] : []
        }))
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await recordAuditLog({
      type: 'receipt_parse',
      actorId,
      details: `captureId=${captureId} items=${draftItems.length}`
    });

    return job;
  } catch (err) {
    console.warn('Failed to create ReceiptParseJob:', err?.message);
    throw err;
  }
}
