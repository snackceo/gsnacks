import * as receiptStoreService from '../services/receiptStoreService.js';

export const getReceiptStoreCandidates = async (req, res, next) => {
  try {
    const stores = await receiptStoreService.findStoreCandidates(req.query.q);
    res.json({ ok: true, stores });
  } catch (error) {
    next(error);
  }
};

export const postReceiptStoreCandidates = async (req, res, next) => {
  try {
    const result = await receiptStoreService.createStoreCandidate({
      storeData: req.body,
      actor: req.user?.username || 'unknown',
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};