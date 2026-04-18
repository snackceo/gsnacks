import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { createCapture, triggerParse } from '../receiptService';
import { ReceiptParseJob } from '../types';

interface UseReceiptParse {
  isLoading: boolean;
  error: string | null;
  captureId: string | null;
  job: ReceiptParseJob | null;
  startReceiptFlow: (images: { url: string; thumbnailUrl?: string }[], storeId?: string) => Promise<void>;
}

export const useReceiptParse = (): UseReceiptParse => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [job, setJob] = useState<ReceiptParseJob | null>(null);

  const startReceiptFlow = async (images: { url: string; thumbnailUrl?: string }[], storeId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const captureRequestId = uuidv4();
      const captureResponse = await createCapture({ images, storeId, captureRequestId });
      setCaptureId(captureResponse.captureId);

      const parseResponse = await triggerParse(captureResponse.captureId);
      setJob(parseResponse.job);
    } catch (err: any) {
      setError(err.message || 'An unknown error occurred during the receipt flow.');
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, error, captureId, job, startReceiptFlow };
};