import * as receiptCaptureService from '../services/receiptCaptureService.js';

export const postReceiptCapture = async (req, res, next) => {
  try {
    const result = await receiptCaptureService.createCapture({
      body: req.body,
      user: req.user,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const getReceiptCapture = async (req, res, next) => {
  try {
    const capture = await receiptCaptureService.getCapture(req.params.captureId);
    res.json({ ok: true, capture });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 500;
    next(error);
  }
};

export const getReceiptCaptureItems = async (req, res, next) => {
  try {
    const items = await receiptCaptureService.getCaptureItems(req.params.captureId);
    res.json({ ok: true, items });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 500;
    next(error);
  }
};

export const getReceiptCapturesSummary = async (req, res, next) => {
  try {
    const summary = await receiptCaptureService.getSummary(req.query.storeId);
    res.json({ ok: true, summary });
  } catch (error) {
    if (!error.statusCode) error.statusCode = 500;
    next(error);
  }
};