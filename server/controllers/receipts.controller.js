import * as receiptService from '../services/receipts.service.js';

export const getReceipts = async (req, res) => {
  try {
    const { user, query } = req;
    const result = await receiptService.getReceipts({ user, query });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getReceiptJob = async (req, res) => {
  try {
    const { user, params } = req;
    const result = await receiptService.getReceiptJob({ user, jobId: params.jobId });
    res.status(200).json(result);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const approveReceiptJobHandler = async (req, res) => {
  try {
    const { user, params, body } = req;
    const result = await receiptService.approveReceiptJob({
      user,
      jobId: params.jobId,
      ...body,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, ...error.details });
  }
};

export const rejectReceiptJobHandler = async (req, res) => {
  try {
    const { user, params, body } = req;
    const result = await receiptService.rejectReceiptJob({
      user,
      jobId: params.jobId,
      reason: body.reason,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

export const deleteReceiptHandler = async (req, res) => {
  try {
    const { captureId } = req.params;
    const result = await receiptService.deleteReceipt({ captureId });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const cleanupQueueHandler = async (req, res) => {
  try {
    const { user, body } = req;
    const result = await receiptService.cleanupQueue({ user, ...body });
    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};
