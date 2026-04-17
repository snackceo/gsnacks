import * as receiptParseService from '../../services/receipt/receiptParseService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const postReceiptParse = asyncHandler(async (req, res, next) => {
  const result = await receiptParseService.triggerParse({
    captureId: req.body.captureId,
    user: req.user,
  });
  res.status(result.queued ? 202 : 200).json({ ok: true, ...result });
});

export const postReceiptParseFrame = asyncHandler(async (req, res, next) => {
  const items = await receiptParseService.parseFrame(req.body);
  res.json({ ok: true, items });
});

export const postReceiptParseLive = asyncHandler(async (req, res, next) => {
  const result = await receiptParseService.saveLiveParse({
    ...req.body,
    user: req.user,
  });
  res.json({ ok: true, ...result });
});

export const getReceiptParseJobs = asyncHandler(async (req, res, next) => {
  // This is a deprecated endpoint. For now, we'll just return an empty array.
  // The new endpoint is GET /api/receipts
  res.json({ ok: true, jobs: [] });
});