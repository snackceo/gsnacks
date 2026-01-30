import Store from '../models/Store.js';
import levenshtein from 'fast-levenshtein';

const normalizePhone = (phone = '') => phone.replace(/\D+/g, '');
const normalizeStoreNumber = (value = '') => String(value).replace(/\D+/g, '');
const normalizeZip = (zip = '') => {
  const match = String(zip).match(/\d{5}/);
  return match ? match[0] : '';
};
const normalizeStr = (str = '') => str.trim().toLowerCase();

const inferStoreType = name => {
  const normalized = normalizeStr(name);
  if (!normalized) return null;
  if (normalized.includes('walmart')) return 'walmart';
  if (normalized.includes('kroger')) return 'kroger';
  if (normalized.includes('aldi')) return 'aldi';
  if (normalized.includes('target')) return 'target';
  if (normalized.includes('meijer')) return 'meijer';
  return null;
};

const addressKey = (addr = {}) => {
  const street = normalizeStr(addr.street || addr.address || '');
  const city = normalizeStr(addr.city || '');
  const state = normalizeStr(addr.state || '');
  const zip = normalizeZip(addr.zip || '');
  return [street, city, state, zip].filter(Boolean).join('|');
};

const fuzzyMatch = (a, b) => {
  const aNorm = normalizeStr(a);
  const bNorm = normalizeStr(b);
  if (!aNorm || !bNorm) return 1; // high distance
  const dist = levenshtein.get(aNorm, bNorm);
  const maxLen = Math.max(aNorm.length, bNorm.length) || 1;
  return dist / maxLen; // normalized distance 0..1
};

export async function matchStoreCandidate(candidate, { nameThreshold = 0.25 } = {}) {
  if (!candidate) return { match: null, confidence: 0, reason: 'no candidate' };

  const phoneNorm = normalizePhone(candidate.phoneNormalized || candidate.phone);
  const storeNumberNorm = normalizeStoreNumber(candidate.storeNumber);
  const addrKey = addressKey(candidate.address || {});
  const zip = normalizeZip(candidate.address?.zip || '');
  const storeType = candidate.storeType || inferStoreType(candidate.name);

  // 1) Exact storeId
  if (candidate.storeId) {
    const store = await Store.findById(candidate.storeId).lean();
    if (store) return { match: store, confidence: 1, reason: 'explicit storeId' };
  }

  // 2) Store number match
  if (storeNumberNorm) {
    const store = await Store.findOne({ storeNumber: storeNumberNorm }).lean();
    if (store) return { match: store, confidence: 0.98, reason: 'store number match' };
  }

  // 3) Phone match (normalized equality)
  if (phoneNorm) {
    const store = await Store.findOne({ phoneNormalized: phoneNorm }).lean();
    if (store) return { match: store, confidence: 0.95, reason: 'phone match' };
  }

  // 4) Chain + zip match
  if (storeType && zip) {
    const store = await Store.findOne({ storeType, 'address.zip': zip }).lean();
    if (store) return { match: store, confidence: 0.9, reason: 'chain + zip match' };
  }

  // 5) Address match
  if (addrKey) {
    const stores = await Store.find({}).lean();
    const byAddr = stores.find(s => addressKey(s.address) && addressKey(s.address) === addrKey);
    if (byAddr) return { match: byAddr, confidence: 0.9, reason: 'address match' };
  }

  // 6) Fuzzy name + same city/zip
  if (candidate.name) {
    const stores = await Store.find({}).lean();
    const city = normalizeStr(candidate.address?.city || '');

    let best = null;
    let bestScore = 1;
    for (const s of stores) {
      if (city && normalizeStr(s.address?.city) !== city) continue;
      if (zip && normalizeZip(s.address?.zip) !== zip) continue;
      const score = fuzzyMatch(candidate.name, s.name);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best && bestScore <= nameThreshold) {
      return { match: best, confidence: 0.8, reason: 'fuzzy name with city/zip' };
    }
  }

  return { match: null, confidence: candidate.confidence || 0, reason: 'no match' };
}

export function shouldAutoCreateStore(candidate, { threshold = 0.85 } = {}) {
  if (!candidate) return false;
  const phoneNorm = normalizePhone(candidate.phoneNormalized || candidate.phone);
  const storeNumberNorm = normalizeStoreNumber(candidate.storeNumber);
  const zip = normalizeZip(candidate.address?.zip || '');
  const hasStreet = Boolean(normalizeStr(candidate.address?.street || candidate.address?.address || ''));
  if (storeNumberNorm || phoneNorm || (hasStreet && zip)) {
    return true;
  }
  const confidence = typeof candidate === 'number' ? candidate : candidate.confidence;
  return typeof confidence === 'number' ? confidence >= threshold : false;
}

export { inferStoreType, normalizePhone, normalizeStoreNumber, normalizeZip };
