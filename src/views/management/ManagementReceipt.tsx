import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
// ...existing code...
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
  ClassifiedReceiptItem,
  FinalStoreMode,
  ReceiptApprovalAction,
  ReceiptApprovalDraft,
  ReceiptApprovalDraftItem,
  ReceiptParseJob,
  ReceiptStoreCandidate,
  StoreRecord
} from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import { apiFetch } from '../../utils/apiFetch';

const createIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getReceiptJobItemId = (item: { _id?: string; captureId?: string; lineIndex?: number | string }) => {
  if (item._id) return item._id;
  if (item.captureId && typeof item.lineIndex !== 'undefined') {
    return `${item.captureId}:${item.lineIndex}`;
  }
  if (typeof item.lineIndex !== 'undefined') {
    return `line:${item.lineIndex}`;
  }
  return 'receipt-item-unknown';
};

type ReceiptApprovalMode = 'safe' | 'selected' | 'locked' | 'all';

// Must stay aligned with backend/operator policy for the primary Approve action.
const DEFAULT_RECEIPT_APPROVAL_MODE: ReceiptApprovalMode = 'all';

interface ReceiptApprovalStoreDraft {
  finalStoreId?: string | null;
  storeCandidate?: ReceiptStoreCandidate;
  confirmStoreCreate?: boolean;
}

type ReceiptApprovalItemStatus = {
  blocking: string[];
  advisory: string[];
};

const receiptApprovalStatus = (
  items: Array<ReceiptApprovalDraftItem & { id: string }>,
  storeDraft: ReceiptApprovalStoreDraft,
  finalStoreMode: FinalStoreMode
) => {
  const itemStatus: Record<string, ReceiptApprovalItemStatus> = {};
  let hasBlocking = false;
  let hasAdvisory = false;

  items.forEach(item => {
    const blocking: string[] = [];
    const advisory: string[] = [];

    if (item.lineIndex < 0 || Number.isNaN(item.lineIndex)) {
      blocking.push('Missing receipt line index.');
    }

    if (item.action === 'LINK_UPC_TO_PRODUCT' && !item.productId) {
      blocking.push('Link action requires a product selection.');
    }

    if (item.action === 'CREATE_UPC' && !item.upc) {
      blocking.push('Create UPC action requires a UPC value.');
    }

    if (item.action === 'CREATE_PRODUCT') {
      if (!item.createProduct?.name) {
        blocking.push('Create product action requires a product name.');
      }
      if (!item.createProduct?.price || item.createProduct.price <= 0) {
        blocking.push('Create product action requires a valid price.');
      }
    }

    if (!item.upc && item.action !== 'IGNORE') {
      advisory.push('UPC missing for item action.');
    }

    if (blocking.length) hasBlocking = true;
    if (advisory.length) hasAdvisory = true;
    itemStatus[item.id] = { blocking, advisory };
  });

  const storeBlocking: string[] = [];
  const storeAdvisory: string[] = [];

  if (finalStoreMode === 'EXISTING' && !storeDraft.finalStoreId) {
    storeBlocking.push('Select a final store before approving.');
  }

  if (finalStoreMode === 'CREATE_DRAFT' && !storeDraft.confirmStoreCreate) {
    storeBlocking.push('Confirm store creation before approving.');
  }

  if (finalStoreMode === 'MATCHED' && !storeDraft.storeCandidate?.storeId) {
    storeAdvisory.push('Store match not confirmed; review candidate details.');
  }

  if (storeBlocking.length) hasBlocking = true;
  if (storeAdvisory.length) hasAdvisory = true;

  return {
    hasBlocking,
    hasAdvisory,
    items: itemStatus,
    store: {
      blocking: storeBlocking,
      advisory: storeAdvisory
    }
  };
};

