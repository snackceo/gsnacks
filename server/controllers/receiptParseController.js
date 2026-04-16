import * as receiptParseService from '../../services/receipt/receiptParseService.js';

export const postReceiptParse = async (req, res, next) => {
  try {
    const result = await receiptParseService.triggerParse({
      captureId: req.body.captureId,
      user: req.user,
    });
    res.status(result.queued ? 202 : 200).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const postReceiptParseFrame = async (req, res, next) => {
  try {
    const items = await receiptParseService.parseFrame(req.body);
    res.json({ ok: true, items });
  } catch (error) {
    next(error);
  }
};

export const postReceiptParseLive = async (req, res, next) => {
  try {
    const result = await receiptParseService.saveLiveParse({
      ...req.body,
      user: req.user,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getReceiptParseJobs = async (req, res, next) => {
  // This is a deprecated endpoint. For now, we'll just return an empty array.
  // The new endpoint is GET /api/receipts
  res.json({ ok: true, jobs: [] });
};