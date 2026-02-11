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
  StoreRecord,
  StoreMatchCandidateOption
} from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import { apiFetch } from '../../utils/apiFetch';
import { BACKEND_URL } from '../../constants';

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

interface ReceiptApproveResponse {
  ok?: boolean;
  error?: string;
  reasonCode?: string;
  needsStoreResolution?: boolean;
  storeResolution?: {
    matchReason?: string;
    confidence?: number;
    candidates?: StoreMatchCandidateOption[];
  };
  appliedCount?: number;
  skippedCount?: number;
  inventoryWriteCount?: number;
  priceObservationWriteCount?: number;
  backendBuildId?: string;
  errors?: Array<{ lineIndex?: number; error?: string; code?: string }>;
  errorsByLine?: Record<string, Array<{ lineIndex?: number; error?: string; code?: string }>>;
  lineOutcomes?: Array<{
    lineIndex?: number;
    applied?: boolean;
    inventoryPersisted?: boolean;
    priceObservationPersisted?: boolean;
    priceLockOverridden?: boolean;
    priceLockOverrideDetail?: string | null;
    errors?: Array<{ lineIndex?: number; error?: string; code?: string }>;
  }>;
}

type ReceiptApplySummary = {
  matchedProductsUpdated: number;
  unmappedLinesRecorded: number;
  upcLinksCreated: number;
};

type ReceiptApprovalOutcome = {
  reasonCode?: string;
  appliedCount: number;
  skippedCount: number;
  inventoryWriteCount: number;
  priceObservationWriteCount: number;
  backendBuildId?: string;
  errors: Array<{ lineIndex?: number; error?: string; code?: string }>;
  errorsByLine: Record<string, Array<{ lineIndex?: number; error?: string; code?: string }>>;
  errorMessage?: string;
  applySummary: ReceiptApplySummary;
  lastUpdatedAt: string;
};

