import * as receiptSettingsService from '../services/receiptSettingsService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getReceiptSettings = asyncHandler(async (req, res, next) => {
  const settings = await receiptSettingsService.getSettings();
  res.json({ ok: true, settings });
});

export const updateReceiptSettings = asyncHandler(async (req, res, next) => {
  const settings = await receiptSettingsService.updateSettings({
    priceLockDays: req.body.priceLockDays,
    actorId: req.user?._id,
  });
  res.json({ ok: true, settings });
});