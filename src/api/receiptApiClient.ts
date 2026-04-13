import { apiFetch } from '../utils/apiFetch';
import { ReceiptApprovalDraft, ReceiptParseJob } from '../types';

/**
 * Canonical receipt lifecycle contract (GEMINI invariant):
 * 1) capture/upload
 * 2) immediate parse trigger
 * 3) poll parse job status
 * 4) approve or reject
 */

export type ReceiptParseUiStatus = 'queued' | 'parsing' | 'ready_for_review' | 'failed' | 'completed';

export const getReceiptParseUiStatus = (status?: string): ReceiptParseUiStatus => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'CREATED' || normalized === 'QUEUED') return 'queued';
  if (normalized === 'PARSING') return 'parsing';
  if (normalized === 'FAILED' || normalized === 'REJECTED') return 'failed';
  if (normalized === 'APPROVED') return 'completed';
  return 'ready_for_review';
};

export interface ReceiptApprovePayload {
  mode: 'safe' | 'selected' | 'locked' | 'all';
  approvalDraft: ReceiptApprovalDraft;
  selectedIndices?: number[];
  lockDurationDays?: number;
  idempotencyKey?: string;
  forceUpcOverride?: boolean;
  ignorePriceLocks?: boolean;
  finalStoreId?: string;
  storeCandidate?: ReceiptApprovalDraft['storeCandidate'];
  confirmStoreCreate?: boolean;
  approvalNotes?: string;
}

export const receiptApiClient = {
  uploadReceiptImage(body: { image: string; mime?: string; storeId?: string }) {
    return apiFetch<{ url: string; thumbnailUrl?: string }>('/api/driver/upload-receipt-image', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  createCapture(body: Record<string, unknown>) {
    return apiFetch<{ captureId: string }>('/api/driver/receipt-capture', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  triggerParse(captureId: string) {
    return apiFetch<{ queued?: boolean; warning?: string; items?: any[] }>('/api/driver/receipt-parse', {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  getCapture(captureId: string) {
    return apiFetch<any>(`/api/driver/receipt-capture/${captureId}`);
  },
  getCaptureItems(captureId: string, signal?: AbortSignal) {
    return apiFetch<any>(`/api/driver/receipt-capture/${captureId}/items`, { signal });
  },
  listJobs(statuses: string) {
    return apiFetch<{ jobs?: ReceiptParseJob[] }>('/api/receipts/?status=' + encodeURIComponent(statuses));
  },
  getHealth(storeId?: string) {
    const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
    return apiFetch<any>(`/api/driver/receipt-health${q}`);
  },
  resetReview(captureId: string) {
    return apiFetch<any>('/api/driver/receipt-reset-review', {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  lockCapture(captureId: string, lockDurationDays: number) {
    return apiFetch<any>('/api/driver/receipt-lock', {
      method: 'POST',
      body: JSON.stringify({ captureId, lockDurationDays })
    });
  },
  unlockCapture(captureId: string) {
    return apiFetch<any>('/api/driver/receipt-unlock', {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  approveJob(jobId: string, payload: ReceiptApprovePayload) {
    return apiFetch<any>(`/api/receipts/${jobId}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  rejectJob(jobId: string) {
    return apiFetch<any>(`/api/receipts/${jobId}/reject`, { method: 'POST' });
  },
  confirmMatch(body: { receiptName: string; sku: string; storeId?: string }) {
    return apiFetch<any>('/api/driver/receipt-confirm-match', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }
};

