import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';

/**
 * Resolves a UPC to a Product following the UPC -> SKU -> Product chain.
 *
 * @param {string} upc - The UPC to resolve.
 * @returns {Promise<{product: object|null, upcEntry: object|null, action: string}>}
 */
export const resolveUpc = async (upc) => {
  if (!upc) {
    return { product: null, upcEntry: null, action: 'error_invalid_upc' };
  }

  const upcEntry = await UpcItem.findOne({ upc }).lean();

  if (!upcEntry) {
    return { product: null, upcEntry: null, action: 'unmapped' };
  }

  if (!upcEntry.sku) {
    return { product: null, upcEntry, action: 'unmapped' };
  }

  const product = await Product.findOne({ sku: upcEntry.sku }).lean();

  if (!product) {
    // This indicates a data integrity issue: a UPC is mapped to a non-existent SKU.
    return { product: null, upcEntry, action: 'integrity_error_product_not_found' };
  }

  return { product, upcEntry, action: 'resolved' };
};

export const isValidBarcode = (value) => {
  if (!value) return false;
  const cleaned = String(value).replace(/\D/g, '');
  return cleaned.length >= 8 && cleaned.length <= 14;
};