import Store from '../models/Store.js';
import levenshtein from 'fast-levenshtein';

const normalizePhone = (phone = '') => phone.replace(/\D+/g, '');
const normalizeStr = (str = '') => str.trim().toLowerCase();

const addressKey = (addr = {}) => {
  const street = normalizeStr(addr.street || addr.address || '');
  const city = normalizeStr(addr.city || '');
  const state = normalizeStr(addr.state || '');
  const zip = normalizeStr(addr.zip || '');
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

  const phoneNorm = normalizePhone(candidate.phone);
  const addrKey = addressKey(candidate.address || {});

  // 1) Exact storeId
  if (candidate.storeId) {
    const store = await Store.findById(candidate.storeId).lean();
    if (store) return { match: store, confidence: 1, reason: 'explicit storeId' };
  }

  // 2) Phone match
  if (phoneNorm) {
    const store = await Store.findOne({ phone: { $regex: phoneNorm, $options: 'i' } }).lean();
    if (store) return { match: store, confidence: 0.95, reason: 'phone match' };
  }

  // 3) Address match
  if (addrKey) {
    const stores = await Store.find({}).lean();
    const byAddr = stores.find(s => addressKey(s.address) && addressKey(s.address) === addrKey);
    if (byAddr) return { match: byAddr, confidence: 0.9, reason: 'address match' };
  }

  // 4) Fuzzy name + same city/zip
  if (candidate.name) {
    const stores = await Store.find({}).lean();
    const city = normalizeStr(candidate.address?.city || '');
    const zip = normalizeStr(candidate.address?.zip || '');

    let best = null;
    let bestScore = 1;
    for (const s of stores) {
      if (city && normalizeStr(s.address?.city) !== city) continue;
      if (zip && normalizeStr(s.address?.zip) !== zip) continue;
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

export function shouldAutoCreateStore(confidence, threshold = 0.85) {
  return confidence >= threshold;
}
