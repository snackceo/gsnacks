import { apiFetch } from './apiFetch';
import { Product, UpcItem } from './types';

interface UpcScanResponse {
  ok: boolean;
  action: 'resolved' | 'unmapped' | 'updated';
  product?: Product;
  upc?: string;
}

export const lookupUpc = (upc: string): Promise<UpcScanResponse> => {
  return apiFetch('/api/upc/scan', {
    method: 'POST',
    body: JSON.stringify({ upc, resolveOnly: true }),
  });
};

export const getWhitelist = (): Promise<{ ok: boolean; upcs: string[] }> => {
  // This endpoint corresponds to the `getUpcItems` controller function,
  // which we previously updated to return the whitelist.
  // The route is assumed to be `/api/upc/items`.
  return apiFetch('/api/upc/items');
};

export const addUpcToWhitelist = (upc: string): Promise<{ ok: boolean; upcItem: UpcItem }> => {
  // This corresponds to the `upsertUpcItem` controller function.
  // We are assuming the router maps POST /api/upc/items to it.
  return apiFetch('/api/upc/items', {
    method: 'POST',
    body: JSON.stringify({ upc, isEligible: true }),
  });
};

export const removeUpcFromWhitelist = (upc: string): Promise<{ ok: boolean }> => {
  // This corresponds to a controller function that handles deleting a UPC item.
  // We are assuming the router maps DELETE /api/upc/items/:upc to it.
  return apiFetch(`/api/upc/items/${upc}`, {
    method: 'DELETE',
  });
};