import * as receiptService from '../services/receipts.service.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getReceipts = asyncHandler(async (req, res, next) => {
  const { user, query } = req;
  const result = await receiptService.getReceipts({ user, query });
  res.status(200).json(result);
});

export const getReceiptJob = asyncHandler(async (req, res, next) => {
  const { user, params } = req;
  const result = await receiptService.getReceiptJob({ user, jobId: params.jobId });
  res.status(200).json(result);
});

export const approveReceiptJobHandler = asyncHandler(async (req, res, next) => {
  const { user, params, body } = req;
  const result = await receiptService.approveReceiptJob({
    user,
    jobId: params.jobId,
    ...body,
  });
  res.status(200).json(result);
});

export const rejectReceiptJobHandler = asyncHandler(async (req, res, next) => {
  const { user, params, body } = req;
  const result = await receiptService.rejectReceiptJob({
    user,
    jobId: params.jobId,
    reason: body.reason,
  });
  res.status(200).json(result);
});

export const deleteReceiptHandler = asyncHandler(async (req, res, next) => {
  const { captureId } = req.params;
  const result = await receiptService.deleteReceipt({ captureId });
  res.status(200).json(result);
});

export const cleanupQueueHandler = asyncHandler(async (req, res, next) => {
  const { user, body } = req;
  const result = await receiptService.cleanupQueue({ user, ...body });
  res.status(200).json(result);
});
