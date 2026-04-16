import mongoose from 'mongoose';
import StoreInventory from '../../models/StoreInventory.js';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import { recordAuditLog } from '../../utils/audit.js';
import { isDbReady } from '../../db/connect.js';
import * as receiptProcessingService from '../../services/receiptProcessingService.js';
import ReceiptNameAlias from '../../models/ReceiptNameAlias.js';

const {
  DEFAULT_PRICE_LOCK_DAYS,
  validateUPC,
  validatePriceQuantity,
  sanitizeSearch,
} = receiptProcessingService;

export const getReceiptItems = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.params;
    const { q } = req.query;
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    const query = {
      storeId
    };

    if (q) {
      query.normalizedName = { $regex: sanitizeSearch(q), $options: 'i' };
    }

    const aliases = await ReceiptNameAlias.find(query)
      .sort({ lastSeenAt: -1 })
      .limit(200)
      .lean();

    res.json({ ok: true, aliases });
  } catch (error) {
    console.error('Error fetching receipt items:', error);
    res.status(500).json({ error: 'Failed to fetch receipt items' });
  }
};

export const getReceiptItemHistory = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, productId } = req.query;
    if (!storeId || !productId) {
      return res.status(400).json({ error: 'storeId and productId required' });
    }

    const inventory = await StoreInventory.findOne({
      storeId,
      productId
    }).lean();

    if (!inventory) {
      return res.json({ ok: true, history: [] });
    }

    res.json({ ok: true, history: inventory.priceHistory || [] });
  } catch (error) {
    console.error('Error fetching receipt item history:', error);
    res.status(500).json({ error: 'Failed to fetch receipt item history' });
  }
};

export const postReceiptRefresh = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.body;
    const username = req.user?.username || 'unknown';

    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ error: 'Valid storeId required' });
    }

    const failed = await ReceiptCapture.find({ storeId, status: 'failed' });
    if (failed.length === 0) {
      return res.json({ ok: true, message: 'No failed receipts to refresh' });
    }

    for (const capture of failed) {
      capture.status = 'pending_parse';
      capture.parseError = null;
      await capture.save();
    }

    await recordAuditLog({
      type: 'receipt_refresh',
      actorId: username,
      details: `storeId=${storeId} count=${failed.length}`
    });

    res.json({ ok: true, refreshed: failed.length });
  } catch (error) {
    console.error('Error refreshing receipts:', error);
    res.status(500).json({ error: 'Failed to refresh receipts' });
  }
};

export const postReceiptLock = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, days = DEFAULT_PRICE_LOCK_DAYS } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    capture.reviewExpiresAt = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
    await capture.save();

    await recordAuditLog({
      type: 'receipt_lock',
      actorId: username,
      details: `captureId=${captureId} days=${days}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error locking receipt capture:', error);
    res.status(500).json({ error: 'Failed to lock receipt capture' });
  }
};

export const postReceiptUnlock = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    const username = req.user?.username || 'unknown';

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    capture.reviewExpiresAt = null;
    await capture.save();

    await recordAuditLog({
      type: 'receipt_unlock',
      actorId: username,
      details: `captureId=${captureId}`
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error unlocking receipt capture:', error);
    res.status(500).json({ error: 'Failed to unlock receipt capture' });
  }
};

export const getReceiptStoreSummary = async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const summary = await ReceiptCapture.aggregate([
      {
        $group: {
          _id: '$storeId',
          storeName: { $first: '$storeName' },
          totalCaptures: { $sum: 1 },
          pendingParse: { $sum: { $cond: [{ $eq: ['$status', 'pending_parse'] }, 1, 0] } },
          parsed: { $sum: { $cond: [{ $eq: ['$status', 'parsed'] }, 1, 0] } },
          reviewComplete: { $sum: { $cond: [{ $eq: ['$status', 'review_complete'] }, 1, 0] } },
          committed: { $sum: { $cond: [{ $eq: ['$status', 'committed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
        }
      },
      {
        $sort: { totalCaptures: -1 }
      }
    ]);

    res.json({ ok: true, summary });
  } catch (error) {
    console.error('Error fetching receipt store summary:', error);
    res.status(500).json({ error: 'Failed to fetch store summary' });
  }
};

export const postReceiptFixUpc = async (req, res) => {
  // This function's logic is now in receiptCaptureController.js
  // This is just a placeholder to avoid breaking the route.
  // The route should be updated to point to the new controller.
  res.status(501).json({ error: 'Not implemented. Route to receiptCaptureController.' });
};

export const postReceiptFixPrice = async (req, res) => {
  // This function's logic is now in receiptCaptureController.js
  res.status(501).json({ error: 'Not implemented. Route to receiptCaptureController.' });
};

export const postReceiptResetReview = async (req, res) => {
  // This function's logic is now in receiptCaptureController.js
  res.status(501).json({ error: 'Not implemented. Route to receiptCaptureController.' });
};

export const postReceiptPriceUpdateManual = async (req, res) => {
  // This function is deprecated and its logic was removed.
  res.status(410).json({ error: 'This endpoint is deprecated and no longer available.' });
};