type ReceiptApprovalDraftState = {
  finalStoreMode: FinalStoreMode;
  finalStoreDraft: ReceiptApprovalStoreDraft;
  receiptApprovalItems: Array<ReceiptApprovalDraftItem & { id: string }>;
  receiptApprovalNotes: string;
  receiptApprovalIdempotencyKey: string;
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
  const { addToast, fetchProducts, currentUser } = useNinpoCore();
  const captureItemsInFlightRef = useRef<Set<string>>(new Set());
  const captureItemsAbortRef = useRef<AbortController | null>(null);
  const lastLoadedCaptureIdRef = useRef<string | null>(null);
  const [receiptFlow, setReceiptFlow] = useState<'capture' | 'pending'>('capture');
  
  // Capture state
  const [isReceiptFlowOpen, setIsReceiptFlowOpen] = useState(false);

  const [parseJobs, setParseJobs] = useState<ReceiptParseJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ReceiptParseJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [visibleJobCount, setVisibleJobCount] = useState(20);

  // Receipt review state (moved from Pricing Intelligence)
  const [activeReceiptCaptureId, setActiveReceiptCaptureId] = useState<string | null>(null);
  const [classifiedItems, setClassifiedItems] = useState<ClassifiedReceiptItem[]>([]);
  const [approvalMode, setApprovalMode] = useState<ReceiptApprovalMode>(DEFAULT_RECEIPT_APPROVAL_MODE);
  const [forceUpcOverride, setForceUpcOverride] = useState(false);
  const [finalStoreMode, setFinalStoreMode] = useState<FinalStoreMode>('MATCHED');
  const [finalStoreDraft, setFinalStoreDraft] = useState<ReceiptApprovalStoreDraft>({});
  const [receiptApprovalItems, setReceiptApprovalItems] = useState<Array<ReceiptApprovalDraftItem & { id: string }>>([]);
  const [receiptApprovalNotes, setReceiptApprovalNotes] = useState('');
  const [receiptApprovalIdempotencyKey, setReceiptApprovalIdempotencyKey] = useState(createIdempotencyKey());
  const [receiptApprovalJobId, setReceiptApprovalJobId] = useState<string | null>(null);

  // Stable job identifiers for idempotency key logic
  const selectedJobId = selectedJob?._id ?? null;
  const selectedCaptureId = selectedJob?.captureId ?? null;
  const [receiptApprovalDrafts, setReceiptApprovalDrafts] = useState<Map<string, ReceiptApprovalDraftState>>(new Map());
  const [scanTargetItemId, setScanTargetItemId] = useState<string | null>(null);
  const [selectedItemsForCommit, setSelectedItemsForCommit] = useState<Map<string, boolean>>(new Map());
  const [isCommitting, setIsCommitting] = useState(false);
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [lockDurationDays, setLockDurationDays] = useState(7); // Or get from settings if available
  const [settings] = useState<any>({}); // Placeholder for settings if needed

  const finalStoreId = finalStoreDraft.finalStoreId ?? '';
  const confirmStoreCreate = Boolean(finalStoreDraft.confirmStoreCreate);

  useEffect(() => {
    if (parseJobs.length <= 20) {
      setVisibleJobCount(20);
      return;
    }
    setVisibleJobCount(prev => Math.min(prev, parseJobs.length));
  }, [parseJobs.length]);

  const updateStoreDraft = useCallback((updates: Partial<ReceiptApprovalStoreDraft>) => {
    setFinalStoreDraft(prev => ({ ...prev, ...updates }));
  }, []);

  const updateStoreCandidateDraft = useCallback((candidate?: ReceiptStoreCandidate) => {
    updateStoreDraft({ storeCandidate: candidate });
  }, [updateStoreDraft]);

  const updateReceiptApprovalItem = useCallback(
    (itemId: string, updater: (item: ReceiptApprovalDraftItem & { id: string }) => ReceiptApprovalDraftItem & { id: string }) => {
      setReceiptApprovalItems(prev => prev.map(item => (item.id === itemId ? updater(item) : item)));
    },
    []
  );

  const updateReceiptApprovalItemUpc = useCallback((itemId: string, upc: string) => {
    updateReceiptApprovalItem(itemId, item => ({ ...item, upc }));
  }, [updateReceiptApprovalItem]);

  const updateReceiptApprovalItemAction = useCallback(
    (itemId: string, action: ReceiptApprovalAction) => {
      updateReceiptApprovalItem(itemId, item => ({ ...item, action }));
    },
    [updateReceiptApprovalItem]
  );

  const approvalStatus = useMemo(
    () => receiptApprovalStatus(receiptApprovalItems, finalStoreDraft, finalStoreMode),
    [receiptApprovalItems, finalStoreDraft, finalStoreMode]
  );

  const approvalIssues = useMemo(() => {
    const itemsByLineIndex = new Map<number, ClassifiedReceiptItem>();
    classifiedItems.forEach(item => {
      if (typeof item.lineIndex === 'number') {
        itemsByLineIndex.set(item.lineIndex, item);
      }
    });

    return receiptApprovalItems.flatMap(item => {
      const status = approvalStatus.items[item.id];
      if (!status) return [];
      const labelSource = itemsByLineIndex.get(item.lineIndex);
      const label = labelSource?.receiptName || `Line ${item.lineIndex}`;
      const issues: Array<{ label: string; messages: string[]; severity: 'blocking' | 'advisory' }> = [];

      if (status.blocking.length > 0) {
        issues.push({ label, messages: status.blocking, severity: 'blocking' });
      }
      if (status.advisory.length > 0) {
        issues.push({ label, messages: status.advisory, severity: 'advisory' });
      }
      return issues;
    });
  }, [classifiedItems, receiptApprovalItems, approvalStatus.items]);

  // --- Receipt Review Handlers (ported from Pricing Intelligence) ---
  const handleParse = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    // Fetch the capture to check image URLs before triggering parse
    try {
      const captureData: any = await apiFetch(`/api/driver/receipt-capture/${activeReceiptCaptureId}`);
      const images = Array.isArray(captureData?.images) ? captureData.images : [];
      // Check for valid URLs (Cloudinary/data URLs, not placeholders/404s)
      const invalidImages = images.filter((img: any) => {
        if (!img?.url) return true;
        // Accept Cloudinary, data URLs, or http(s)
        return !/^https?:\/\//.test(img.url) && !/^data:/.test(img.url) && !/res\.cloudinary\.com/.test(img.url);
      });
      if (invalidImages.length > 0) {
        addToast('Some receipt images are invalid or missing. Please re-upload or check image sources.', 'error');
        // Optionally: log details for debugging
        console.warn('Invalid receipt images:', invalidImages);
        return;
      }
    } catch (err: any) {
      addToast('Failed to validate receipt images before parsing.', 'error');
      return;
    }
    // Now trigger parse (do not abort request)
    try {
      const data: any = await apiFetch('/api/driver/receipt-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (data?.error) throw new Error(data.error || 'Failed to parse receipt');
      addToast('Receipt parsing started.', 'success');
      // Optionally reload jobs or state here
    } catch (err: any) {
      addToast(err?.message || 'Failed to parse receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast, apiFetch]);

  const handleRetryParse = useCallback(
    async (captureId: string) => {
      try {
        const data: any = await apiFetch('/api/driver/receipt-parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captureId })
        });
        if (data?.error) throw new Error(data.error || 'Failed to retry parse');
        addToast('Receipt parsing retried.', 'success');
      } catch (err: any) {
        addToast(err?.message || 'Failed to retry parse', 'error');
      }
    },
    [addToast]
  );

  const formatRetryAfter = useCallback((retryAfter?: string) => {
    if (!retryAfter) return null;
    const retryDate = new Date(retryAfter);
    if (Number.isNaN(retryDate.getTime())) return null;
    return retryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const isRetryBlocked = useCallback((retryAfter?: string) => {
    if (!retryAfter) return false;
    const retryDate = new Date(retryAfter);
    if (Number.isNaN(retryDate.getTime())) return false;
    return Date.now() < retryDate.getTime();
  }, []);


  // --- Load Capture Items (move up for dependency order) ---
  const loadCaptureItems = useCallback(async (captureId: string) => {
    if (captureItemsInFlightRef.current.has(captureId)) {
      return;
    }
    // Abort previous request if any
    if (captureItemsAbortRef.current) {
      captureItemsAbortRef.current.abort();
    }
    const abortController = new AbortController();
    captureItemsAbortRef.current = abortController;
    captureItemsInFlightRef.current.add(captureId);
    try {
      const data: any = await apiFetch(`/api/driver/receipt-capture/${captureId}/items`, {
        signal: abortController.signal
      });
      if (data?.error) throw new Error(data.error || 'Failed to load receipt items');
      const items = Array.isArray(data?.items) ? data.items : [];
      const { items: classified } = classifyItems(items);
      if (!classified || classified.length === 0) {
        addToast('No items extracted from receipt. Check image quality or parser output.', 'warning');
        console.warn('No classified items extracted from receipt:', { captureId, items });
      }
      setClassifiedItems(classified);
      const updated = new Map<string, boolean>();
      classified.forEach(item => {
        updated.set(getReceiptItemKey(item), true);
      });
      setSelectedItemsForCommit(updated);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Silently ignore aborts
        return;
      }
      addToast(err?.message || 'Failed to load receipt items', 'error');
      setClassifiedItems([]);
    } finally {
      captureItemsInFlightRef.current.delete(captureId);
      if (captureItemsAbortRef.current === abortController) {
        captureItemsAbortRef.current = null;
      }
    }
  }, [addToast]);

  const handleConfirmAll = useCallback(() => {
    // Mark all items as confirmed (example logic)
    setSelectedItemsForCommit(new Map(classifiedItems.map(item => [getReceiptItemKey(item), true])));
    addToast('All items selected for commit.', 'info');
  }, [classifiedItems, addToast]);

  const handleResetReview = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const data: any = await apiFetch('/api/driver/receipt-reset-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (data?.error) throw new Error(data.error || 'Failed to reset review');
      setSelectedItemsForCommit(new Map());
      setApprovalMode(DEFAULT_RECEIPT_APPROVAL_MODE);
      lastLoadedCaptureIdRef.current = null;
      loadCaptureItems(activeReceiptCaptureId);
      addToast('Review reset.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to reset review', 'error');
    }
  }, [activeReceiptCaptureId, addToast, loadCaptureItems]);

  const handleLock = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const data: any = await apiFetch('/api/driver/receipt-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          lockDurationDays
        })
      });
      if (data?.error) throw new Error(data.error || 'Failed to lock receipt');
      addToast(`Receipt locked for ${lockDurationDays} days.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to lock receipt', 'error');
    }
  }, [activeReceiptCaptureId, lockDurationDays, addToast]);

  const handleUnlock = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const data: any = await apiFetch('/api/driver/receipt-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (data?.error) throw new Error(data.error || 'Failed to unlock receipt');
      addToast('Receipt unlocked.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to unlock receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast]);

  const handleCommit = useCallback(async () => {
    if (!selectedJob) return;
    if (!activeReceiptCaptureId || !approvalMode) return;
    if (approvalStatus.hasBlocking) {
      addToast('Resolve blocking receipt approval items before committing.', 'error');
      return;
    }
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

      if (selectedIndices.length === 0) {
        addToast('Selected items must include a line index before committing.', 'error');
        setIsCommitting(false);
        return;
      }

      if (finalStoreMode === 'CREATE_DRAFT' && !confirmStoreCreate) {
        addToast('Confirm store creation before committing.', 'error');
        setIsCommitting(false);
        return;
      }

      const draftItems = receiptApprovalItems
        .filter(item => selectedIndices.includes(item.lineIndex))
        .map(item => ({
          lineIndex: item.lineIndex,
          action: item.action,
          productId: item.productId,
          sku: item.sku,
          upc: item.upc,
          createProduct: item.createProduct
        }));

      const invalidActions = draftItems.filter(item => item.action === 'LINK_UPC_TO_PRODUCT' && !item.productId);
      if (invalidActions.length > 0) {
        addToast('Link actions require a matched product before committing.', 'error');
        setIsCommitting(false);
        return;
      }

      const approvalDraft: ReceiptApprovalDraft = {
        jobId: selectedJob._id,
        captureId: selectedJob.captureId,
        finalStoreMode,
        finalStoreId: finalStoreId || undefined,
        storeCandidate: finalStoreDraft.storeCandidate,
        confirmStoreCreate,
        items: draftItems
      };

      const data = await apiFetch(`/api/receipts/${selectedJob._id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: approvalMode,
          approvalDraft,
          selectedIndices: approvalMode === 'selected' ? selectedIndices : undefined,
          lockDurationDays,
          idempotencyKey: receiptApprovalIdempotencyKey,
          forceUpcOverride,
          finalStoreId: approvalDraft.finalStoreId,
          storeCandidate: approvalDraft.storeCandidate,
          confirmStoreCreate: approvalDraft.confirmStoreCreate,
          approvalNotes: receiptApprovalNotes || undefined
        })
      });
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
    receiptApprovalItems,
    selectedItemsForCommit,
    lockDurationDays,
    receiptApprovalIdempotencyKey,
    forceUpcOverride,
    approvalStatus.hasBlocking,
    finalStoreId,
    confirmStoreCreate,
    finalStoreMode,
    finalStoreDraft.storeCandidate,
    receiptApprovalNotes,
    addToast
  ]);

  const buildReceiptApprovalItems = useCallback(
    (job: ReceiptParseJob, items: ClassifiedReceiptItem[]) => {
      const jobItems = new Map<number, ReceiptParseJob['items'][number]>();
      job.items?.forEach(jobItem => {
        if (typeof jobItem.lineIndex === 'number') {
          jobItems.set(jobItem.lineIndex, jobItem);
        }
      });

      // Do NOT filter out items based on price or any truthy check
      return items.map(item => {
        const lineIndex = item.lineIndex ?? -1;
        const jobItem = jobItems.get(lineIndex);
        const suggestedAction = jobItem?.actionSuggestion;
        const action: ReceiptApprovalAction =
          suggestedAction === 'CREATE_PRODUCT'
            ? 'IGNORE'
            : suggestedAction || (item.suggestedProduct?.id ? 'LINK_UPC_TO_PRODUCT' : 'IGNORE');
        return {
          id: getReceiptJobItemId({ _id: (jobItem as { _id?: string })?._id, captureId: job.captureId, lineIndex }),
          lineIndex,
          action,
          productId: jobItem?.match?.productId || item.suggestedProduct?.id,
          sku: item.suggestedProduct?.sku,
          upc: item.scannedUpc || item.suggestedProduct?.upc || jobItem?.upcCandidate
        };
      });
    },
    []
  );

  const handleScanItem = useCallback((item: ClassifiedReceiptItem) => {
    const targetId = getReceiptJobItemId({
      captureId: activeReceiptCaptureId || selectedJob?.captureId,
      lineIndex: item.lineIndex
    });
    setScanTargetItemId(targetId);
    setScanModalOpen(true);
  }, [activeReceiptCaptureId, selectedJob?.captureId]);

  const handleSearchProduct = useCallback((item: ClassifiedReceiptItem) => {
    addToast('Product search not yet implemented.', 'info');
    // Implement product search logic if needed
    const targetId = getReceiptJobItemId({
      captureId: activeReceiptCaptureId || selectedJob?.captureId,
      lineIndex: item.lineIndex
    });
    updateReceiptApprovalItemAction(targetId, 'LINK_UPC_TO_PRODUCT');
  }, [activeReceiptCaptureId, selectedJob?.captureId, addToast, updateReceiptApprovalItemAction]);

  const handleAddNoiseRule = useCallback((normalizedName: string) => {
    addToast(`Noise rule added for: ${normalizedName}`, 'info');
    // Implement noise rule logic if needed
  }, [addToast]);

  const handleScannerScan = useCallback((upc: string) => {
    addToast(`Scanned UPC: ${upc}`, 'info');
    if (scanTargetItemId) {
      updateReceiptApprovalItemUpc(scanTargetItemId, upc);
      setReceiptApprovalItems(prev =>
        prev.map(item => {
          if (item.id !== scanTargetItemId) return item;
          const nextAction: ReceiptApprovalAction = item.productId ? 'LINK_UPC_TO_PRODUCT' : 'CREATE_UPC';
          return {
            ...item,
            upc,
            action: nextAction
          };
        })
      );
    }
    setScanModalOpen(false);
  }, [addToast, scanTargetItemId, updateReceiptApprovalItemUpc]);

  const handleScannerClose = useCallback(() => {
    setScanModalOpen(false);
  }, []);

  // ...existing code...



  // Load pending parse jobs
  const loadParseJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    setJobsError(null);
    try {
      const data: any = await apiFetch('/api/receipts/?status=QUEUED,PARSING,NEEDS_REVIEW,PARSED,FAILED,APPROVED');
      if (data?.error) throw new Error(data.error || 'Failed to load parse jobs');
      // Only include jobs with QUEUED, NEEDS_REVIEW, PARSED, APPROVED, FAILED (exclude PARSING)
      const validStatuses = ['QUEUED', 'NEEDS_REVIEW', 'PARSED', 'FAILED', 'APPROVED'];
      let jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      jobs = jobs.filter(j => validStatuses.includes(j.status));
      // Sort by required order: QUEUED, NEEDS_REVIEW, PARSED, APPROVED, FAILED
      const statusOrder = { QUEUED: 0, NEEDS_REVIEW: 1, PARSED: 2, APPROVED: 3, FAILED: 4 };
      jobs.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
      setParseJobs(jobs);
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

  // Enhanced handleApproveReceipt: builds full payload, posts, resets state, refreshes stores/products
  const handleApproveReceipt = useCallback(
    async (job: ReceiptParseJob, mode: ReceiptApprovalMode = DEFAULT_RECEIPT_APPROVAL_MODE) => {
      setIsProcessing(true);
      try {
        // Build store override if needed
        let storeCandidateOverride: ReceiptStoreCandidate | undefined = undefined;
        if (
          (finalStoreMode === 'MATCHED' && finalStoreDraft.storeCandidate) ||
          (finalStoreMode === 'CREATE_DRAFT' && finalStoreDraft.storeCandidate)
        ) {
          storeCandidateOverride = finalStoreDraft.storeCandidate;
        } else if (finalStoreMode === 'EXISTING' && finalStoreDraft.finalStoreId) {
          storeCandidateOverride = undefined;
        }

        // Build approval items
        const approvalItems = receiptApprovalItems.map(item => {
          const base: any = {
            lineIndex: item.lineIndex,
            action: item.action,
            upc: item.upc,
            productId: item.productId,
            sku: item.sku
          };
          if (item.action === 'CREATE_PRODUCT' && item.createProduct) {
            base.createProduct = item.createProduct;
          }
          return base;
        });

        // Build payload
        const payload: any = {
          mode,
          approvalDraft: {
            jobId: job._id,
            captureId: job.captureId,
            finalStoreMode,
            finalStoreId: finalStoreDraft.finalStoreId || undefined,
            storeCandidate: storeCandidateOverride,
            confirmStoreCreate: finalStoreDraft.confirmStoreCreate,
            items: approvalItems
          },
          idempotencyKey: receiptApprovalIdempotencyKey,
          approvalNotes: receiptApprovalNotes || undefined
        };

        // POST to canonical approval endpoint
        const data: any = await apiFetch(`/api/receipts/${job._id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (data?.error) throw new Error(data.error || 'Failed to approve parse job');

        addToast('Parse job approved', 'success');

        // Reset review state/drafts

        setShowReceiptReview(false);
        setSelectedJob(null);
        setParseJobs(prev => prev.filter(j => j._id !== job._id));
        setReceiptApprovalItems([]);
        setReceiptApprovalNotes('');
        setReceiptApprovalIdempotencyKey(createIdempotencyKey());
        setFinalStoreDraft({});
        setFinalStoreMode('MATCHED');
        setActiveStoreId('');

        // Refresh stores and products
        await refreshStores();
        if (typeof fetchProducts === 'function') {
          await fetchProducts();
        }
      } catch (err: any) {
        addToast(err?.message || 'Failed to approve job', 'error');
      } finally {
        setIsProcessing(false);
      }
    },
    [addToast, finalStoreMode, finalStoreDraft, receiptApprovalItems, receiptApprovalIdempotencyKey, receiptApprovalNotes, refreshStores, fetchProducts]
  );

  const handleRejectParseJob = useCallback(async (jobId: string) => {
    setIsProcessing(true);
    try {
      const data = await apiFetch(`/api/receipts/${jobId}/reject`, {
        method: 'POST',
      });
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
    const mode: FinalStoreMode = finalStoreDraft.finalStoreId
      ? 'EXISTING'
      : selectedJob.storeCandidate?.storeId
        ? 'MATCHED'
        : 'CREATE_DRAFT';
    setFinalStoreMode(mode);
  }, [selectedJob, finalStoreDraft.finalStoreId]);

  useEffect(() => {
    if (!receiptApprovalJobId) return;
    setReceiptApprovalDrafts(prev => {
      const next = new Map(prev);
      next.set(receiptApprovalJobId, {
        finalStoreMode,
        finalStoreDraft,
        receiptApprovalItems,
        receiptApprovalNotes,
        receiptApprovalIdempotencyKey
      });
      return next;
    });
  }, [
    receiptApprovalJobId,
    finalStoreMode,
    finalStoreDraft,
    receiptApprovalItems,
    receiptApprovalNotes,
    receiptApprovalIdempotencyKey
  ]);

  useEffect(() => {
    if (!selectedJob) return;
    setActiveReceiptCaptureId(selectedJob.captureId);
    setShowReceiptReview(true);
    updateStoreCandidateDraft(selectedJob.storeCandidate);
    setForceUpcOverride(false);
    setApprovalMode(DEFAULT_RECEIPT_APPROVAL_MODE);
    if (lastLoadedCaptureIdRef.current === selectedJob.captureId) {
      return;
    }
    lastLoadedCaptureIdRef.current = selectedJob.captureId;
    loadCaptureItems(selectedJob.captureId);
    if (receiptApprovalJobId !== selectedJob._id) {
      const existingDraft = receiptApprovalDrafts.get(selectedJob._id);
      if (existingDraft) {
        setFinalStoreMode(existingDraft.finalStoreMode);
        setFinalStoreDraft(existingDraft.finalStoreDraft);
        setReceiptApprovalItems(existingDraft.receiptApprovalItems);
        setReceiptApprovalNotes(existingDraft.receiptApprovalNotes);
        setReceiptApprovalIdempotencyKey(existingDraft.receiptApprovalIdempotencyKey);
      } else {
        const nextFinalStoreMode: FinalStoreMode = selectedJob.storeCandidate?.storeId
          ? 'MATCHED'
          : 'CREATE_DRAFT';
        setFinalStoreMode(nextFinalStoreMode);
        setFinalStoreDraft({
          finalStoreId: null,
          storeCandidate: selectedJob.storeCandidate,
          confirmStoreCreate: false
        });
        setReceiptApprovalItems(buildReceiptApprovalItems(selectedJob, classifiedItems));
        setReceiptApprovalNotes('');
        setSelectedItemsForCommit(new Map());
      }
      setReceiptApprovalJobId(selectedJob._id);
    }
  }, [
    selectedJob,
    activeStoreId,
    receiptApprovalJobId,
    receiptApprovalDrafts,
    loadCaptureItems,
    buildReceiptApprovalItems,
    classifiedItems,
    updateStoreCandidateDraft
  ]);

  // Only regenerate idempotency key when truly switching jobs
  useEffect(() => {
    if (!selectedJobId || !selectedCaptureId) return;
    // If we're still on the same job, do nothing.
    if (receiptApprovalJobId === selectedJobId) return;
    // New job selected: create a fresh idempotency key ONCE.
    setReceiptApprovalJobId(selectedJobId);
    setReceiptApprovalIdempotencyKey(createIdempotencyKey());
    // ...other one-time "open job" setup can go here if needed...
  }, [selectedJobId, selectedCaptureId, receiptApprovalJobId]);

  useEffect(() => {
    if (!selectedJob) return;
    if (receiptApprovalJobId !== selectedJob._id) return;
    if (classifiedItems.length === 0 || receiptApprovalItems.length > 0) return;
    setReceiptApprovalItems(buildReceiptApprovalItems(selectedJob, classifiedItems));
  }, [
    selectedJob,
    receiptApprovalJobId,
    classifiedItems,
    receiptApprovalItems.length,
    buildReceiptApprovalItems
  ]);

  // Tab content
  // Only ADMIN and OWNER can manage products
  const canManageProducts = currentUser?.role === 'ADMIN' || currentUser?.role === 'OWNER';
  const visibleJobs = parseJobs.slice(0, visibleJobCount);
  const canLoadMoreJobs = parseJobs.length > visibleJobCount;

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
            canManageProducts={canManageProducts}
            activeReceiptCaptureId={activeReceiptCaptureId || ''}
            classifiedItems={classifiedItems}
            approvalMode={approvalMode}
            isCommitting={isCommitting}
            lockDurationDays={lockDurationDays}
            selectedItemsForCommit={selectedItemsForCommit}
            approvalIssues={approvalIssues}
            storeBlockingIssues={approvalStatus.store.blocking}
            storeAdvisoryIssues={approvalStatus.store.advisory}
            receiptApprovalStatus={approvalStatus}
            receiptApprovalItems={receiptApprovalItems}
            approvalNotes={receiptApprovalNotes}
            onApprovalNotesChange={setReceiptApprovalNotes}
            receiptApprovalIdempotencyKey={receiptApprovalIdempotencyKey}
            onReceiptApprovalIdempotencyKeyChange={setReceiptApprovalIdempotencyKey}
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
            onItemUpcChange={updateReceiptApprovalItemUpc}
            onItemActionChange={updateReceiptApprovalItemAction}
            onAddNoiseRule={handleAddNoiseRule}
            scanModalOpen={scanModalOpen}
            handleScannerScan={handleScannerScan}
            handleScannerClose={handleScannerClose}
            settings={settings}
            confirmStoreCreate={confirmStoreCreate}
            forceUpcOverride={forceUpcOverride}
            finalStoreId={finalStoreId}
            onConfirmStoreCreate={value => updateStoreDraft({ confirmStoreCreate: value })}
            onForceUpcOverride={setForceUpcOverride}
            onFinalStoreIdChange={value => updateStoreDraft({ finalStoreId: value })}
            finalStoreMode={finalStoreMode}
            onFinalStoreModeChange={setFinalStoreMode}
            onLockDurationChange={setLockDurationDays}
            stores={stores}
            storeCandidate={finalStoreDraft.storeCandidate || selectedJob.storeCandidate}
          
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
              {visibleJobs.map(job => {
                const isBroken = (job.items?.length || 0) === 0;
                return (
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
                      <div className="flex items-center gap-2">
                        {/* Dismiss/Reject always visible */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleRejectParseJob(job._id);
                          }}
                          disabled={isProcessing}
                          className="px-3 py-1 text-xs font-bold rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        >
                          Dismiss
                        </button>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition ${selectedJob?._id === job._id ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {isBroken && (
                      <div className="mt-3 rounded-xl border border-yellow-400/40 bg-yellow-200/10 px-3 py-2 text-[11px] text-yellow-100">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            <span className="font-semibold">Parsing failed.</span>
                            {job.parseError && (
                              <span className="text-yellow-200/80">Reason: {job.parseError}</span>
                            )}
                            {!job.parseError && job.skippedImageReason?.length ? (
                              <span className="text-yellow-200/80">
                                Skipped images: {job.skippedImageReason.join(', ')}
                              </span>
                            ) : null}
                            {job.parseErrorType === 'TRANSIENT' && formatRetryAfter(job.retryAfter) ? (
                              <span className="text-yellow-200/80">
                                Retry after {formatRetryAfter(job.retryAfter)}
                              </span>
                            ) : null}
                          </div>
                          {/* Retry Parse always visible for broken jobs */}
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation();
                              handleRetryParse(job.captureId);
                            }}
                            disabled={isRetryBlocked(job.retryAfter) || isProcessing}
                            className="px-3 py-1 rounded-full bg-yellow-200 text-yellow-950 text-[10px] font-bold uppercase tracking-widest hover:bg-yellow-100 transition"
                          >
                            {isRetryBlocked(job.retryAfter) ? 'Retry pending' : 'Retry parse'}
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedJob?._id === job._id && !isBroken && (
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

                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleApproveReceipt(job, approvalMode);
                              }}
                              disabled={isProcessing}
                              className="flex-1 py-2 bg-ninpo-lime text-ninpo-black rounded-lg font-bold text-[10px] hover:bg-white transition disabled:opacity-50"
                            >
                              Approve ({approvalMode})
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleApproveReceipt(job, 'safe');
                              }}
                              disabled={isProcessing}
                              className="flex-1 py-2 bg-ninpo-lime/20 text-ninpo-lime rounded-lg font-bold text-[10px] hover:bg-ninpo-lime/30 transition disabled:opacity-50"
                            >
                              Approve (Safe)
                            </button>
                          </div>
                          {/* Dismiss/Reject also visible here for consistency */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleRejectParseJob(job._id);
                            }}
                            disabled={isProcessing}
                            className="w-full py-2 bg-ninpo-red/20 text-ninpo-red rounded-lg font-bold text-[10px] hover:bg-ninpo-red/30 transition disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {canLoadMoreJobs && (
                <button
                  type="button"
                  onClick={() => setVisibleJobCount(prev => Math.min(prev + 20, parseJobs.length))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/70 hover:text-white hover:border-white/30 transition"
                >
                  Load more
                </button>
              )}
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
    approvalIssues,
    showReceiptReview,
    scanModalOpen,
    confirmStoreCreate,
    forceUpcOverride,
    finalStoreId,
    receiptApprovalNotes,
    approvalStatus.hasBlocking,
    approvalStatus.store.blocking,
    approvalStatus.store.advisory,
    isProcessing,
    handleReceiptCaptured,
    handleParse,
    handleRetryParse,
    handleConfirmAll,
    handleResetReview,
    handleLock,
    handleUnlock,
    handleCommit,
    formatRetryAfter,
    isRetryBlocked,
    handleScanItem,
    handleSearchProduct,
    handleAddNoiseRule,
    handleScannerScan,
    handleScannerClose,
    loadParseJobs,
    handleApproveReceipt,
    handleRejectParseJob,
    visibleJobCount,
    visibleJobs,
    canLoadMoreJobs
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
