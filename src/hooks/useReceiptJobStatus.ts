import { useState, useEffect, useRef } from 'react';
import { receiptApiClient } from '../api/receiptApiClient';
import { ReceiptParseJob, ReceiptParseStatus } from '../types';

const TERMINAL_STATUSES: ReceiptParseStatus[] = ['APPROVED', 'REJECTED', 'FAILED'];
const POLLING_INTERVAL_MS = 2000; // 2 seconds
const POLLING_TIMEOUT_MS = 60000; // 60 seconds

export const useReceiptJobStatus = (jobId: string | null, initialJob?: ReceiptParseJob | null) => {
  const [job, setJob] = useState<ReceiptParseJob | null>(initialJob || null);
  const [isPolling, setIsPolling] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const stopPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      intervalRef.current = null;
      timeoutRef.current = null;
      setIsPolling(false);
    };

    if (jobId && (!job?.status || !TERMINAL_STATUSES.includes(job.status))) {
      setIsPolling(true);
      setIsTimedOut(false);

      intervalRef.current = setInterval(async () => {
        try {
          const { job: updatedJob } = await receiptApiClient.getJob(jobId);
          setJob(updatedJob);
          if (TERMINAL_STATUSES.includes(updatedJob.status)) stopPolling();
        } catch (error) {
          console.error(`Failed to poll job status for ${jobId}`, error);
          stopPolling();
        }
      }, POLLING_INTERVAL_MS);

      timeoutRef.current = setTimeout(() => {
        setIsTimedOut(true);
        stopPolling();
      }, POLLING_TIMEOUT_MS);
    }

    return stopPolling;
  }, [jobId, job?.status]);

  return { job, isPolling, isTimedOut };
};