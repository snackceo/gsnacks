import * as receiptAliasService from '../../services/receipt/receiptAliasService.js';

export const getReceiptAliases = async (req, res, next) => {
  try {
    const aliases = await receiptAliasService.getAliasesByStore(req.query.storeId);
    res.json({ ok: true, aliases });
  } catch (error) {
    next(error);
  }
};

export const postReceiptAlias = async (req, res, next) => {
  try {
    const alias = await receiptAliasService.createAlias({
      ...req.body,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true, alias });
  } catch (error) {
    next(error);
  }
};

export const getReceiptStoreAliases = async (req, res, next) => {
  // This appears to be a duplicate of getReceiptAliases but with a different sort.
  // We will create a specific service method for it.
  try {
    const aliases = await receiptAliasService.getStoreAliasesSortedByConfirmation(req.query.storeId);
    res.json({ ok: true, aliases });
  } catch (error) {
    next(error);
  }
};

export const getReceiptAliasHistory = async (req, res, next) => {
  try {
    const alias = await receiptAliasService.getAliasHistory(req.query);
    res.json({ ok: true, alias });
  } catch (error) {
    next(error);
  }
};

export const postReceiptConfirmMatch = async (req, res, next) => {
  try {
    const result = await receiptAliasService.confirmMatch({
      ...req.body,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};