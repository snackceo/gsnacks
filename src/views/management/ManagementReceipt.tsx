import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReceiptReviewPanel from './receipt/ReceiptReviewPanel';
import { classifyItems } from '../../utils/classificationUtils';
import { getReceiptItemKey } from '../../utils/receiptHelpers';
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

type ReceiptApprovalMode = 'safe' | 'selected' | 'locked' | 'all';

const createIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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

  // Receipt review state (moved from Pricing Intelligence)
  const [activeReceiptCaptureId, setActiveReceiptCaptureId] = useState<string | null>(null);
  const [classifiedItems, setClassifiedItems] = useState<any[]>([]);
  const [approvalMode, setApprovalMode] = useState<ReceiptApprovalMode>('safe');
  const [forceUpcOverride, setForceUpcOverride] = useState(false);
  const [confirmStoreCreate, setConfirmStoreCreate] = useState(false);
  const [finalStoreId, setFinalStoreId] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey());
  const [selectedItemsForCommit, setSelectedItemsForCommit] = useState<Map<string, boolean>>(new Map());
  const [isCommitting, setIsCommitting] = useState(false);
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [lockDurationDays, setLockDurationDays] = useState(7); // Or get from settings if available
  const [settings] = useState<any>({}); // Placeholder for settings if needed

  // --- Receipt Review Handlers (ported from Pricing Intelligence) ---
  const handleParse = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to parse receipt');
      }
      addToast('Receipt parsing started.', 'success');
      // Optionally reload jobs or state here
    } catch (err: any) {
      addToast(err?.message || 'Failed to parse receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast]);

  const handleConfirmAll = useCallback(() => {
    // Mark all items as confirmed (example logic)
    setSelectedItemsForCommit(new Map(classifiedItems.map(item => [getReceiptItemKey(item), true])));
    addToast('All items selected for commit.', 'info');
  }, [classifiedItems, addToast]);

  const handleResetReview = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-reset-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) throw new Error('Failed to reset review');
      setSelectedItemsForCommit(new Map());
      setApprovalMode('safe');
      addToast('Review reset.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to reset review', 'error');
    }
  }, [activeReceiptCaptureId, addToast]);

  const handleLock = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          lockDurationDays
        })
      });
      if (!resp.ok) throw new Error('Failed to lock receipt');
      addToast(`Receipt locked for ${lockDurationDays} days.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to lock receipt', 'error');
    }
  }, [activeReceiptCaptureId, lockDurationDays, addToast]);

  const handleUnlock = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) throw new Error('Failed to unlock receipt');
      addToast('Receipt unlocked.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to unlock receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast]);

  const handleCommit = useCallback(async () => {
    if (!selectedJob) return;
    if (!activeReceiptCaptureId || !approvalMode) return;
    setIsCommitting(true);
    try {
      const selectedIndices = classifiedItems
        .filter(item => selectedItemsForCommit.get(getReceiptItemKey(item)))
        .map(item => item.lineIndex)
        .filter((lineIndex): lineIndex is number => typeof lineIndex === 'number');

      if (approvalMode === 'selected' && selectedIndices.length === 0) {
        addToast('Select at least one item for selected mode.', 'error');
        setIsCommitting(false);
        return;
      }

      const resp = await fetch(`${BACKEND_URL}/api/receipts/${selectedJob._id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: approvalMode,
          selectedIndices: approvalMode === 'selected' ? selectedIndices : undefined,
          lockDurationDays,
          idempotencyKey,
          forceUpcOverride,
          finalStoreId: finalStoreId || undefined,
          storeCandidate: selectedJob.storeCandidate,
          confirmStoreCreate
        })
      });
      if (!resp.ok) throw new Error('Failed to commit items');
      addToast('Items committed.', 'success');
      setShowReceiptReview(false);
      setSelectedJob(null);
      setParseJobs(prev => prev.filter(job => job._id !== selectedJob._id));
    } catch (err: any) {
      addToast(err?.message || 'Failed to commit items', 'error');
    } finally {
      setIsCommitting(false);
    }
  }, [
    selectedJob,
    activeReceiptCaptureId,
    approvalMode,
    classifiedItems,
    selectedItemsForCommit,
    lockDurationDays,
    idempotencyKey,
    forceUpcOverride,
    finalStoreId,
    confirmStoreCreate,
    addToast
  ]);

  const handleScanItem = useCallback((_item: any) => {
    setScanModalOpen(true);
  }, []);

  const handleSearchProduct = useCallback((item: any) => {
    addToast('Product search not yet implemented.', 'info');
    // Implement product search logic if needed
  }, [addToast]);

  const handleCreateProduct = useCallback((item: any) => {
    addToast('Product creation not yet implemented.', 'info');
    // Implement create product logic if needed
  }, [addToast]);

  const handleAddNoiseRule = useCallback((normalizedName: string) => {
    addToast(`Noise rule added for: ${normalizedName}`, 'info');
    // Implement noise rule logic if needed
  }, [addToast]);

  const handleScannerScan = useCallback((upc: string) => {
    addToast(`Scanned UPC: ${upc}`, 'info');
    setScanModalOpen(false);
  }, [addToast]);

  const handleScannerClose = useCallback(() => {
    setScanModalOpen(false);
  }, []);

  const loadCaptureItems = useCallback(async (captureId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}/items`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to load receipt items');
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const { items: classified } = classifyItems(items);
      setClassifiedItems(classified);
      const updated = new Map<string, boolean>();
      classified
        .filter(item => item.classification === 'A')
        .forEach(item => {
          updated.set(getReceiptItemKey(item), true);
        });
      setSelectedItemsForCommit(updated);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load receipt items', 'error');
      setClassifiedItems([]);
    }
  }, [addToast]);

  // Load pending parse jobs
  const loadParseJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    setJobsError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/receipts/?status=NEEDS_REVIEW,PARSED`, {
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
        body: JSON.stringify({
          mode,
          idempotencyKey: createIdempotencyKey()
        })
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

  useEffect(() => {
    if (!selectedJob) return;
    setActiveReceiptCaptureId(selectedJob.captureId);
    setFinalStoreId(selectedJob.storeCandidate?.storeId || activeStoreId || '');
    setConfirmStoreCreate(false);
    setForceUpcOverride(false);
    setApprovalMode('safe');
    setIdempotencyKey(createIdempotencyKey());
    setSelectedItemsForCommit(new Map());
    setShowReceiptReview(true);
    loadCaptureItems(selectedJob.captureId);
  }, [selectedJob, activeStoreId, loadCaptureItems]);

  // Tab content
  const tabContent = useMemo(() => {
    if (receiptFlow === 'capture') {
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
      // If a job is selected, show the review panel (placeholder for now)
      if (selectedJob) {
        return (
          <ReceiptReviewPanel
            activeReceiptCaptureId={activeReceiptCaptureId || ''}
            classifiedItems={classifiedItems}
            approvalMode={approvalMode}
            isCommitting={isCommitting}
            lockDurationDays={lockDurationDays}
            selectedItemsForCommit={selectedItemsForCommit}
            show={showReceiptReview}
            onClose={() => {
              setShowReceiptReview(false);
              setSelectedJob(null);
            }}
            onParse={handleParse}
            onConfirmAll={handleConfirmAll}
            onResetReview={handleResetReview}
            onLock={handleLock}
            onUnlock={handleUnlock}
            onApprovalMode={mode => setApprovalMode(mode)}
            onSelectAll={() => {
              const updated = new Map<string, boolean>();
              classifiedItems.forEach(item => {
                updated.set(getReceiptItemKey(item), true);
              });
              setSelectedItemsForCommit(updated);
            }}
            onSelectSafe={() => {
              const updated = new Map<string, boolean>();
              classifiedItems
                .filter(item => item.classification === 'A')
                .forEach(item => {
                  updated.set(getReceiptItemKey(item), true);
                });
              setSelectedItemsForCommit(updated);
            }}
            onClearSelection={() => setSelectedItemsForCommit(new Map())}
            onCommit={handleCommit}
            onScanItem={handleScanItem}
            onSearchProduct={handleSearchProduct}
            onCreateProduct={handleCreateProduct}
            onSelectForCommit={(item, checked) => {
              const key = getReceiptItemKey(item);
              setSelectedItemsForCommit(prev => {
                const updated = new Map(prev);
                const shouldSelect = checked ?? !updated.has(key);
                if (shouldSelect) {
                  updated.set(key, true);
                } else {
                  updated.delete(key);
                }
                return updated;
              });
            }}
            onAddNoiseRule={handleAddNoiseRule}
            scanModalOpen={scanModalOpen}
            handleScannerScan={handleScannerScan}
            handleScannerClose={handleScannerClose}
            settings={settings}
            confirmStoreCreate={confirmStoreCreate}
            forceUpcOverride={forceUpcOverride}
            finalStoreId={finalStoreId}
            onConfirmStoreCreate={setConfirmStoreCreate}
            onForceUpcOverride={setForceUpcOverride}
            onFinalStoreIdChange={setFinalStoreId}
            onLockDurationChange={setLockDurationDays}
            stores={stores}
            storeCandidate={selectedJob.storeCandidate}
          />
        );
      }
      // Otherwise, show the jobs list as before
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
  }, [
    receiptFlow,
    isReceiptFlowOpen,
    stores,
    fmtTime,
    parseJobs,
    isLoadingJobs,
    jobsError,
    selectedJob,
    activeReceiptCaptureId,
    classifiedItems,
    approvalMode,
    isCommitting,
    lockDurationDays,
    selectedItemsForCommit,
    showReceiptReview,
    scanModalOpen,
    confirmStoreCreate,
    forceUpcOverride,
    finalStoreId,
    isProcessing,
    handleReceiptCaptured,
    handleParse,
    handleConfirmAll,
    handleResetReview,
    handleLock,
    handleUnlock,
    handleCommit,
    handleScanItem,
    handleSearchProduct,
    handleCreateProduct,
    handleAddNoiseRule,
    handleScannerScan,
    handleScannerClose,
    loadParseJobs,
    handleApproveParseJob,
    handleRejectParseJob
  ]);

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
