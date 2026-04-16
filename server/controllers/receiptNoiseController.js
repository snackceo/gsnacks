import * as receiptNoiseService from '../services/receiptNoiseService.js';

export const getReceiptNoiseRules = async (req, res, next) => {
  try {
    const { storeId } = req.query;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId required' });
    }
    const rules = await receiptNoiseService.getRules(storeId);
    res.json({ ok: true, rules });
  } catch (error) {
    next(error);
  }
};

export const postReceiptNoiseRule = async (req, res, next) => {
  try {
    const rule = await receiptNoiseService.createRule({
      ...req.body,
      actor: req.user?.username || 'unknown',
      isIgnore: req.path.includes('ignore'),
    });
    res.json({ ok: true, rule });
  } catch (error) {
    next(error);
  }
};

export const deleteReceiptNoiseRule = async (req, res, next) => {
  try {
    await receiptNoiseService.deleteRule({
      ...req.body,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};