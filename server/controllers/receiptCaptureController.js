import * as receiptCaptureService from '../services/receiptCaptureService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const postReceiptCapture = asyncHandler(async (req, res, next) => {
  const result = await receiptCaptureService.createCapture({
    body: req.body,
    user: req.user,
  });
  res.json({ ok: true, ...result });
});

export const getReceiptCapture = asyncHandler(async (req, res, next) => {
  const capture = await receiptCaptureService.getCapture(req.params.captureId);
  res.json({ ok: true, capture });
});

export const getReceiptCaptureItems = asyncHandler(async (req, res, next) => {
  const items = await receiptCaptureService.getCaptureItems(req.params.captureId);
  res.json({ ok: true, items });
});

export const getReceiptCapturesSummary = asyncHandler(async (req, res, next) => {
  const summary = await receiptCaptureService.getSummary(req.query.storeId);
  res.json({ ok: true, summary });
});