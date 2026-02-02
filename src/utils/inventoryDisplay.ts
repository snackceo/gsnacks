import type { StoreInventoryEntry } from '../types';

export const getInventoryDisplay = (entry: StoreInventoryEntry) => {
  const name =
    entry.productId?.name ||
    entry.unmappedProductId?.rawName ||
    entry.unmappedProductId?.normalizedName ||
    'Unknown item';
  const sku = entry.productId?.sku ?? '—';
  const upc = entry.productId?.upc ?? '—';
  const price = entry.observedPrice ?? entry.cost ?? null;
  const source = Number.isFinite(entry.observedPrice)
    ? 'Observed'
    : Number.isFinite(entry.cost)
      ? 'Cost'
      : '—';

  return { name, sku, upc, price, source };
};