type ReceiptApprovalParsedResult = {
  data: ReceiptApproveResponse;
  outcome: ReceiptApprovalOutcome;
  appliedCount: number;
  skippedCount: number;
  backendErrors: Array<{ lineIndex?: number; error?: string; code?: string }>;
};

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

    if (!item.upc && item.action !== 'IGNORE' && item.action !== 'CAPTURE_UNMAPPED') {
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

  const isAmbiguousStoreMatch = String(storeDraft.storeCandidate?.matchReason || '').toLowerCase().includes('ambiguous');

  if (isAmbiguousStoreMatch && !storeDraft.finalStoreId) {
    storeBlocking.push('Resolve store selection before approving.');
  }

  if (finalStoreMode === 'MATCHED' && !storeDraft.storeCandidate?.storeId && !isAmbiguousStoreMatch) {
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

type ReceiptWorkflowTab = 'capture' | 'pending' | 'completed';

const PENDING_WORKFLOW_STATUSES = ['QUEUED', 'NEEDS_REVIEW', 'PARSED'] as const;
const COMPLETED_WORKFLOW_STATUSES = ['APPROVED', 'FAILED'] as const;


const summarizeReceiptApplyOutcome = (data: ReceiptApproveResponse): ReceiptApplySummary => {
  const lineOutcomes = Array.isArray(data?.lineOutcomes) ? data.lineOutcomes : [];
  const matchedProductsUpdated = lineOutcomes.filter(entry => Boolean(entry?.inventoryPersisted)).length;
  const unmappedLinesRecorded = lineOutcomes.filter(
    entry => !entry?.inventoryPersisted && Boolean(entry?.priceObservationPersisted)
  ).length;

  const upcLinksCreated = lineOutcomes.filter(entry => {
    const lineErrors = Array.isArray(entry?.errors) ? entry.errors : [];
    const hasUpcConflict = lineErrors.some(error => error?.code === 'UPC_CONFLICT');
    return Boolean(entry?.inventoryPersisted) && !hasUpcConflict;
  }).length;

  return {
    matchedProductsUpdated,
    unmappedLinesRecorded,
    upcLinksCreated
  };
};

const normalizeErrorsByLine = (
  errorsByLine: ReceiptApproveResponse['errorsByLine'],
  errors: Array<{ lineIndex?: number; error?: string; code?: string }>
) => {
  if (errorsByLine && typeof errorsByLine === 'object') {
    return Object.entries(errorsByLine).reduce<Record<string, Array<{ lineIndex?: number; error?: string; code?: string }>>>((acc, [lineKey, lineErrors]) => {
      acc[lineKey] = Array.isArray(lineErrors) ? lineErrors : [];
      return acc;
    }, {});
  }

  return errors.reduce<Record<string, Array<{ lineIndex?: number; error?: string; code?: string }>>>((acc, entry) => {
    const lineKey = typeof entry?.lineIndex === 'number' ? String(entry.lineIndex) : 'unknown';
    if (!acc[lineKey]) acc[lineKey] = [];
    acc[lineKey].push(entry);
    return acc;
  }, {});
};

const summarizeApprovalErrors = (errors: Array<{ lineIndex?: number; error?: string; code?: string }>) =>
  errors
    .slice(0, 3)
    .map(entry => {
      const line = typeof entry?.lineIndex === 'number' ? `line ${entry.lineIndex}` : 'line unknown';
      return `${line}: ${entry?.error || entry?.code || 'Unknown error'}`;
    })
    .join(' | ');

const normalizeBackendBuildId = (backendBuildId?: string) => {
  if (typeof backendBuildId !== 'string') return undefined;
  const normalized = backendBuildId.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const formatBackendBuildIdSummary = (backendBuildId?: string) =>
  backendBuildId ? `Backend build ID: ${backendBuildId}.` : 'Backend build ID unavailable.';

const parseReceiptApproveResponse = (data: ReceiptApproveResponse): ReceiptApprovalParsedResult => {
  const appliedCount = Number(data?.appliedCount || 0);
  const skippedCount = Number(data?.skippedCount || 0);
  const backendErrors = Array.isArray(data?.errors) ? data.errors : [];
  const applySummary = summarizeReceiptApplyOutcome(data || {});

  return {
    data,
    outcome: {
      reasonCode: typeof data?.reasonCode === 'string' ? data.reasonCode : undefined,
      appliedCount,
      skippedCount,
      inventoryWriteCount: Number(data?.inventoryWriteCount || 0),
      priceObservationWriteCount: Number(data?.priceObservationWriteCount || 0),
      backendBuildId: normalizeBackendBuildId(data?.backendBuildId),
      errors: backendErrors,
      errorsByLine: normalizeErrorsByLine(data?.errorsByLine, backendErrors),
      errorMessage: data?.error,
      applySummary,
      lastUpdatedAt: new Date().toISOString()
    },
    appliedCount,
    skippedCount,
    backendErrors
  };
};

const parseApprovalResponseJson = async (response: Response): Promise<ReceiptApproveResponse> => {
  return await response.json().catch(() => ({}));
};


const deriveResolvedStoreCandidate = (
  previousCandidate: ReceiptStoreCandidate | undefined,
  responseData: ReceiptApproveResponse
): ReceiptStoreCandidate | undefined => {
  if (!responseData?.needsStoreResolution) return previousCandidate;
  const resolution = responseData.storeResolution || {};
  return {
    ...(previousCandidate || {}),
    matchReason: resolution.matchReason || 'ambiguous_candidates',
    confidence: typeof resolution.confidence === 'number' ? resolution.confidence : previousCandidate?.confidence,
    isAmbiguous: true,
    candidates: Array.isArray(resolution.candidates) ? resolution.candidates : []
  };
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


interface ReceiptQueueStatus {
  queueEnabled?: boolean;
  workerHealthy?: boolean;
  workerOffline?: boolean;
  reason?: string;
  workerCount?: number;
  waitingCount?: number;
  activeCount?: number;
  staleQueued?: boolean;
  staleQueuedAgeMs?: number;
  staleThresholdMs?: number;
}

interface ReceiptIngestionGateHealth {
  mode?: 'enabled' | 'disabled' | string;
  storeId?: string | null;
  allowlist?: {
    enabled?: boolean;
    entries?: string[];
    hit?: boolean | null;
  };
  cap?: {
    enabled?: boolean;
    limit?: number | null;
    usedToday?: number | null;
    remaining?: number | null;
    exceeded?: boolean | null;
  };
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
  const [receiptFlow, setReceiptFlow] = useState<ReceiptWorkflowTab>('capture');
  
  // Capture state
  const [isReceiptFlowOpen, setIsReceiptFlowOpen] = useState(false);

  const [parseJobs, setParseJobs] = useState<ReceiptParseJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [receiptQueueStatus, setReceiptQueueStatus] = useState<ReceiptQueueStatus | null>(null);
  const [receiptIngestionGate, setReceiptIngestionGate] = useState<ReceiptIngestionGateHealth | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ReceiptParseJob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [visibleJobCount, setVisibleJobCount] = useState(20);

  // Receipt review state (moved from Pricing Intelligence)
  const [activeReceiptCaptureId, setActiveReceiptCaptureId] = useState<string | null>(null);
  const [classifiedItems, setClassifiedItems] = useState<ClassifiedReceiptItem[]>([]);
  const [approvalMode, setApprovalMode] = useState<ReceiptApprovalMode>(DEFAULT_RECEIPT_APPROVAL_MODE);
  const [forceUpcOverride, setForceUpcOverride] = useState(false);
  const [ignorePriceLocks, setIgnorePriceLocks] = useState(false);
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
  const [approvalOutcomeByJobId, setApprovalOutcomeByJobId] = useState<Record<string, ReceiptApprovalOutcome>>({});
  const [approvalPanelExpandedByJobId, setApprovalPanelExpandedByJobId] = useState<Record<string, boolean>>({});
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [lockDurationDays, setLockDurationDays] = useState(7); // Or get from settings if available
  const [settings] = useState<any>({}); // Placeholder for settings if needed

  const finalStoreId = finalStoreDraft.finalStoreId ?? '';
  const confirmStoreCreate = Boolean(finalStoreDraft.confirmStoreCreate);

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
      if (data?.warning) {
        addToast(data.warning, 'warning');
      } else {
        addToast(data?.queued ? 'Receipt parsing queued.' : 'Receipt parsing started.', 'success');
      }
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
        if (data?.warning) {
          addToast(data.warning, 'warning');
        } else {
          addToast(data?.queued ? 'Receipt parsing queued.' : 'Receipt parsing retried.', 'success');
        }
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
      const selectedIndices =
        approvalMode === 'selected'
          ? classifiedItems
              .filter(item => selectedItemsForCommit.get(getReceiptItemKey(item)))
              .map(item => item.lineIndex)
              .filter((lineIndex): lineIndex is number => typeof lineIndex === 'number')
          : classifiedItems
              .map(item => item.lineIndex)
              .filter((lineIndex): lineIndex is number => typeof lineIndex === 'number');

      if (approvalMode === 'selected' && selectedIndices.length === 0) {
        addToast('Select at least one item for selected mode.', 'error');
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

      const approvalResponse = await fetch(`${BACKEND_URL}/api/receipts/${selectedJob._id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: approvalMode,
          approvalDraft,
          selectedIndices: approvalMode === 'selected' ? selectedIndices : undefined,
          lockDurationDays,
          idempotencyKey: receiptApprovalIdempotencyKey,
          forceUpcOverride,
          ignorePriceLocks,
          finalStoreId: approvalDraft.finalStoreId,
          storeCandidate: approvalDraft.storeCandidate,
          confirmStoreCreate: approvalDraft.confirmStoreCreate,
          approvalNotes: receiptApprovalNotes || undefined
        })
      });
      const approvalData = await parseApprovalResponseJson(approvalResponse);
      const { outcome, appliedCount, skippedCount, backendErrors } = parseReceiptApproveResponse(approvalData);
      const summarizedErrors = summarizeApprovalErrors(backendErrors);

      setApprovalOutcomeByJobId(prev => ({ ...prev, [selectedJob._id]: outcome }));
      setApprovalPanelExpandedByJobId(prev => ({ ...prev, [selectedJob._id]: true }));

      if (!approvalResponse.ok || approvalData?.error || appliedCount < 1) {
        if (approvalData?.needsStoreResolution) {
          const resolvedCandidate = deriveResolvedStoreCandidate(finalStoreDraft.storeCandidate || selectedJob.storeCandidate, approvalData);
          updateStoreDraft({
            storeCandidate: resolvedCandidate,
            finalStoreId: null
          });
          setFinalStoreMode('MATCHED');
          throw new Error('Store resolution required: choose one of the suggested stores before approving.');
        }
        const backendReason = approvalData?.error || 'No receipt lines were applied. Verify mappings and prices, then retry.';
        const buildIdSummary = formatBackendBuildIdSummary(outcome.backendBuildId);
        const failureSummary = summarizedErrors ? `${backendReason} ${summarizedErrors}` : backendReason;
        throw new Error(`${failureSummary} ${buildIdSummary}`);
      }

      const applySummary = outcome.applySummary;
      const summary = `Approve & Apply completed: ${appliedCount} lines applied, ${skippedCount} skipped.`;
      const buildIdSummary = formatBackendBuildIdSummary(outcome.backendBuildId);
      const compactSummary = `Matched products updated: ${applySummary.matchedProductsUpdated} · Unmapped lines recorded: ${applySummary.unmappedLinesRecorded} · UPC links created: ${applySummary.upcLinksCreated}.`;
      addToast(`${summary} ${buildIdSummary} ${compactSummary}`, 'success');
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
    ignorePriceLocks,
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
            ? 'CAPTURE_UNMAPPED'
            : suggestedAction || (item.suggestedProduct?.id ? 'LINK_UPC_TO_PRODUCT' : 'CAPTURE_UNMAPPED');
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




  const loadReceiptHealth = useCallback(async () => {
    try {
      const healthQueryStoreId = activeStoreId ? `?storeId=${encodeURIComponent(activeStoreId)}` : '';
      const data: any = await apiFetch(`/api/driver/receipt-health${healthQueryStoreId}`);
      setReceiptQueueStatus(data?.queueStatus || null);
      setReceiptIngestionGate(data?.ingestionGate || null);
    } catch {
      setReceiptQueueStatus(null);
      setReceiptIngestionGate(null);
    }
  }, [activeStoreId]);

  // Load parse jobs for pending workflow and completed history
  const loadParseJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    void loadReceiptHealth();
    setJobsError(null);
    try {
      const data: any = await apiFetch('/api/receipts/?status=QUEUED,PARSING,NEEDS_REVIEW,PARSED,FAILED,APPROVED');
      if (data?.error) throw new Error(data.error || 'Failed to load parse jobs');
      const validStatuses = [...PENDING_WORKFLOW_STATUSES, ...COMPLETED_WORKFLOW_STATUSES];
      let jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      jobs = jobs.filter(j => validStatuses.includes(j.status));
      // Keep queue semantics first, then completed history
      const statusOrder = { QUEUED: 0, NEEDS_REVIEW: 1, PARSED: 2, APPROVED: 3, FAILED: 4 };
      jobs.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
      setParseJobs(jobs);
    } catch (err: any) {
      setJobsError(err?.message || 'Failed to load parse jobs');
    } finally {
      setIsLoadingJobs(false);
    }
  }, [loadReceiptHealth]);

  useEffect(() => {
    if (receiptFlow === 'pending' || receiptFlow === 'completed') {
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
    async (job: ReceiptParseJob, modeFromUi: ReceiptApprovalMode) => {
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
          mode: modeFromUi,
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
          approvalNotes: receiptApprovalNotes || undefined,
          ignorePriceLocks
        };

        // POST to canonical approval endpoint and inspect payload even on non-2xx responses.
        const approvalResponse = await fetch(`${BACKEND_URL}/api/receipts/${job._id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const data = await parseApprovalResponseJson(approvalResponse);
        const { outcome, appliedCount, skippedCount, backendErrors } = parseReceiptApproveResponse(data);
        const summarizedErrors = summarizeApprovalErrors(backendErrors);

        setApprovalOutcomeByJobId(prev => ({ ...prev, [job._id]: outcome }));
        setApprovalPanelExpandedByJobId(prev => ({ ...prev, [job._id]: true }));

        if (!approvalResponse.ok || data?.error || appliedCount < 1) {
          if (data?.needsStoreResolution) {
            const resolvedCandidate = deriveResolvedStoreCandidate(finalStoreDraft.storeCandidate || job.storeCandidate, data);
            updateStoreDraft({
              storeCandidate: resolvedCandidate,
              finalStoreId: null
            });
            setFinalStoreMode('MATCHED');
            throw new Error('Store resolution required: choose one of the suggested stores before approving.');
          }
          const backendReason = data?.error || 'No receipt lines were applied. Verify mappings and prices, then retry.';
          const buildIdSummary = formatBackendBuildIdSummary(outcome.backendBuildId);
          const failureSummary = summarizedErrors ? `${backendReason} ${summarizedErrors}` : backendReason;
          throw new Error(`${failureSummary} ${buildIdSummary}`);
        }

        const applySummary = outcome.applySummary;
        const summary = `Approve & Apply completed: ${appliedCount} lines applied, ${skippedCount} skipped.`;
        const buildIdSummary = formatBackendBuildIdSummary(outcome.backendBuildId);
        const compactSummary = `Matched products updated: ${applySummary.matchedProductsUpdated} · Unmapped lines recorded: ${applySummary.unmappedLinesRecorded} · UPC links created: ${applySummary.upcLinksCreated}.`;
        const toastType = skippedCount > 0 || backendErrors.length > 0 ? 'warning' : 'success';
        const baseMessage = `${summary} ${buildIdSummary} ${compactSummary}`;
        addToast(summarizedErrors ? `${baseMessage} ${summarizedErrors}` : baseMessage, toastType);

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
        const isNoApplied = String(err?.message || '').toLowerCase().includes('no receipt lines were applied');
        addToast(err?.message || 'Failed to approve job', isNoApplied ? 'warning' : 'error');
      } finally {
        setIsProcessing(false);
      }
    },
    [addToast, finalStoreMode, finalStoreDraft, receiptApprovalItems, receiptApprovalIdempotencyKey, receiptApprovalNotes, ignorePriceLocks, refreshStores, fetchProducts]
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
    setIgnorePriceLocks(false);
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
  const canOverridePriceLocks = currentUser?.role === 'MANAGER';
  const pendingWorkflowJobs = useMemo(
    () => parseJobs.filter(job => PENDING_WORKFLOW_STATUSES.includes(job.status as (typeof PENDING_WORKFLOW_STATUSES)[number])),
    [parseJobs]
  );
  const completedWorkflowJobs = useMemo(
    () => parseJobs.filter(job => COMPLETED_WORKFLOW_STATUSES.includes(job.status as (typeof COMPLETED_WORKFLOW_STATUSES)[number])),
    [parseJobs]
  );
  const activeJobs = receiptFlow === 'completed' ? completedWorkflowJobs : pendingWorkflowJobs;
  const visibleJobs = activeJobs.slice(0, visibleJobCount);
  const canLoadMoreJobs = activeJobs.length > visibleJobCount;

  useEffect(() => {
    if (activeJobs.length <= 20) {
      setVisibleJobCount(20);
      return;
    }
    setVisibleJobCount(prev => Math.min(prev, activeJobs.length));
  }, [activeJobs.length]);

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
          <p className="text-[11px] text-slate-300">
            Capturing a receipt creates a <span className="font-semibold text-white">ReceiptParseJob</span> that stages data for
            review before catalog changes.
          </p>
          <ReceiptCaptureFlow
            stores={stores}
            isOpen={isReceiptFlowOpen}
            onReceiptCreated={handleReceiptCaptured}
            onCancel={() => setIsReceiptFlowOpen(false)}
          />
        </div>
      );
    }

    if (receiptFlow === 'pending' || receiptFlow === 'completed') {
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
            ignorePriceLocks={ignorePriceLocks}
            canOverridePriceLocks={canOverridePriceLocks}
            finalStoreId={finalStoreId}
            onConfirmStoreCreate={value => updateStoreDraft({ confirmStoreCreate: value })}
            onForceUpcOverride={setForceUpcOverride}
            onIgnorePriceLocks={setIgnorePriceLocks}
            onFinalStoreIdChange={value => updateStoreDraft({ finalStoreId: value })}
            finalStoreMode={finalStoreMode}
            onFinalStoreModeChange={setFinalStoreMode}
            onLockDurationChange={setLockDurationDays}
            stores={stores}
            storeCandidate={finalStoreDraft.storeCandidate || selectedJob.storeCandidate}
            approvalOutcome={selectedJob ? approvalOutcomeByJobId[selectedJob._id] : undefined}
            fmtTime={fmtTime}
          />
        );
      }
      // Otherwise, show the jobs list as before
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-black uppercase tracking-widest flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-ninpo-lime" />
                {receiptFlow === 'completed'
                  ? `Completed Receipt Jobs (${completedWorkflowJobs.length})`
                  : `Pending / Needs Review (${pendingWorkflowJobs.length})`}
              </h3>
              <p className="mt-1 text-[10px] text-slate-400 uppercase tracking-widest">
                {receiptFlow === 'completed'
                  ? 'Approved and failed parse jobs remain here for history and follow-up.'
                  : 'Queue-focused workflow: queued, parsed, and needs-review jobs requiring operator action.'}
              </p>
            </div>
            <button
              onClick={loadParseJobs}
              disabled={isLoadingJobs}
              className="px-4 py-2 bg-white/10 text-white rounded-lg text-[10px] font-bold hover:bg-white/20 transition disabled:opacity-50"
            >
              {isLoadingJobs ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
            </button>
          </div>


          {receiptQueueStatus?.queueEnabled && receiptQueueStatus?.workerOffline && (
            <div className="bg-amber-900/25 border border-amber-500/60 rounded-xl p-4 text-amber-100 text-[11px]">
              <p className="font-semibold uppercase tracking-widest text-[10px]">Queue enabled, worker offline</p>
              <p className="mt-1 text-amber-100/90">
                Receipt parse jobs may not process automatically. Start the receipt worker (or disable queue) to restore background parsing.
              </p>
              <p className="mt-1 text-amber-200/80">
                Worker count: {receiptQueueStatus.workerCount ?? 0} • Waiting: {receiptQueueStatus.waitingCount ?? 0} • Active: {receiptQueueStatus.activeCount ?? 0}
              </p>
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-[11px]">
            <p className="font-semibold uppercase tracking-widest text-[10px] text-ninpo-lime">Receipt Ingestion Health</p>
            <div className="mt-2 space-y-1 text-slate-200">
              <p>
                Queue: {receiptQueueStatus?.queueEnabled ? 'enabled' : 'disabled'} • Worker:{' '}
                {receiptQueueStatus?.workerOffline ? 'offline' : 'healthy'}
              </p>
              <p>
                Ingestion mode: <span className="font-semibold">{receiptIngestionGate?.mode || 'unknown'}</span>
              </p>
              <p>
                Allowlist: {receiptIngestionGate?.allowlist?.enabled ? 'enabled' : 'open'}
                {receiptIngestionGate?.storeId
                  ? ` • store ${receiptIngestionGate.allowlist?.hit ? 'hit' : 'miss'}`
                  : ''}
              </p>
              <p>
                Daily cap: {receiptIngestionGate?.cap?.enabled ? `${receiptIngestionGate.cap.usedToday ?? 0}/${receiptIngestionGate.cap.limit ?? 0}` : 'disabled'}
                {receiptIngestionGate?.cap?.enabled
                  ? ` • remaining ${receiptIngestionGate.cap.remaining ?? 0}${receiptIngestionGate.cap.exceeded ? ' (exceeded)' : ''}`
                  : ''}
              </p>
            </div>
            <div className="mt-2 text-[10px] text-slate-400">
              <p>Fix guide: mode disabled → enable ingestion; allowlist miss → add storeId; cap exceeded → raise cap or wait for reset.</p>
            </div>
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
          ) : activeJobs.length === 0 ? (
            <div className="bg-ninpo-card border border-white/10 rounded-2xl p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-ninpo-lime mx-auto mb-3 opacity-50" />
              <p className="text-white font-black uppercase text-sm">
                {receiptFlow === 'completed' ? 'No completed jobs' : 'No pending jobs'}
              </p>
              <p className="text-[11px] text-slate-400 mt-2">
                {receiptFlow === 'completed'
                  ? 'Approved/failed history will appear here.'
                  : 'All active receipt jobs have been reviewed.'}
              </p>
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
                        {approvalOutcomeByJobId[job._id] && (
                          <div className="rounded-xl border border-ninpo-lime/30 bg-ninpo-lime/10 p-3 text-[11px] text-slate-100">
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                setApprovalPanelExpandedByJobId(prev => ({
                                  ...prev,
                                  [job._id]: !prev[job._id]
                                }));
                              }}
                              className="flex w-full items-center justify-between text-left"
                            >
                              <p className="font-bold uppercase tracking-widest text-[10px] text-ninpo-lime">Last approval result</p>
                              <ChevronDown
                                className={`h-4 w-4 text-ninpo-lime transition ${approvalPanelExpandedByJobId[job._id] !== false ? 'rotate-180' : ''}`}
                              />
                            </button>
                            {approvalPanelExpandedByJobId[job._id] !== false && (
                              <>
                                <p className="mt-1">
                                  Applied: <span className="font-semibold">{approvalOutcomeByJobId[job._id].appliedCount}</span>
                                  {' · '}
                                  Skipped: <span className="font-semibold">{approvalOutcomeByJobId[job._id].skippedCount}</span>
                                </p>
                                <p className="mt-1 text-[10px] text-slate-200">
                                  Inventory writes: <span className="font-semibold">{approvalOutcomeByJobId[job._id].inventoryWriteCount}</span>
                                  {' · '}
                                  Price observation writes: <span className="font-semibold">{approvalOutcomeByJobId[job._id].priceObservationWriteCount}</span>
                                </p>
                                <p className="mt-1 text-[10px] text-slate-200">
                                  Reason code: <span className="font-semibold">{approvalOutcomeByJobId[job._id].reasonCode || 'n/a'}</span>
                                  {' · '}
                                  Backend build id:{' '}
                                  {approvalOutcomeByJobId[job._id].backendBuildId ? (
                                    <span className="font-semibold">{approvalOutcomeByJobId[job._id].backendBuildId}</span>
                                  ) : (
                                    <span className="rounded-full border border-yellow-300/60 bg-yellow-200/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-yellow-100">
                                      Build ID unavailable
                                    </span>
                                  )}
                                </p>
                                {approvalOutcomeByJobId[job._id].priceObservationWriteCount < 1 && (
                                  <p className="mt-1 text-[10px] text-yellow-200">
                                    No Price Intelligence rows were written.
                                    {approvalOutcomeByJobId[job._id].errorMessage ? ` ${approvalOutcomeByJobId[job._id].errorMessage}` : ''}
                                  </p>
                                )}
                                <p className="mt-1 text-[10px] text-slate-300">
                                  Updated: {fmtTime(approvalOutcomeByJobId[job._id].lastUpdatedAt)}
                                </p>
                                <p className="mt-1 text-[10px] text-slate-200">
                                  Matched products updated: <span className="font-semibold">{approvalOutcomeByJobId[job._id].applySummary.matchedProductsUpdated}</span>
                                  {' · '}
                                  Unmapped lines recorded: <span className="font-semibold">{approvalOutcomeByJobId[job._id].applySummary.unmappedLinesRecorded}</span>
                                  {' · '}
                                  UPC links created: <span className="font-semibold">{approvalOutcomeByJobId[job._id].applySummary.upcLinksCreated}</span>
                                </p>
                                {Object.entries(approvalOutcomeByJobId[job._id].errorsByLine).length > 0 && (
                                  <div className="mt-2 space-y-1 text-[10px] text-slate-100">
                                    {Object.entries(approvalOutcomeByJobId[job._id].errorsByLine)
                                      .sort(([lineA], [lineB]) => {
                                        const a = Number(lineA);
                                        const b = Number(lineB);
                                        if (Number.isNaN(a) && Number.isNaN(b)) return lineA.localeCompare(lineB);
                                        if (Number.isNaN(a)) return 1;
                                        if (Number.isNaN(b)) return -1;
                                        return a - b;
                                      })
                                      .map(([lineKey, lineErrors]) => (
                                        <div key={`${job._id}-approval-line-${lineKey}`} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
                                          <p className="font-semibold text-slate-200">Line {lineKey}</p>
                                          <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-100">
                                            {lineErrors.map((entry, idx) => (
                                              <li key={`${job._id}-approval-line-${lineKey}-error-${idx}`}>
                                                {entry.error || 'Unknown error'}
                                                {entry.code ? ` (${entry.code})` : ''}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
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
                  onClick={() => setVisibleJobCount(prev => Math.min(prev + 20, activeJobs.length))}
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
    canLoadMoreJobs,
    approvalOutcomeByJobId
  ]);

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10">
        {[
          { id: 'capture', label: 'Capture' },
          { id: 'pending', label: `Pending / Needs Review (${pendingWorkflowJobs.length})` },
          { id: 'completed', label: `Completed (${completedWorkflowJobs.length})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setReceiptFlow(tab.id as ReceiptWorkflowTab)}
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
