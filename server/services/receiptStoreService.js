import Store from '../../models/Store.js';
import { isDbReady } from '../../db/connect.js';
import { recordAuditLog } from '../../utils/audit.js';
import { shouldAutoCreateStore, normalizePhone, normalizeStoreNumber } from '../../utils/storeMatcher.js';
import { sanitizeSearch } from './receiptValidationService.js';

const checkDb = () => {
  if (!isDbReady()) {
    const error = new Error('Database not ready');
    error.statusCode = 503;
    throw error;
  }
};

export const findStoreCandidates = async (searchQuery) => {
  checkDb();
  const safeQuery = sanitizeSearch(searchQuery);
  if (!safeQuery) {
    const error = new Error('Search query required');
    error.statusCode = 400;
    throw error;
  }

  return Store.find({ name: { $regex: safeQuery, $options: 'i' } })
    .select('name address phone storeType')
    .limit(20)
    .lean();
};

export const createStoreCandidate = async ({ storeData, actor }) => {
  checkDb();
  const { storeName, address, phone, storeType, storeNumber } = storeData;

  if (!storeName) {
    const error = new Error('Store name required');
    error.statusCode = 400;
    throw error;
  }

  const existing = await Store.findOne({ name: storeName }).lean();
  if (existing) {
    return { existing };
  }

  const creationData = { name: storeName, address, phone, phoneNormalized: normalizePhone(phone), storeNumber: normalizeStoreNumber(storeNumber), storeType };
  if (!shouldAutoCreateStore(creationData)) {
    const error = new Error('Auto store creation disabled for this candidate');
    error.statusCode = 403;
    throw error;
  }

  const store = await Store.create(creationData);

  await recordAuditLog({
    type: 'receipt_store_create',
    actorId: actor,
    details: `storeName=${storeName}`,
  });

  return { store };
};