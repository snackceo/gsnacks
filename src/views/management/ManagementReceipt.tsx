import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onReceiptCaptureDeleted } from '../../services/socketService';
import {
  Camera,
  Loader2,
  CheckCircle2,
  ChevronDown,
  AlertCircle
} from 'lucide-react';
import {
  StoreRecord
} from '../../types';
import { BACKEND_URL } from '../../constants';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';

interface ManagementReceiptProps {
  fmtTime: (iso?: string) => string;
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoadingStores: boolean;
  storeError: string | null;
  setStoreError: (error: string | null) => void;
}

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
}

interface ItemMatch {
  rawLine: string;
  nameCandidate: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  actionSuggestion: 'LINK_UPC_TO_PRODUCT' | 'CREATE_UPC' | 'CREATE_PRODUCT' | 'IGNORE';
  warnings?: string[];
  match?: {
    productId?: string;
    confidence?: number;
    reason?: string;
  };
}

interface ReceiptParseJob {
  _id: string;
  captureId: string;
  status: 'QUEUED' | 'PARSED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  storeCandidate?: {
    name: string;
    address?: any;
    phone?: string;
    storeType?: string;
    confidence?: number;
    storeId?: string;
  };
  items?: ItemMatch[];
  warnings?: string[];
}

/**
 * Receipt Management Tab
 * Handles:
 * - Receipt capture & upload
 * - Receipt parse jobs review & approval
 */
const ManagementReceipt: React.FC<ManagementReceiptProps> = ({
  fmtTime,
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoadingStores,
  storeError,
  setStoreError
}) => {
  const { addToast } = useNinpoCore();
  const [receiptFlow, setReceiptFlow] = useState<'capture' | 'pending'>('capture');
  
  // Capture state
  const [isReceiptFlowOpen, setIsReceiptFlowOpen] = useState(false);

  const [parseJobs, setParseJobs] = useState<ReceiptParseJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ReceiptParseJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Load pending parse jobs
  const loadParseJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    setJobsError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/receipts/?status=NEEDS_REVIEW`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to load parse jobs');
      const data = await res.json();
      setParseJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (err: any) {
      setJobsError(err?.message || 'Failed to load parse jobs');
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (receiptFlow === 'pending') {
      loadParseJobs();
    }
  }, [receiptFlow, loadParseJobs]);

  // Real-time: Remove deleted receipt parse jobs instantly
  useEffect(() => {
    const unsub = onReceiptCaptureDeleted(({ captureId }) => {
      setParseJobs(prev => prev.filter(j => j.captureId !== captureId));
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const handleReceiptCaptured = useCallback((captureId: string) => {
    addToast('Receipt captured & parsing started', 'success');
    setIsReceiptFlowOpen(false);
    setReceiptFlow('pending');
  }, [addToast]);

  const handleApproveParseJob = useCallback(async (jobId: string, mode: 'safe' | 'all' | 'selected' | 'locked' = 'safe') => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/receipts/${jobId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode })
      });
      if (!res.ok) throw new Error('Failed to approve parse job');
      addToast('Parse job approved', 'success');
      setParseJobs(prev => prev.filter(j => j._id !== jobId));
      setSelectedJob(null);
    } catch (err: any) {
      addToast(err?.message || 'Failed to approve job', 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [addToast]);

  const handleRejectParseJob = useCallback(async (jobId: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/receipts/${jobId}/reject`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to reject parse job');
      addToast('Parse job rejected', 'success');
      setParseJobs(prev => prev.filter(j => j._id !== jobId));
      setSelectedJob(null);
    } catch (err: any) {
      addToast(err?.message || 'Failed to reject job', 'error');
    } finally {
      setIsProcessing(false);
    }
  }, [addToast]);

  // Tab content
  const tabContent = useMemo(() => {
    if (receiptFlow === 'capture') {
      // Only one entry point for receipt capture: Open scanner overlay
      return (
        <div className="space-y-6">
          <button
            onClick={() => setIsReceiptFlowOpen(true)}
            className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-colors"
          >
            Capture or Upload Receipt
          </button>
          <ReceiptCaptureFlow
            stores={stores}
            isOpen={isReceiptFlowOpen}
            onReceiptCreated={handleReceiptCaptured}
            onCancel={() => setIsReceiptFlowOpen(false)}
          />
        </div>
      );
    }

    if (receiptFlow === 'pending') {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-black uppercase tracking-widest flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-ninpo-lime" /> Pending Parse Jobs ({parseJobs.length})
            </h3>
            <button
              onClick={loadParseJobs}
              disabled={isLoadingJobs}
              className="px-4 py-2 bg-white/10 text-white rounded-lg text-[10px] font-bold hover:bg-white/20 transition disabled:opacity-50"
            >
              {isLoadingJobs ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
            </button>
          </div>

          {jobsError && (
            <div className="bg-red-900/20 border border-red-600 rounded-xl p-4 text-red-300 text-[11px]">
              {jobsError}
            </div>
          )}

          {isLoadingJobs ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-ninpo-lime" />
            </div>
          ) : parseJobs.length === 0 ? (
            <div className="bg-ninpo-card border border-white/10 rounded-2xl p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-ninpo-lime mx-auto mb-3 opacity-50" />
              <p className="text-white font-black uppercase text-sm">No pending jobs</p>
              <p className="text-[11px] text-slate-400 mt-2">All receipts have been reviewed</p>
            </div>
          ) : (
            <div className="space-y-3">
              {parseJobs.map(job => (
                <div
                  key={job._id}
                  className="bg-ninpo-card border border-white/10 rounded-2xl p-4 cursor-pointer hover:border-ninpo-lime/50 transition"
                  onClick={() => setSelectedJob(selectedJob?._id === job._id ? null : job)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-bold text-sm">{job.storeCandidate?.name || 'Unknown Store'}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{job.items?.length || 0} items • {fmtTime(job.createdAt)}</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition ${selectedJob?._id === job._id ? 'rotate-180' : ''}`} />
                  </div>

                  {selectedJob?._id === job._id && (
                    <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Items to Review:</p>
                        {job.items?.map((item, idx) => (
                          <div key={idx} className="text-[10px] bg-black/30 rounded p-2">
                            <p className="text-white">{item.nameCandidate}</p>
                            <p className="text-slate-400">${item.lineTotal.toFixed(2)} × {item.quantity}</p>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleApproveParseJob(job._id, 'safe');
                          }}
                          disabled={isProcessing}
                          className="flex-1 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold text-[10px] hover:bg-white transition disabled:opacity-50"
                        >
                          Approve (Safe)
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleRejectParseJob(job._id);
                          }}
                          disabled={isProcessing}
                          className="flex-1 py-2 bg-ninpo-red/20 text-ninpo-red rounded-lg font-bold text-[10px] hover:bg-ninpo-red/30 transition disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
  }, [receiptFlow, isReceiptFlowOpen, stores, fmtTime, parseJobs, isLoadingJobs, jobsError, selectedJob, isProcessing, handleReceiptCaptured, loadParseJobs, handleApproveParseJob, handleRejectParseJob]);

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10">
        {[
          { id: 'capture', label: 'Capture' },
          { id: 'pending', label: `Pending (${parseJobs.length})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setReceiptFlow(tab.id as any)}
            className={`px-4 py-3 text-[11px] font-black uppercase tracking-widest border-b-2 transition ${
              receiptFlow === tab.id
                ? 'border-ninpo-lime text-ninpo-lime'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tabContent}
    </div>
  );
};

export default ManagementReceipt;
