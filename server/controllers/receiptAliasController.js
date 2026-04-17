import * as receiptAliasService from '../services/receiptAliasService.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getReceiptAliases = asyncHandler(async (req, res, next) => {
  const aliases = await receiptAliasService.getAliasesByStore(req.query.storeId);
  res.json({ ok: true, aliases });
});

export const postReceiptAlias = asyncHandler(async (req, res, next) => {
  const alias = await receiptAliasService.createAlias({
    ...req.body,
    actorId: req.user?._id,
  });
  res.json({ ok: true, alias });
});

export const getReceiptStoreAliases = asyncHandler(async (req, res, next) => {
  // This appears to be a duplicate of getReceiptAliases but with a different sort.
  // We will create a specific service method for it.
  const aliases = await receiptAliasService.getStoreAliasesSortedByConfirmation(req.query.storeId);
  res.json({ ok: true, aliases });
});

export const getReceiptAliasHistory = asyncHandler(async (req, res, next) => {
  const alias = await receiptAliasService.getAliasHistory(req.query);
  res.json({ ok: true, alias });
});

export const postReceiptConfirmMatch = asyncHandler(async (req, res, next) => {
  const result = await receiptAliasService.confirmMatch({
    ...req.body,
    actorId: req.user?._id,
  });
  res.json({ ok: true, ...result });
});