import { useState, useCallback, useEffect } from 'react';
import { BACKEND_URL } from '../constants';

interface ReceiptCapture {
  _id: string;
  storeId?: string;
  storeName?: string;
  orderId?: string;
  status: string;
  imageCount: number;
  stats: {
    totalItems: number;
    itemsNeedingReview: number;
    itemsConfirmed: number;
    itemsCommitted: number;
  };
  workflowStats?: {
    newProducts?: number;
    priceUpdates?: number;
  };
  createdByUserId?: string;
  createdByRole?: string;
  source?: string;
  createdAt: string;
  reviewExpiresAt?: string;
}

export const useReceiptCapture = () => {
  const [receiptCaptures, setReceiptCaptures] = useState<ReceiptCapture[]>([]);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const fetchReceiptCaptures = useCallback(async () => {
    try {
      const resp = await fetch(
        `${BACKEND_URL}/api/receipts?status=QUEUED&status=PARSING&status=PARSED&status=NEEDS_REVIEW&status=APPROVED&status=REJECTED&status=FAILED&limit=40`,
        {
          credentials: 'include'
        }
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load receipt queue');
      }
      const data = await resp.json().catch(() => ({}));
      // The backend returns { ok: true, jobs: [...] }
      const captures = Array.isArray(data.jobs) ? data.jobs : [];
      setReceiptCaptures(captures);
      setReceiptError(null);
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to load receipt queue');
    }
  }, []);

  const handleReceiptQueueRefreshEvent = useCallback(() => {
    void fetchReceiptCaptures();
  }, [fetchReceiptCaptures]);

  // Initial fetch
  useEffect(() => {
    void fetchReceiptCaptures();
  }, [fetchReceiptCaptures]);

  // Event listener for queue refresh
  useEffect(() => {
    window.addEventListener('receipt-queue-refresh', handleReceiptQueueRefreshEvent);
    return () => window.removeEventListener('receipt-queue-refresh', handleReceiptQueueRefreshEvent);
  }, [handleReceiptQueueRefreshEvent]);

  // Auto-refresh interval
  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchReceiptCaptures();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [fetchReceiptCaptures]);

  return {
    receiptCaptures,
    setReceiptCaptures,
    receiptError,
    setReceiptError,
    refreshReceiptCaptures: fetchReceiptCaptures
  };
};
