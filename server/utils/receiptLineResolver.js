import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';
import { getCanonicalReceiptNormalizedName } from './receiptNameNormalization.js';

export const getReceiptLineNormalizedName = value => getCanonicalReceiptNormalizedName(value);

export const normalizeReceiptLineUpc = value => {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length < 8 || digits.length > 14) return '';
  return digits;
};

const resolveProductViaUpcMapping = async ({ upc, session }) => {
  const normalizedUpc = normalizeReceiptLineUpc(upc);
  if (!normalizedUpc) return null;
  const query = UpcItem.findOne({ upc: normalizedUpc });
  if (session) query.session(session);
  const upcEntry = await query;
  if (!upcEntry?.productId) return null;
  const productQuery = Product.findById(upcEntry.productId);
  if (session) productQuery.session(session);
  const product = await productQuery;
  if (!product) return null;
  return { product, normalizedUpc, matchMethod: 'upc' };
};

const resolveProductViaNormalizedName = async ({ normalizedName, session }) => {
  const canonicalName = getReceiptLineNormalizedName(normalizedName);
  if (!canonicalName) return null;
  const query = Product.findOne({ normalizedName: canonicalName });
  if (session) query.session(session);
  const product = await query;
  if (!product) return null;
  return { product, normalizedName: canonicalName, matchMethod: 'normalized_name' };
};

export const resolveReceiptLineProduct = async ({
  line,
  normalizedName,
  upc,
  session,
  fallback = 'unmapped',
  createProductStub
} = {}) => {
  const lineName = normalizedName || line?.normalizedName || line?.receiptName || line?.nameCandidate || line;
  const canonicalName = getReceiptLineNormalizedName(lineName);
  const lineUpc = upc || line?.upc || line?.boundUpc || line?.upcCandidate || line?.barcode;

  const byUpc = await resolveProductViaUpcMapping({ upc: lineUpc, session });
  if (byUpc) {
    return {
      product: byUpc.product,
      normalizedName: canonicalName,
      normalizedUpc: byUpc.normalizedUpc,
      resolution: 'upc',
      matchMethod: byUpc.matchMethod
    };
  }

  const byName = await resolveProductViaNormalizedName({ normalizedName: canonicalName, session });
  if (byName) {
    return {
      product: byName.product,
      normalizedName: byName.normalizedName,
      normalizedUpc: normalizeReceiptLineUpc(lineUpc),
      resolution: 'normalized_name',
      matchMethod: byName.matchMethod
    };
  }

  if (fallback === 'stub' && typeof createProductStub === 'function') {
    const product = await createProductStub({
      normalizedName: canonicalName,
      rawName: line?.receiptName || lineName
    });
    if (product) {
      return {
        product,
        normalizedName: canonicalName,
        normalizedUpc: normalizeReceiptLineUpc(lineUpc),
        resolution: 'stub',
        matchMethod: 'stub'
      };
    }
  }

  return {
    product: null,
    normalizedName: canonicalName,
    normalizedUpc: normalizeReceiptLineUpc(lineUpc),
    resolution: 'unmapped',
    matchMethod: 'unmapped'
  };
};
