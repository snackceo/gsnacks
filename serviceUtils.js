import mongoose from 'mongoose';
import { isDbReady } from '../db/connect.js';

export const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

export const validateStoreId = (storeId) => {
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    const error = new Error('Valid storeId required');
    error.statusCode = 400;
    throw error;
  }
};

export const validateCaptureId = (captureId) => {
  if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
    const error = new Error('Valid captureId required');
    error.statusCode = 400;
    throw error;
  }
};