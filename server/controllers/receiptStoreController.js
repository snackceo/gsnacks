import * as receiptStoreService from '../services/receiptStoreService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getReceiptStoreCandidates = asyncHandler(async (req, res, next) => {
  const stores = await receiptStoreService.findStoreCandidates(req.query.q);
  res.json({ ok: true, stores });
});

export const postReceiptStoreCandidates = asyncHandler(async (req, res, next) => {
  const result = await receiptStoreService.createStoreCandidate({
    storeData: req.body,
    user: req.user,
  });
  res.json({ ok: true, ...result });
});