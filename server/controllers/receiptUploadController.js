import * as receiptUploadService from '../services/receiptUploadService.js';

/**
 * @deprecated Legacy combined upload path.
 */
export const postReceiptUpload = async (req, res, next) => {
  try {
    const result = await receiptUploadService.handleLegacyUpload(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * Handles direct image uploads and returns Cloudinary URLs.
 */
export const postUploadReceiptImage = async (req, res, next) => {
  try {
    const result = await receiptUploadService.uploadImage(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
};