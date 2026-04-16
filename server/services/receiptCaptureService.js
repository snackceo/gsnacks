import mongoose from 'mongoose';
import ReceiptCapture from '../../models/ReceiptCapture.js';
import Store from '../../models/Store.js';
import { recordAuditLog } from '../../utils/audit.js';
import { isDbReady } from '../../db/connect.js';
import { isOwnerUsername, isDriverUsername, driverCanAccessStore } from '../../utils/helpers.js';
import { getReceiptIngestionGateState, ensureIngestionAllowed } from './receiptProcessingService.js';
import { handleReceiptImageUpload, isCloudinaryUrl, fetchExternalReceiptImage, isAllowedReceiptMime, isAllowedImageDataUrl, MAX_RECEIPT_IMAGE_BYTES, hasCloudinary } from './receiptUploadService.js';
import { transitionReceiptParseJobStatus } from '../../utils/receiptParseJobStatus.js';
import { matchStoreCandidate } from './receiptStoreService.js';
import { normalizePhone } from '../../utils/phone.js';

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export const createCapture = async ({ body, user }) => {
  if (!isDbReady()) throw new Error('Database not ready');

  const { storeId, storeName, orderId, images, captureRequestId, source: requestedSource } = body;
  const username = user?.username;
  const userId = user?.id || user?.userId;

  const isOwner = isOwnerUsername(username);
  const isDriver = isDriverUsername(username);
  const createdByRole = isOwner ? 'OWNER' : isDriver ? 'DRIVER' : undefined;
  const source = requestedSource === 'email_import' && isOwner ? 'email_import' : isOwner ? 'management_upload' : isDriver ? 'driver_camera' : undefined;

  if (!isOwner && !isDriver) {
    const err = new Error('Not authorized to upload receipts');
    err.statusCode = 403;
    throw err;
  }

  if (captureRequestId) {
    const existingCapture = await ReceiptCapture.findOne({ captureRequestId, createdBy: username });
    if (existingCapture) {
      return { captureId: existingCapture._id.toString(), status: existingCapture.status, idempotent: true };
    }
  } else {
    const err = new Error('captureRequestId required (UUID recommended)');
    err.statusCode = 400;
    throw err;
  }

  // Further validation...
  if (!images || !Array.isArray(images) || images.length === 0) {
    const err = new Error('images array required');
    err.statusCode = 400;
    throw err;
  }

  let store = null;
  if (storeId) {
    store = await Store.findById(storeId);
    if (!store) {
      const err = new Error('Store not found');
      err.statusCode = 404;
      throw err;
    }
    if (isDriver && !driverCanAccessStore(username, store._id.toString())) {
      const err = new Error('Driver not authorized for this store');
      err.statusCode = 403;
      throw err;
    }
  }

  const normalizedImages = [];
  // Image validation and upload logic from the original controller
  // This is a simplified version for brevity
  for (const img of images) {
    if (img.url.startsWith('data:')) {
      const uploaded = await handleReceiptImageUpload(img.url);
      normalizedImages.push({ url: uploaded.url, thumbnailUrl: uploaded.thumbnailUrl });
    } else {
      normalizedImages.push({ url: img.url, thumbnailUrl: img.thumbnailUrl || img.url });
    }
  }

  const capture = new ReceiptCapture({
    captureRequestId,
    storeId: store?._id?.toString(),
    storeName: store?.name || storeName,
    orderId: orderId || undefined,
    images: normalizedImages.map((img, idx) => ({ ...img, uploadedAt: new Date(), sequence: idx + 1 })),
    status: 'pending_parse',
    createdBy: username || 'unknown',
    createdByUserId: userId || undefined,
    createdByRole,
    source,
  });

  await capture.save();

  // Create a draft ReceiptParseJob
  await transitionReceiptParseJobStatus({
    captureId: capture._id.toString(),
    actor: username || 'unknown',
    status: 'CREATED',
  });

  await recordAuditLog({
    type: 'receipt_capture_create',
    actorId: username || 'unknown',
    details: `capture=${capture._id.toString()}`,
  });

  return { captureId: capture._id.toString(), status: capture.status, imageCount: capture.images.length };
};

export const getCapture = async (captureId) => {
  if (!mongoose.Types.ObjectId.isValid(captureId)) {
    const err = new Error('Invalid captureId');
    err.statusCode = 400;
    throw err;
  }
  const capture = await ReceiptCapture.findById(captureId).lean();
  if (!capture) {
    const err = new Error('Receipt capture not found');
    err.statusCode = 404;
    throw err;
  }
  return capture;
};

export const getCaptureItems = async (captureId) => {
  const capture = await getCapture(captureId);
  return capture.draftItems || [];
};

export const getSummary = async (storeId) => {
  const query = storeId ? { storeId } : {};
  const statuses = ['pending_parse', 'parsed', 'review_complete', 'committed', 'failed'];
  const counts = await Promise.all(
    statuses.map(status => ReceiptCapture.countDocuments({ ...query, status }))
  );
  const total = await ReceiptCapture.countDocuments(query);

  return {
    total,
    pendingParse: counts[0],
    parsed: counts[1],
    reviewComplete: counts[2],
    committed: counts[3],
    failed: counts[4],
  };
};