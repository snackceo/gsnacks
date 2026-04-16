import * as receiptSettingsService from '../services/receiptSettingsService.js';

export const getReceiptSettings = async (req, res, next) => {
  try {
    const settings = await receiptSettingsService.getSettings();
    res.json({ ok: true, settings });
  } catch (error) {
    error.statusCode = error.message.includes('Database not ready') ? 503 : 500;
    next(error);
  }
};

export const updateReceiptSettings = async (req, res, next) => {
  try {
    const settings = await receiptSettingsService.updateSettings({
      priceLockDays: req.body.priceLockDays,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true, settings });
  } catch (error) {
    if (error.message.includes('must be a number')) error.statusCode = 400;
    if (error.message.includes('Database not ready')) error.statusCode = 503;
    next(error);
  }
};