import * as receiptUploadService from '../services/receiptUploadService.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * @deprecated Legacy combined upload path.
 */
export const postReceiptUpload = asyncHandler(async (req, res, next) => {
  const result = await receiptUploadService.handleLegacyUpload(req.body);
  res.json({ ok: true, ...result });
});

/**
 * Handles direct image uploads and returns Cloudinary URLs.
 */
export const postUploadReceiptImage = asyncHandler(async (req, res, next) => {
  const result = await receiptUploadService.uploadImage(req.body);
  res.json({ ok: true, ...result });
});