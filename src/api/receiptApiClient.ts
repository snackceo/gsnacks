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

export const RECEIPT_API_ENDPOINTS = {
  uploadReceiptImage: '/api/driver/upload-receipt-image',
  createCapture: '/api/driver/receipt-capture',
  triggerParse: '/api/driver/receipt-parse',
  getCapture: (captureId: string) => `/api/driver/receipt-capture/${captureId}`,
  getCaptureItems: (captureId: string) => `/api/driver/receipt-capture/${captureId}/items`,
  listJobs: '/api/receipts',
  receiptHealth: '/api/driver/receipt-health',
  resetReview: '/api/driver/receipt-reset-review',
  lockCapture: '/api/driver/receipt-lock',
  unlockCapture: '/api/driver/receipt-unlock',
  approveJob: (jobId: string) => `/api/receipts/${jobId}/approve`,
  rejectJob: (jobId: string) => `/api/receipts/${jobId}/reject`,
  confirmMatch: '/api/driver/receipt-confirm-match',
  captureSummary: '/api/driver/receipt-captures-summary',
  /**
   * @deprecated Legacy endpoint name retained for compatibility.
   * Sunset plan: remove this client alias after all receipt ingestion UIs
   * migrate to approval-only flow and after 2026-09-30.
   */
  priceUpdateManual: '/api/driver/receipt-price-update-manual'
} as const;

export const receiptApiClient = {
  uploadReceiptImage(body: { image: string; mime?: string; storeId?: string }) {
    return apiFetch<{ url: string; thumbnailUrl?: string }>(RECEIPT_API_ENDPOINTS.uploadReceiptImage, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  createCapture(body: Record<string, unknown>) {
    return apiFetch<{ captureId: string }>(RECEIPT_API_ENDPOINTS.createCapture, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  triggerParse(captureId: string) {
    return apiFetch<{ queued?: boolean; warning?: string; items?: any[] }>(RECEIPT_API_ENDPOINTS.triggerParse, {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  getCapture(captureId: string) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.getCapture(captureId));
  },
  getCaptureItems(captureId: string, signal?: AbortSignal) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.getCaptureItems(captureId), { signal });
  },
  listJobs(statuses: string) {
    return apiFetch<{ jobs?: ReceiptParseJob[] }>(
      `${RECEIPT_API_ENDPOINTS.listJobs}?status=${encodeURIComponent(statuses)}`
    );
  },
  listJobsWithLimit(limit: number) {
    return apiFetch<{ jobs?: ReceiptParseJob[]; error?: string }>(
      `${RECEIPT_API_ENDPOINTS.listJobs}?limit=${encodeURIComponent(String(limit))}`
    );
  },
  getHealth(storeId?: string) {
    const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
    return apiFetch<any>(`${RECEIPT_API_ENDPOINTS.receiptHealth}${q}`);
  },
  resetReview(captureId: string) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.resetReview, {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  lockCapture(captureId: string, lockDurationDays: number) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.lockCapture, {
      method: 'POST',
      body: JSON.stringify({ captureId, lockDurationDays })
    });
  },
  unlockCapture(captureId: string) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.unlockCapture, {
      method: 'POST',
      body: JSON.stringify({ captureId })
    });
  },
  approveJob(jobId: string, payload: ReceiptApprovePayload) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.approveJob(jobId), {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  rejectJob(jobId: string) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.rejectJob(jobId), { method: 'POST' });
  },
  confirmMatch(body: { receiptName: string; sku: string; storeId?: string }) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.confirmMatch, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  getCaptureSummary() {
    return apiFetch<{ summary?: any }>(RECEIPT_API_ENDPOINTS.captureSummary);
  },
  submitPriceUpdateManual(body: Record<string, unknown>) {
    return apiFetch<any>(RECEIPT_API_ENDPOINTS.priceUpdateManual, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }
};
