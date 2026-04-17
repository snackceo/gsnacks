import * as receiptNoiseService from '../services/receiptNoiseService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getReceiptNoiseRules = asyncHandler(async (req, res, next) => {
  const { storeId } = req.query;
  if (!storeId) {
    return res.status(400).json({ error: 'storeId required' });
  }
  const rules = await receiptNoiseService.getRules(storeId);
  res.json({ ok: true, rules });
});

export const postReceiptNoiseRule = asyncHandler(async (req, res, next) => {
  const rule = await receiptNoiseService.createRule({
    ...req.body,
    actorId: req.user?._id,
    isIgnore: req.path.includes('ignore'),
  });
  res.json({ ok: true, rule });
});

export const deleteReceiptNoiseRule = asyncHandler(async (req, res, next) => {
  await receiptNoiseService.deleteRule({
    ...req.body,
    actorId: req.user?._id,
  });
  res.json({ ok: true });
});