import * as receiptNoiseService from '../../services/receipt/receiptNoiseService.js';

export const getReceiptNoiseRules = async (req, res, next) => {
  try {
    const rules = await receiptNoiseService.getRules(req.query.storeId);
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

export const postReceiptNoiseRuleIgnore = async (req, res, next) => {
  // This appears to be a duplicate of postReceiptNoiseRule, but we'll keep the endpoint
  // and route it to the same service method for now.
  return postReceiptNoiseRule(req, res, next);
};

export const deleteReceiptNoiseRuleIgnore = async (req, res, next) => {
  // This appears to be a duplicate of deleteReceiptNoiseRule.
  return deleteReceiptNoiseRule(req, res, next);
};