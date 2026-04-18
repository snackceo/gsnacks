import React, { useState, useEffect } from 'react';
import { receiptApiClient } from '../api/receiptApiClient';
import { ReceiptParseJob } from '../types';
import { useReceiptJobStatus } from '../hooks/useReceiptJobStatus';
import ReceiptItemBucket from './ReceiptItemBucket';

interface JobRowProps {
  initialJob: ReceiptParseJob;
  onReview: (job: ReceiptParseJob) => void;
}

const JobRow: React.FC<JobRowProps> = ({ initialJob, onReview }) => {
  const { job, isPolling } = useReceiptJobStatus(initialJob._id, initialJob);

  const status = job?.status || initialJob.status;

  return (
    <div className="grid grid-cols-4 items-center gap-4 p-3 bg-white/5 rounded-lg">
      <div className="truncate text-xs font-mono">{job?._id || initialJob._id}</div>
      <div className="truncate text-xs font-mono">{job?.captureId || initialJob.captureId}</div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-1 text-xs rounded-full ${isPolling ? 'bg-blue-500/20 text-blue-300 animate-pulse' : 'bg-gray-500/20 text-gray-300'}`}>
          {status}
        </span>
      </div>
      <div>
        <button
          onClick={() => job && onReview(job)}
          disabled={status !== 'PARSED' && status !== 'NEEDS_REVIEW'}
          className="px-3 py-1 text-sm rounded-md bg-ninpo-lime text-ninpo-black font-bold disabled:opacity-40"
        >
          Review
        </button>
      </div>
    </div>
  );
};

export const ManagementReceiptsView: React.FC = () => {
  const [jobs, setJobs] = useState<ReceiptParseJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<ReceiptParseJob | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setIsLoading(true);
        // Fetch jobs that are ready for review
        const { jobs: pendingJobs } = await receiptApiClient.listJobs('NEEDS_REVIEW');
        const { jobs: parsedJobs } = await receiptApiClient.listJobs('PARSED');
        setJobs([...pendingJobs, ...parsedJobs]);
      } catch (error) {
        console.error("Failed to fetch receipt jobs", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobs();
  }, []);

  if (isLoading) {
    return <div>Loading pending receipts...</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Receipt Review Queue</h1>
      <div className="space-y-2">
        {jobs.map(job => (
          <JobRow key={job._id} initialJob={job} onReview={setSelectedJob} />
        ))}
      </div>
      {jobs.length === 0 && <p className="text-slate-500">No receipts are currently pending review.</p>}

      {selectedJob && (
        <ReceiptItemBucket
          items={(selectedJob as any).result?.items ?? []}
          isReadOnly={false}
        />
      )}
    </div>
  );
};

export default ManagementReceiptsView;