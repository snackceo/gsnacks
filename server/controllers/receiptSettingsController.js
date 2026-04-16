import * as receiptSettingsService from '../../services/receipt/receiptSettingsService.js';

export const getReceiptSettings = async (req, res, next) => {
  try {
    const settings = await receiptSettingsService.getSettings();
    res.json({ ok: true, settings });
  } catch (error) {
    next(error);
  }
};

export const updateReceiptSettings = async (req, res, next) => {
  try {
    const result = await receiptSettingsService.updateSettings({
      priceLockDays: req.body.priceLockDays,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true, settings: result });
  } catch (error) {
    if (error.message.includes('must be a number')) {
      error.statusCode = 400;
    }
    next(error);
  }
};