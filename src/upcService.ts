import { apiFetch } from './apiFetch';
import { Product } from '../types';

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