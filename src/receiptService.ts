import { apiFetch } from './apiFetch';
import { ReceiptCapture, ReceiptParseJob } from '../types';

interface CapturePayload {
  images: { url: string; thumbnailUrl?: string }[];
  storeId?: string;
  captureRequestId: string;
}

interface CaptureResponse {
  captureId: string;
  status: string;
}

export const createCapture = (payload: CapturePayload): Promise<CaptureResponse> => {
  return apiFetch('/api/driver/receipt-capture', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const triggerParse = (captureId: string): Promise<{ ok: boolean; job: ReceiptParseJob }> => {
  return apiFetch('/api/driver/receipt-parse', {
    method: 'POST',
    body: JSON.stringify({ captureId }),
  });
};