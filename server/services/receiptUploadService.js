import mongoose from 'mongoose';
import { handleReceiptImageUpload, ensureIngestionAllowed } from './receiptProcessingService.js';
import { getReceiptIngestionGateState, receiptIngestionMode } from '../../utils/featureFlags.js';
import { MAX_RECEIPT_IMAGE_BYTES } from '../../config/constants.js';

const validateImageBody = (body) => {
  const { image, storeId } = body;

  if (!image) {
    const error = new Error('Image data required');
    error.statusCode = 400;
    throw error;
  }

  if (storeId && !mongoose.Types.ObjectId.isValid(storeId)) {
    const error = new Error('Valid storeId required');
    error.statusCode = 400;
    throw error;
  }

  if (typeof image === 'string' && image.length > MAX_RECEIPT_IMAGE_BYTES) {
    const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
    const error = new Error(`Image too large: ${sizeMB}MB (max 5MB)`);
    error.statusCode = 413;
    throw error;
  }
};

export const handleLegacyUpload = async (body) => {
  validateImageBody(body);
  const { image, storeId } = body;

  if (receiptIngestionMode() === 'disabled') {
    const gate = await getReceiptIngestionGateState({ storeId });
    const error = new Error('Receipt ingestion disabled during rollout');
    error.statusCode = 503;
    error.gate = gate;
    throw error;
  }

  if (storeId) {
    const ingestionCheck = await ensureIngestionAllowed(storeId);
    if (!ingestionCheck.ok) {
      const error = new Error(ingestionCheck.error);
      error.statusCode = ingestionCheck.status;
      error.gate = ingestionCheck.gate;
      throw error;
    }
  }

  try {
    const result = await handleReceiptImageUpload(image);
    return {
      url: result.url,
      thumbnailUrl: result.thumbnailUrl,
    };
  } catch (uploadErr) {
    const error = new Error(uploadErr.message || 'Failed to upload image');
    error.statusCode = 500;
    if (process.env.NODE_ENV === 'development') {
      error.details = uploadErr.stack;
    }
    throw error;
  }
};

export const uploadImage = async (body) => {
  validateImageBody(body);
  try {
    const result = await handleReceiptImageUpload(body.image);
    return {
      url: result.url,
      thumbnailUrl: result.thumbnailUrl,
    };
  } catch (uploadErr) {
    const error = new Error(uploadErr.message || 'Failed to upload image');
    error.statusCode = 500;
    error.details = process.env.NODE_ENV === 'development' ? uploadErr.stack : undefined;
    throw error;
  }
};