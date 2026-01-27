// Defensive helper for stats fields
function safeStat(capture: any, key: string): number {
  return capture && capture.stats && typeof capture.stats[key] === 'number' ? capture.stats[key] : 0;
}
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Trash2, Loader2, CheckCircle2, X } from 'lucide-react';
import {
  ClassifiedReceiptItem,
  Product,
  ReceiptItemClassification,
  ScannerMode,
  StoreRecord
} from '../../types';
import { BACKEND_URL } from '../../constants';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import { useReceiptCapture } from '../../hooks/useReceiptCapture';
import { useReceiptAliases } from '../../hooks/useReceiptAliases';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import ReceiptItemBucket from '../../components/ReceiptItemBucket';
import ScannerModal from '../../components/ScannerModal';
import { uploadReceiptPhoto } from '../../utils/cloudinaryUtils';
import { classifyItems } from '../../utils/classificationUtils';
import { formatStoreAddress } from '../../utils/address';
import {
  isMongoId,
  formatReceiptSource,
  formatReceiptRole,
  formatReceiptUserId,
  getSafeCaptureStatus,
  getReceiptItemKey
} from '../../utils/receiptHelpers';

interface ReceiptCapture {
  _id: string;
  storeId?: string;
  storeName?: string;
  orderId?: string;
  status: string;
  imageCount: number;
  stats: {
    totalItems: number;
    itemsNeedingReview?: number;
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

interface ReceiptAliasRecord {
  _id: string;
  normalizedName: string;
  storeId: string;
  storeName: string | null;
  productId: string;
  productName: string | null;
  productSku: string | null;
  upc: string | null;
  confirmedCount: number;
  matchConfidence: number;
  baseConfidence?: number;
  effectiveConfidence?: number;
  lastSeenAt?: string;
  lastConfirmedAt?: string | null;
  rawNames: Array<{ name: string; firstSeen?: string; occurrences?: number }>;
  lockToken: string | null;
}

interface ProductSearchResult {
  id: string;
  productId: string;
  sku?: string;
  upc?: string;
  name: string;
}

interface NoiseRuleEntry {
  id: string;
  normalizedName: string;
  rawNames: Array<{ name: string; occurrences?: number }>;
  lastSeenAt?: string;
}

interface PriceHistoryEntry {
  price: number;
  observedAt?: string;
  matchMethod?: string;
  matchConfidence?: number;
  priceType?: string;
  promoDetected?: boolean;
  workflowType?: string;
}

interface ManagementPricingIntelligenceProps {
  setScannerMode: (mode: ScannerMode) => void;
  setScannerModalOpen: (open: boolean) => void;
  fmtTime: (iso?: string) => string;
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoadingStores: boolean;
  storeError: string | null;
  setStoreError: (err: string | null) => void;
}

const ManagementPricingIntelligence: React.FC<ManagementPricingIntelligenceProps> = ({
  setScannerMode,
  setScannerModalOpen,
  fmtTime,
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoadingStores,
  storeError,
  setStoreError
}) => {
  const { addToast, settings, currentUser } = useNinpoCore();
  const {
    receiptCaptures = [],
    setReceiptCaptures,
    refreshReceiptCaptures: fetchReceiptCaptures
  } = useReceiptCapture();
  const {
    receiptAliases = [],
    setReceiptAliases,
    isAliasLoading,
    aliasError,
    setAliasError,
    aliasServiceStatus,
    setAliasServiceStatus,
    aliasActionId,
    setAliasActionId,
    noiseRules = [],
    setNoiseRules,
    isLoadingNoiseRules,
    refreshAliases: fetchReceiptAliases,
    refreshNoiseRules: fetchNoiseRules
  } = useReceiptAliases(activeStoreId);

  const [showReceiptScanner, setShowReceiptScanner] = useState(false);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [receiptThumbnailUrl, setReceiptThumbnailUrl] = useState<string | null>(null);
  const [activeReceiptCaptureId, setActiveReceiptCaptureId] = useState<string | null>(null);
  const [isLoadingReceiptCapture, setIsLoadingReceiptCapture] = useState<string | null>(null);
  const [commitIntent, setCommitIntent] = useState<'safe' | 'selected' | 'locked' | null>(null);
  const [classifiedItems, setClassifiedItems] = useState<ClassifiedReceiptItem[]>([]);
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [selectedItemsForCommit, setSelectedItemsForCommit] = useState<Map<string, boolean>>(new Map());
  const [isCommitting, setIsCommitting] = useState(false);
  const [scanTargetItem, setScanTargetItem] = useState<ClassifiedReceiptItem | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [productSearchItem, setProductSearchItem] = useState<ClassifiedReceiptItem | null>(null);
  const [productSearchIntent, setProductSearchIntent] = useState<'match' | 'attach'>('match');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<ProductSearchResult[]>([]);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [createProductItem, setCreateProductItem] = useState<ClassifiedReceiptItem | null>(null);
  const [createProductDraft, setCreateProductDraft] = useState({
    name: '',
    category: '',
    sizeOz: 0,
    price: 0,
    isTaxable: null as null | boolean,
    depositEligible: null as null | boolean
  });
  const [dismissedCreateItems, setDismissedCreateItems] = useState<Set<string>>(new Set());
  const [showNoiseRules, setShowNoiseRules] = useState(false);
  const [timelineStoreId, setTimelineStoreId] = useState<string>('');
  const [timelineProductId, setTimelineProductId] = useState<string>('');

  const activeStore = useMemo(
    () => (stores || []).find(store => store.id === activeStoreId) || null,
    [activeStoreId, stores]
  );

  const lockDurationDays = useMemo(() => {
    if (!settings) return 7;
    const rawValue = Number(settings.priceLockDays);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 7;
  }, [settings]);

  const priceDeltaThreshold = useMemo(() => {
    if (!settings) return 0.50;
    const rawValue = Number(settings.priceDeltaAlert);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0.50;
  }, [settings]);

  const canCreateProducts = currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER';

  const filteredProducts = useMemo(() => productSearchResults, [productSearchResults]);

  const safeItemsForCommit = useMemo(
    () => classifiedItems.filter(item => item.classification === 'A' && item.suggestedProduct && typeof item.lineIndex === 'number'),
    [classifiedItems]
  );

  const aliasConfidenceThreshold = 0.8;

  const aliasConfidenceSummary = useMemo(() => {
    const confidences = (Array.isArray(receiptAliases) ? receiptAliases : []).map(alias => ({
      effective: alias.effectiveConfidence ?? alias.matchConfidence,
      base: alias.baseConfidence ?? alias.matchConfidence,
      lastSeen: alias.lastSeenAt || alias.lastConfirmedAt || ''
    }));
    const safe = confidences.filter(entry => entry.effective >= aliasConfidenceThreshold);
    const gated = confidences.filter(entry => entry.effective < aliasConfidenceThreshold);
    const total = confidences.length;
    const averageEffective = total
      ? confidences.reduce((sum, entry) => sum + entry.effective, 0) / confidences.length
      : 0;
    const trend = confidences
      .map(entry => ({
        confidence: entry.effective,
        timestamp: entry.lastSeen ? new Date(entry.lastSeen).getTime() : 0
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-12)
      .map(entry => entry.confidence);
    return {
      total,
      safeCount: safe.length,
      gatedCount: gated.length,
      averageEffective,
      trend
    };
  }, [aliasConfidenceThreshold, receiptAliases]);

  const selectedForCommitCount = useMemo(() => selectedItemsForCommit.size, [selectedItemsForCommit]);

  const priceReviewItems = useMemo(() => {
    return (Array.isArray(classifiedItems) ? classifiedItems : []).filter(item => item.priceDelta?.flag && item.classification !== 'A');
  }, [classifiedItems]);

  const pendingReceiptCount = useMemo(() => {
    return (Array.isArray(receiptCaptures) ? receiptCaptures : []).filter(capture => capture.status === 'pending_parse').length;
  }, [receiptCaptures]);

  const parsedReceiptCount = useMemo(() => {
    return (Array.isArray(receiptCaptures) ? receiptCaptures : []).filter(capture => capture.status === 'parsed').length;
  }, [receiptCaptures]);

  const createCaptureRequestId = useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const getDefaultStoreName = useCallback(() => {
    if (activeStore?.name) return activeStore.name;
    if (!activeStoreId) return 'Unknown';
    const match = stores.find(store => store.id === activeStoreId);
    return match?.name || 'Unknown';
  }, [activeStore, activeStoreId, stores]);

  const parseReviewNeededCount = useMemo(() => {
    const total = receiptCaptures.reduce(
      (sum, capture) => sum + safeStat(capture, 'itemsNeedingReview'),
      0
    );
    return total;
  }, [receiptCaptures]);

  const parseCompletedCount = useMemo(() => {
    const total = receiptCaptures.reduce(
      (sum, capture) => sum + safeStat(capture, 'itemsConfirmed'),
      0
    );
    return total;
  }, [receiptCaptures]);

  useEffect(() => {
    receiptCaptures.forEach(capture => {
      if (capture.status === 'parsed') {
        const reviewCount = safeStat(capture, 'itemsNeedingReview');
        if (reviewCount > 0) {
          addToast(
            `Receipt ${capture.storeName || 'Unknown'} needs ${reviewCount} review${reviewCount > 1 ? 's' : ''}.`,
            'info'
          );
        }
      }
    });
  }, [receiptCaptures, addToast]);

  const loadReceiptCaptureForReview = useCallback(async (captureId: string, captureStoreId?: string) => {
    setIsLoadingReceiptCapture(captureId);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load receipt capture');
      }
      const data = await resp.json().catch(() => ({}));
      console.log('[PricingIntelligence]', data);
      const capture = data.capture;
      if (!capture) {
        throw new Error('Receipt capture missing');
      }
      const items = Array.isArray(capture.draftItems) ? capture.draftItems : [];
      const storeName = capture.storeName;
      const activeStoreCandidate = captureStoreId || capture.storeId || activeStoreId;

      if (activeStoreCandidate) {
        setActiveStoreId(activeStoreCandidate);
      }

      const classified = classifyItems(items);
      console.log('[PricingIntelligence]', classified);
      setClassifiedItems(classified);
      setActiveReceiptCaptureId(captureId);
      setShowReceiptReview(true);
      setSelectedItemsForCommit(new Map());
      addToast(`Loaded ${items.length} items for ${storeName || 'receipt'} review.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to load receipt capture', 'error');
    } finally {
      setIsLoadingReceiptCapture(null);
    }
  }, [activeStoreId, addToast, setActiveStoreId]);

  const handleReviewPendingReceipts = useCallback(() => {
    const capture = receiptCaptures.find(entry => entry.status === 'parsed');
    if (capture) {
      void loadReceiptCaptureForReview(capture._id, capture.storeId);
    } else {
      addToast('No parsed receipts ready for review.', 'info');
    }
  }, [addToast, loadReceiptCaptureForReview, receiptCaptures]);

  const fetchReceiptCaptureStats = useCallback(async () => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/receipts-captures-summary`, {
        credentials: 'include'
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (err) {
      return null;
    }
  }, []);

  const handleReceiptImageUploaded = useCallback((photoUrl: string, thumbnailUrl?: string) => {
    setReceiptImageUrl(photoUrl);
    setReceiptThumbnailUrl(thumbnailUrl || photoUrl);
    setShowReceiptScanner(true);
  }, []);

  const handleReceiptScannerClose = useCallback(() => {
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
    setShowReceiptScanner(false);
  }, []);

  const handleCreateReceiptCapture = useCallback(async (storeId?: string, storeName?: string) => {
    if (!receiptImageUrl) return;
    const captureRequestId = createCaptureRequestId();
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId,
          storeName,
          captureRequestId,
          images: [
            {
              url: receiptImageUrl,
              thumbnailUrl: receiptThumbnailUrl || receiptImageUrl
            }
          ]
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Receipt upload failed');
      }

      const data = await resp.json().catch(() => ({}));
      const captureId = data.captureId;

      if (captureId) {
        setActiveReceiptCaptureId(captureId);
        addToast('Receipt uploaded. Parsing will begin shortly.', 'success');
        // Auto-trigger parse immediately after capture
        void handleReceiptParseAuto(captureId);
        void fetchReceiptCaptures();
      } else {
        addToast('Receipt uploaded but no capture ID returned.', 'warning');
      }
    } catch (err: any) {
      addToast(err?.message || 'Receipt upload failed', 'error');
    } finally {
      handleReceiptScannerClose();
    }
  }, [addToast, createCaptureRequestId, fetchReceiptCaptures, handleReceiptScannerClose, receiptImageUrl, receiptThumbnailUrl]);

  const handleOpenReceiptCapture = useCallback(async (capture: ReceiptCapture) => {
    await loadReceiptCaptureForReview(capture._id, capture.storeId);
  }, [loadReceiptCaptureForReview]);

  const handleReceiptQueueClick = useCallback(async () => {
    if (receiptCaptures.length === 0) {
      addToast('No receipts in queue yet.', 'info');
      return;
    }
    const captures = await fetchReceiptCaptures();
    const pendingCapture = receiptCaptures.find(capture => capture.status === 'parsed');
    if (pendingCapture) {
      await loadReceiptCaptureForReview(pendingCapture._id, pendingCapture.storeId);
    }
  }, [addToast, fetchReceiptCaptures, loadReceiptCaptureForReview, receiptCaptures]);

  const handleOpenReceiptScanner = useCallback(() => {
    setShowReceiptScanner(true);
  }, []);

  const handleDeleteReceiptCapture = useCallback(async (captureId: string) => {
    if (!window.confirm('Delete this receipt capture? This cannot be undone.')) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete receipt capture');
      }
      setReceiptCaptures(prev => prev.filter(c => c._id !== captureId));
      addToast('Receipt capture deleted.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete receipt capture', 'error');
    }
  }, [addToast]);

  const handleDeleteNoiseRule = useCallback(async (ruleId: string) => {
    if (!activeStoreId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-noise-rule`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId,
          normalizedName: ruleId
        })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete noise rule');
      }
      setNoiseRules(prev => prev.filter(rule => rule.id !== ruleId));
      addToast('Noise rule removed.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete noise rule', 'error');
    }
  }, [activeStoreId, addToast]);


  const handleStoreSelect = useCallback((id: string) => {
    setActiveStoreId(id);
    setTimelineStoreId(id);
  }, [setActiveStoreId]);

  const handleTimelineStoreSelect = useCallback((storeId: string) => {
    setTimelineStoreId(storeId);
  }, []);

  const handleTimelineProductSelect = useCallback((productId: string) => {
    setTimelineProductId(productId);
  }, []);

  const resetReceiptReview = useCallback(() => {
    setShowReceiptReview(false);
    setActiveReceiptCaptureId(null);
    setClassifiedItems([]);
    setSelectedItemsForCommit(new Map());
  }, []);

  const handleConfirmReceiptItem = useCallback(async (item: ClassifiedReceiptItem) => {
    if (!activeReceiptCaptureId || typeof item.lineIndex !== 'number') return;
    if (!item.suggestedProduct?.id) {
      addToast('No product selected for confirmation.', 'error');
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-item-manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          lineIndex: item.lineIndex,
          productId: item.suggestedProduct.id,
          upc: item.suggestedProduct.upc
        })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to confirm receipt item');
      }

      addToast('Item confirmed successfully.', 'success');
      await loadReceiptCaptureForReview(activeReceiptCaptureId, activeStoreId);
    } catch (err: any) {
      addToast(err?.message || 'Failed to confirm receipt item', 'error');
    }
  }, [activeReceiptCaptureId, activeStoreId, addToast, loadReceiptCaptureForReview]);

  const handleSelectForCommit = useCallback((item: ClassifiedReceiptItem) => {
    const key = getReceiptItemKey(item);
    setSelectedItemsForCommit(prev => {
      const updated = new Map(prev);
      if (updated.has(key)) {
        updated.delete(key);
      } else {
        updated.set(key, true);
      }
      return updated;
    });
  }, [getReceiptItemKey]);

  const handleSelectAllForCommit = useCallback(() => {
    const updated = new Map<string, boolean>();
    classifiedItems.forEach(item => {
      if (item.classification === 'A' && item.suggestedProduct && typeof item.lineIndex === 'number') {
        updated.set(getReceiptItemKey(item), true);
      }
    });
    setSelectedItemsForCommit(updated);
  }, [classifiedItems, getReceiptItemKey]);

  const handleClearSelectedForCommit = useCallback(() => {
    setSelectedItemsForCommit(new Map());
  }, []);

  const toggleReceiptCommitMode = useCallback((mode: 'safe' | 'selected' | 'locked') => {
    if (mode === commitIntent) {
      setCommitIntent(null);
    } else {
      setCommitIntent(mode);
    }
  }, [commitIntent]);

  const handleCommitReceipt = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    if (!commitIntent) {
      addToast('Select a commit mode first.', 'warning');
      return;
    }

    setIsCommitting(true);
    try {
      const idempotencyKey = `rcpt-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const payload: {
        captureId: string;
        mode: 'safe' | 'selected' | 'locked';
        selectedIndices?: number[];
        lockDurationDays?: number;
        idempotencyKey: string;
        finalStoreId?: string;
      } = {
        captureId: activeReceiptCaptureId,
        mode: commitIntent,
        idempotencyKey,
        finalStoreId: activeStoreId || undefined
      };

      if (commitIntent === 'selected') {
        const selectedIndices = classifiedItems
          .filter(item => selectedItemsForCommit.has(getReceiptItemKey(item)))
          .map(item => item.lineIndex)
          .filter((lineIndex): lineIndex is number => typeof lineIndex === 'number');
        if (selectedIndices.length === 0) {
          addToast('Select at least one item to commit.', 'warning');
          setIsCommitting(false);
          return;
        }
        payload.selectedIndices = selectedIndices;
      }

      if (commitIntent === 'locked') {
        payload.lockDurationDays = lockDurationDays;
      }

      const resp = await fetch(`${BACKEND_URL}/api/receipts/${activeReceiptCaptureId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to commit receipt');
      }

      addToast('Receipt items committed successfully.', 'success');
      resetReceiptReview();
      void fetchReceiptCaptures();
      void fetchReceiptCaptureStats();
    } catch (err: any) {
      addToast(err?.message || 'Failed to commit receipt items', 'error');
    } finally {
      setIsCommitting(false);
    }
  }, [
    activeReceiptCaptureId,
    addToast,
    classifiedItems,
    commitIntent,
    fetchReceiptCaptureStats,
    fetchReceiptCaptures,
    getReceiptItemKey,
    lockDurationDays,
    resetReceiptReview,
    selectedItemsForCommit
  ]);

  const handleCreateReceiptFromLiveScan = useCallback(async (items: ClassifiedReceiptItem[]) => {
    if (!receiptImageUrl || !receiptThumbnailUrl) return;
    const captureRequestId = createCaptureRequestId();
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId || undefined,
          storeName: getDefaultStoreName(),
          captureRequestId,
          images: [
            {
              url: receiptImageUrl,
              thumbnailUrl: receiptThumbnailUrl
            }
          ]
        })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Receipt upload failed');
      }

      const data = await resp.json().catch(() => ({}));
      const captureId = data.captureId;

      if (!captureId) {
        throw new Error('Missing capture ID');
      }

      const parseResp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId,
          items
        })
      });

      if (!parseResp.ok) {
        const parseData = await parseResp.json().catch(() => ({}));
        throw new Error(parseData.error || 'Failed to save parsed items');
      }

      addToast('Receipt items saved for review.', 'success');
      setActiveReceiptCaptureId(captureId);
      setShowReceiptReview(true);
      void fetchReceiptCaptures();
      handleReceiptScannerClose();
    } catch (err: any) {
      addToast(err?.message || 'Receipt save failed', 'error');
    }
  }, [
    activeStoreId,
    addToast,
    createCaptureRequestId,
    fetchReceiptCaptures,
    getDefaultStoreName,
    handleReceiptScannerClose,
    receiptImageUrl,
    receiptThumbnailUrl
  ]);

  const handleReceiptScanCapture = useCallback(async (frame: string, mime: string) => {
    if (!frame) {
      addToast('Capture a receipt image before scanning.', 'error');
      return;
    }

    try {
      const storeId = activeStoreId || undefined;
      const storeName = getDefaultStoreName();
      const uploadResult = await uploadReceiptPhoto(frame, storeId, storeName);

      if (!uploadResult) {
        addToast('Cloudinary not configured. Please set up image uploads.', 'error');
        return;
      }

      setReceiptImageUrl(uploadResult.secureUrl);
      setReceiptThumbnailUrl(uploadResult.secureUrl);

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          image: frame,
          storeId
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to scan receipt');
      }

      const data = await resp.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        addToast('No items detected. Try again.', 'warning');
        return;
      }

      const classified = classifyItems(items);
      console.log('[PricingIntelligence]', classified);
      setClassifiedItems(classified);
      setShowReceiptReview(true);
      setShowReceiptScanner(false);
    } catch (err: any) {
      addToast(err?.message || 'Failed to scan receipt', 'error');
    }
  }, [activeStoreId, addToast, getDefaultStoreName]);

  const handleReceiptScannerComplete = useCallback(async (items: ClassifiedReceiptItem[]) => {
    if (!receiptImageUrl || !receiptThumbnailUrl) return;
    await handleCreateReceiptFromLiveScan(items);
  }, [handleCreateReceiptFromLiveScan, receiptImageUrl, receiptThumbnailUrl]);

  const handleReceiptReviewClose = useCallback(() => {
    setShowReceiptReview(false);
  }, []);

  const handleScanItem = useCallback((item: ClassifiedReceiptItem) => {
    setScanTargetItem(item);
    setScanModalOpen(true);
  }, []);

  const handleScannerClose = useCallback(() => {
    setScanModalOpen(false);
    setScanTargetItem(null);
  }, []);

  const linkUpcToProduct = useCallback(async (upc: string, productId: string) => {
    const res = await fetch(`${BACKEND_URL}/api/upc/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ upc, productId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to link UPC');
  }, []);

  const handleScannerScan = useCallback((upc: string) => {
    if (!scanTargetItem) return;
    handleScannerClose();
    setProductSearchItem({ ...scanTargetItem, scannedUpc: upc });
    setProductSearchIntent('attach');
    setProductSearchQuery(upc);
  }, [handleScannerClose, scanTargetItem]);

  const handleSearchProducts = useCallback(async () => {
    if (!productSearchQuery.trim()) return;
    setIsSearchingProducts(true);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/products?search=${encodeURIComponent(productSearchQuery)}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to search products');
      }
      const data = await resp.json().catch(() => ({}));
      console.log('[PricingIntelligence]', data);
      setProductSearchResults(Array.isArray(data.products) ? data.products : []);
    } catch (err: any) {
      addToast(err?.message || 'Failed to search products', 'error');
    } finally {
      setIsSearchingProducts(false);
    }
  }, [addToast, productSearchQuery]);

  const handleProductSelect = useCallback(async (product: ProductSearchResult) => {
    if (!productSearchItem) return;
    if (productSearchIntent === 'attach') {
      if (!productSearchItem.scannedUpc) {
        addToast('Scan UPC before attaching.', 'error');
        return;
      }
      try {
        await linkUpcToProduct(productSearchItem.scannedUpc, product.productId);
        addToast('UPC linked to product.', 'success');
      } catch (err: any) {
        addToast(err?.message || 'Failed to link UPC', 'error');
      }
    }

    setProductSearchItem(null);
    setProductSearchQuery('');
    setProductSearchResults([]);
  }, [addToast, linkUpcToProduct, productSearchIntent, productSearchItem]);

  const handleCreateProduct = useCallback(async () => {
    if (!createProductItem) return;
    if (!activeStoreId) {
      addToast('Select a store before creating product.', 'error');
      return;
    }

    try {
      setIsCreatingProduct(true);

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-create-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId,
          item: {
            receiptName: createProductItem.receiptName,
            normalizedName: createProductItem.normalizedName,
            totalPrice: createProductItem.totalPrice,
            quantity: createProductItem.quantity,
            unitPrice: createProductItem.unitPrice
          },
          product: createProductDraft
        })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create product');
      }

      addToast('Product created successfully.', 'success');
      setCreateProductItem(null);
      setCreateProductDraft({
        name: '',
        category: '',
        sizeOz: 0,
        price: 0,
        isTaxable: null,
        depositEligible: null
      });
      await fetchReceiptCaptures();
    } catch (err: any) {
      addToast(err?.message || 'Failed to create product', 'error');
    } finally {
      setIsCreatingProduct(false);
    }
  }, [activeStoreId, addToast, createProductDraft, createProductItem, fetchReceiptCaptures]);

  const dismissCreateProduct = useCallback(() => {
    if (!createProductItem) return;
    const key = getReceiptItemKey(createProductItem);
    setDismissedCreateItems(prev => new Set(prev).add(key));
    setCreateProductItem(null);
  }, [createProductItem, getReceiptItemKey]);

  const isCreateProductReady = useMemo(() => {
    return Boolean(createProductDraft.name && createProductDraft.price > 0);
  }, [createProductDraft]);

  const handleResetReceiptReview = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-reset-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reset receipt review');
      }
      addToast('Receipt review reopened.', 'success');
      await loadReceiptCaptureForReview(activeReceiptCaptureId, activeStoreId);
    } catch (err: any) {
      addToast(err?.message || 'Failed to reset receipt review', 'error');
    }
  }, [activeReceiptCaptureId, activeStoreId, addToast, loadReceiptCaptureForReview]);

  const handleLockReceipt = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          days: lockDurationDays
        })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to lock receipt');
      }
      addToast(`Receipt locked for ${lockDurationDays} days.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to lock receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast, lockDurationDays]);

  const handleUnlockReceipt = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to unlock receipt');
      }
      addToast('Receipt unlocked.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to unlock receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast]);

  const handleReceiptCommitMode = useCallback((mode: 'safe' | 'selected' | 'locked') => {
    if (commitIntent === mode) {
      setCommitIntent(null);
    } else {
      setCommitIntent(mode);
    }
  }, [commitIntent]);

  const handleReceiptConfirm = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId: activeReceiptCaptureId })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to confirm receipt');
      }
      addToast('Receipt items confirmed.', 'success');
      await loadReceiptCaptureForReview(activeReceiptCaptureId, activeStoreId);
    } catch (err: any) {
      addToast(err?.message || 'Failed to confirm receipt items', 'error');
    }
  }, [activeReceiptCaptureId, activeStoreId, addToast, loadReceiptCaptureForReview]);

  const handleReceiptParse = useCallback(async () => {
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
      await loadReceiptCaptureForReview(activeReceiptCaptureId, activeStoreId);
      await fetchReceiptCaptures();
    } catch (err: any) {
      addToast(err?.message || 'Failed to parse receipt', 'error');
    }
  }, [activeReceiptCaptureId, activeStoreId, addToast, fetchReceiptCaptures, loadReceiptCaptureForReview]);

  const handleReceiptUpload = useCallback(async (file: File) => {
    if (!activeStoreId) {
      addToast('Select a store before uploading receipts.', 'warning');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const uploadResult = await uploadReceiptPhoto(dataUrl, activeStoreId, getDefaultStoreName());
      if (!uploadResult) {
        addToast('Cloudinary not configured. Please set up image uploads.', 'error');
        return;
      }
      const captureRequestId = createCaptureRequestId();
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId,
          storeName: getDefaultStoreName(),
          captureRequestId,
          images: [
            {
              url: uploadResult.secureUrl,
              thumbnailUrl: uploadResult.secureUrl
            }
          ]
        })
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Receipt upload failed');
      }

      const data = await resp.json().catch(() => ({}));
      const captureId = data.captureId;

      if (captureId) {
        await loadReceiptCaptureForReview(captureId, activeStoreId);
        addToast('Receipt uploaded and ready for parsing.', 'success');
        // Auto-trigger parse immediately after capture
        void handleReceiptParseAuto(captureId);
      }
    } catch (err: any) {
      addToast(err?.message || 'Receipt upload failed', 'error');
    }
  }, [activeStoreId, addToast, createCaptureRequestId, getDefaultStoreName, loadReceiptCaptureForReview]);

  const handleReceiptParseAuto = useCallback(async (captureId: string) => {
    if (!captureId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to parse receipt');
      }
      addToast('Receipt parsing started.', 'success');
      await fetchReceiptCaptures();
    } catch (err: any) {
      addToast(err?.message || 'Failed to parse receipt', 'error');
    }
  }, [addToast, fetchReceiptCaptures]);

  const handleAddNoiseRule = useCallback(async (normalizedName: string) => {
    if (!activeStoreId) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-noise-rule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ storeId: activeStoreId, normalizedName })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add noise rule');
      }
      addToast('Noise rule added.', 'success');
      void fetchNoiseRules();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add noise rule', 'error');
    }
  }, [activeStoreId, addToast, fetchNoiseRules]);

  const handleCommitReceiptChanges = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    try {
      const idempotencyKey = `rcpt-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const resp = await fetch(`${BACKEND_URL}/api/receipts/${activeReceiptCaptureId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          mode: 'safe',
          idempotencyKey,
          finalStoreId: activeStoreId || undefined
        })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to commit receipt');
      }
      addToast('Receipt committed successfully.', 'success');
      resetReceiptReview();
      void fetchReceiptCaptures();
      void fetchReceiptCaptureStats();
    } catch (err: any) {
      addToast(err?.message || 'Failed to commit receipt', 'error');
    }
  }, [activeReceiptCaptureId, addToast, fetchReceiptCaptureStats, fetchReceiptCaptures, resetReceiptReview]);

  const handleUploadReceiptImage = useCallback(async (file: File) => {
    if (!file) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const uploadResult = await uploadReceiptPhoto(dataUrl, activeStoreId || undefined, getDefaultStoreName());
      if (!uploadResult) {
        addToast('Cloudinary not configured. Please set up image uploads.', 'error');
        return;
      }
      setReceiptImageUrl(uploadResult.secureUrl);
      setReceiptThumbnailUrl(uploadResult.secureUrl);
      setShowReceiptScanner(true);
    } catch (err: any) {
      addToast(err?.message || 'Failed to upload receipt', 'error');
    }
  }, [activeStoreId, addToast, getDefaultStoreName]);

  const handleReceiptScannerSubmit = useCallback(async (items: ClassifiedReceiptItem[]) => {
    if (!receiptImageUrl || !receiptThumbnailUrl) return;
    await handleCreateReceiptFromLiveScan(items);
  }, [handleCreateReceiptFromLiveScan, receiptImageUrl, receiptThumbnailUrl]);

  const handleReceiptScanParse = useCallback(async (items: ClassifiedReceiptItem[]) => {
    if (!receiptImageUrl || !receiptThumbnailUrl) return;
    await handleCreateReceiptFromLiveScan(items);
  }, [handleCreateReceiptFromLiveScan, receiptImageUrl, receiptThumbnailUrl]);

  const handleReceiptParseClick = useCallback(async () => {
    if (!activeReceiptCaptureId) return;
    await handleReceiptParse();
  }, [activeReceiptCaptureId, handleReceiptParse]);

  const handleOpenReceiptReview = useCallback(() => {
    if (!activeReceiptCaptureId) return;
    setShowReceiptReview(true);
  }, [activeReceiptCaptureId]);

  const handleCloseReceiptReview = useCallback(() => {
    setShowReceiptReview(false);
  }, []);

  const handleReceiptUploadFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void handleUploadReceiptImage(file);
    event.target.value = '';
  }, [handleUploadReceiptImage]);

  const handleReceiptUploadDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void handleUploadReceiptImage(file);
  }, [handleUploadReceiptImage]);

  const handleSelectedStoreIdChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const storeId = event.target.value;
    setActiveStoreId(storeId);
  }, [setActiveStoreId]);

  const handleStoreRefresh = useCallback(async () => {
    setStoreError(null);
    try {
      await refreshStores();
    } catch (err: any) {
      setStoreError(err?.message || 'Failed to refresh stores');
    }
  }, [refreshStores, setStoreError]);

  const handleOpenReceiptQueue = useCallback(async () => {
    if (!receiptCaptures.length) {
      addToast('No receipts in queue yet.', 'info');
      return;
    }
    const capture = receiptCaptures.find(entry => entry.status === 'parsed');
    if (!capture) {
      addToast('No parsed receipts ready for review.', 'info');
      return;
    }
    await loadReceiptCaptureForReview(capture._id, capture.storeId);
  }, [addToast, loadReceiptCaptureForReview, receiptCaptures]);

  const handleOpenPriceReview = useCallback(() => {
    if (priceReviewItems.length > 0) {
      setShowReceiptReview(true);
    }
  }, [priceReviewItems.length]);

  const handlePriceReviewOpen = useCallback(() => {
    if (priceReviewItems.length > 0) {
      setShowReceiptReview(true);
    }
  }, [priceReviewItems.length]);

  const handleOpenReceiptScannerNow = useCallback(async () => {
    setShowReceiptScanner(true);
  }, []);

  const handleOpenReceiptScannerForUpload = useCallback(async () => {
    setShowReceiptScanner(true);
  }, []);

  const handleOpenReceiptReviewQueue = useCallback(async () => {
    await handleReviewPendingReceipts();
  }, [handleReviewPendingReceipts]);

  const handleDeleteReceiptQueueItem = useCallback(async (captureId: string) => {
    try {
      await handleDeleteReceiptCapture(captureId);
    } catch (err: any) {
      if (err?.message?.includes('404')) {
        addToast('Receipt not found or already deleted.', 'warning');
      } else {
        addToast(err?.message || 'Failed to delete receipt.', 'error');
      }
    }
  }, [handleDeleteReceiptCapture, addToast]);

  const handleReceiptCaptureComplete = useCallback(async (imageUrl: string, thumbnailUrl?: string) => {
    setReceiptImageUrl(imageUrl);
    setReceiptThumbnailUrl(thumbnailUrl || imageUrl);
    setShowReceiptScanner(true);
  }, []);

  const handleOpenReceiptCaptureFlow = useCallback(async () => {
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
    setShowReceiptScanner(true);
  }, []);

  const handleReceiptQueueReview = useCallback(async () => {
    await handleReviewPendingReceipts();
  }, [handleReviewPendingReceipts]);

  const handleReceiptScannerAction = useCallback(async (frame: string, mime: string) => {
    await handleReceiptScanCapture(frame, mime);
  }, [handleReceiptScanCapture]);

  const handleReceiptScannerSubmitAction = useCallback(async (items: ClassifiedReceiptItem[]) => {
    await handleReceiptScannerSubmit(items);
  }, [handleReceiptScannerSubmit]);

  const handleReceiptParseAutoAction = useCallback(async (captureId: string) => {
    await handleReceiptParseAuto(captureId);
  }, [handleReceiptParseAuto]);

  const handleReceiptCommitChanges = useCallback(async () => {
    await handleCommitReceiptChanges();
  }, [handleCommitReceiptChanges]);

  const handleSelectStoreForTimeline = useCallback((storeId: string) => {
    setTimelineStoreId(storeId);
  }, []);

  const handleSelectProductForTimeline = useCallback((productId: string) => {
    setTimelineProductId(productId);
  }, []);

  const handleReceiptUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void handleReceiptUpload(file);
    event.target.value = '';
  }, [handleReceiptUpload]);

  const handleReceiptUploadDropZone = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void handleReceiptUpload(file);
  }, [handleReceiptUpload]);

  const handleReceiptUploadDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  }, []);

  const handleReceiptUploadDragLeave = useCallback(() => {}, []);


  useEffect(() => {
    if (showReceiptReview && activeReceiptCaptureId) {
      void loadReceiptCaptureForReview(activeReceiptCaptureId, activeStoreId);
    }
  }, [activeReceiptCaptureId, activeStoreId, loadReceiptCaptureForReview, showReceiptReview]);

  useEffect(() => {
    if (productSearchQuery.length >= 2) {
      void handleSearchProducts();
    } else {
      setProductSearchResults([]);
    }
  }, [handleSearchProducts, productSearchQuery]);

  useEffect(() => {
    // Removed auto-create timer: receipt captures must be user-initiated
    // to avoid duplicates and comply with backend idempotency contracts.
    // Keep this effect as a no-op; capture creation happens via explicit UI actions.
    return undefined;
  }, [activeStoreId, getDefaultStoreName, handleCreateReceiptCapture, receiptImageUrl, receiptThumbnailUrl, showReceiptScanner]);

  useEffect(() => {
    if (showReceiptReview && activeReceiptCaptureId) {
      void fetchReceiptCaptureStats();
    }
  }, [activeReceiptCaptureId, fetchReceiptCaptureStats, showReceiptReview]);

  const statusBadge = useMemo(() => {
    if (!activeReceiptCaptureId) return null;
    const capture = receiptCaptures.find(item => item._id === activeReceiptCaptureId);
    if (!capture) return null;
    const statusLabel = getSafeCaptureStatus(capture.status);
    return (
      <span
        className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded ${
          capture.status === 'parsed'
            ? 'bg-yellow-500 text-yellow-900'
            : capture.status === 'review_complete'
            ? 'bg-green-500 text-green-900'
            : 'bg-gray-500 text-gray-900'
        }`}
      >
        {statusLabel}
      </span>
    );
  }, [receiptCaptures]);

  const sortedReceiptCaptures = useMemo(() => {
    return [...receiptCaptures].sort((a, b) => {
      const aIsParsed = a.status === 'parsed';
      const bIsParsed = b.status === 'parsed';
      if (aIsParsed && !bIsParsed) return -1;
      if (!aIsParsed && bIsParsed) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [receiptCaptures]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-black uppercase text-white tracking-widest">Pricing Intelligence</h2>
              <p className="text-xs text-slate-300">Unified receipt capture + review control center.</p>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge}
              <button
                onClick={handleStoreRefresh}
                className="text-xs text-slate-300 px-3 py-1 rounded-full border border-white/10 hover:border-white/30"
              >
                Refresh Stores
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Parsed Receipts</p>
              <p className="text-xl text-white font-black">{parsedReceiptCount}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Pending Items</p>
              <p className="text-xl text-white font-black">{parseReviewNeededCount}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Confirmed Items</p>
              <p className="text-xl text-white font-black">{parseCompletedCount}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">Queue Pending</p>
              <p className="text-xl text-white font-black">{pendingReceiptCount}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 rounded-2xl p-6 border border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black uppercase text-white tracking-widest">Upload Receipt</h3>
              <p className="text-xs text-indigo-200 mt-2">Capture or upload a receipt image for parsing.</p>
            </div>
            <label className="cursor-pointer text-[10px] uppercase tracking-widest font-black text-indigo-200 border border-indigo-300/40 rounded-full px-3 py-2 hover:bg-indigo-500/20">
              Upload
              <input type="file" accept="image/*" className="hidden" onChange={handleReceiptUploadInput} />
            </label>
          </div>
          <div className="mt-4 space-y-3">
            <button
              onClick={handleOpenReceiptScannerNow}
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold hover:bg-white/20"
            >
              Open Receipt Scanner
            </button>
            <label
              onDrop={handleReceiptUploadDropZone}
              onDragOver={handleReceiptUploadDragOver}
              onDragLeave={handleReceiptUploadDragLeave}
              className="block border border-dashed border-indigo-300/40 rounded-xl p-4 text-xs text-indigo-200 text-center"
            >
              Drag & drop a receipt image here.
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black uppercase text-white tracking-widest">Store Summary</h3>
                <p className="text-xs text-slate-300">Select a store to review receipt metrics and price deltas.</p>
              </div>
              <select
                value={activeStoreId}
                onChange={handleSelectedStoreIdChange}
                className="bg-slate-900 border border-white/10 text-white text-xs rounded-full px-3 py-2"
              >
                <option value="">Select Store</option>
                {(Array.isArray(stores) ? stores : []).map(store => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            {storeError && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {storeError}
              </p>
            )}

            {activeStore ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400">Active Store</p>
                  <p className="text-white font-semibold mt-1">{activeStore.name}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatStoreAddress(activeStore.address, 'No address provided')}
                  </p>
                </div>
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400">Receipt Activity</p>
                  <p className="text-white text-sm mt-1">
                    {parsedReceiptCount} parsed, {pendingReceiptCount} pending
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {parseReviewNeededCount} items need review
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-4">Select a store to see receipt stats.</p>
            )}
          </div>

          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  Review Pending Receipts
                </h3>
                <p className="text-sm text-purple-100 mt-2">Pending receipts awaiting review.</p>
                <p className="text-xs text-purple-100/80 mt-1">Capture new receipts from the Upload Receipt card.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-purple-100">
                  {pendingReceiptCount} pending receipts
                </span>
                <button
                  onClick={handleReviewPendingReceipts}
                  disabled={pendingReceiptCount === 0}
                  className={`px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-2 transition-all ${
                    pendingReceiptCount === 0
                      ? 'bg-white/10 text-white/50 cursor-not-allowed'
                      : 'bg-white/20 hover:bg-white/30'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Review Queue
                </button>
              </div>
            </div>

            {Array.isArray(sortedReceiptCaptures) && sortedReceiptCaptures.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedReceiptCaptures.map(capture => (
                  <div
                    key={capture._id}
                    className="bg-white/10 backdrop-blur-sm rounded-lg p-4 hover:bg-white/20 transition-all border border-white/10 group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex-1">
                        <span className="text-white font-bold text-sm">{capture.storeName}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            capture.status === 'parsed'
                              ? 'bg-yellow-500 text-yellow-900'
                              : capture.status === 'review_complete'
                              ? 'bg-green-500 text-green-900'
                              : 'bg-gray-500 text-gray-900'
                          }`}
                        >
                          {capture.status.replace(/_/g, ' ')}
                        </span>

                        <button
                          onClick={event => {
                            event.stopPropagation();
                            handleDeleteReceiptCapture(capture._id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/30 rounded text-red-400 hover:text-red-300"
                          title="Delete this receipt"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {capture.status === 'pending_parse' && (
                          <button
                            onClick={event => {
                              event.stopPropagation();
                              handleRetryParse(capture._id);
                            }}
                            className="ml-2 px-2 py-1 rounded bg-yellow-500 text-yellow-900 text-[10px] font-bold hover:bg-yellow-600"
                            title="Retry Parse"
                          >
                            Retry Parse
                          </button>
                        )}
                        // Retry parse for stuck receipts
                        const handleRetryParse = useCallback(async (captureId: string) => {
                          try {
                            await handleReceiptParseAuto(captureId);
                            addToast('Parse retried.', 'info');
                          } catch (err: any) {
                            addToast(err?.message || 'Failed to retry parse.', 'error');
                          }
                        }, [handleReceiptParseAuto, addToast]);
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-purple-100 space-y-1">
                        <div>
                          {capture.imageCount} photo{capture.imageCount !== 1 ? 's' : ''}
                        </div>
                        <div>
                          {typeof safeStat(capture, 'itemsConfirmed') === 'number' && typeof safeStat(capture, 'totalItems') === 'number' && (safeStat(capture, 'totalItems') > 0 || safeStat(capture, 'itemsConfirmed') > 0)
                            ? `${safeStat(capture, 'itemsConfirmed')}/${safeStat(capture, 'totalItems')} items confirmed`
                            : '— items confirmed'}
                        </div>
                        <div className="text-[11px] text-purple-100/80">
                          <span className="font-semibold">Captured by:</span>{' '}
                          <span title={capture.createdByUserId || 'unknown'}>
                            {formatReceiptRole(capture.createdByRole)} ({formatReceiptUserId(capture.createdByUserId)})
                          </span>
                        </div>
                        <div className="text-[11px] text-purple-100/80">
                          <span className="font-semibold">Source:</span> {formatReceiptSource(capture.source)}
                        </div>

                        {capture.workflowStats && (
                          <div className="flex items-center gap-2 mt-2">
                            {capture.workflowStats.newProducts && capture.workflowStats.newProducts > 0 ? (
                              <span className="bg-orange-500/30 text-orange-200 text-xs px-2 py-1 rounded">
                                {capture.workflowStats.newProducts} NEW
                              </span>
                            ) : null}
                            {capture.workflowStats.priceUpdates && capture.workflowStats.priceUpdates > 0 ? (
                              <span className="bg-blue-500/30 text-blue-200 text-xs px-2 py-1 rounded">
                                {capture.workflowStats.priceUpdates} PRICES
                              </span>
                            ) : null}
                          </div>
                        )}

                        {safeStat(capture, 'itemsNeedingReview') > 0 && (
                          <div className="text-yellow-300 font-semibold">
                            {safeStat(capture, 'itemsNeedingReview')} need review
                          </div>
                        )}
                      </div>

                      <div className="mt-3 text-xs text-purple-200">
                        {fmtTime(capture.createdAt)}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => handleOpenReceiptCapture(capture)}
                          disabled={capture.status !== 'parsed' || isLoadingReceiptCapture === capture._id}
                          className={`px-3 py-2 rounded-lg text-[10px] font-semibold border transition ${
                            capture.status !== 'parsed' || isLoadingReceiptCapture === capture._id
                              ? 'border-white/20 text-white/50 bg-white/10 cursor-not-allowed'
                              : 'border-white/30 text-white bg-white/20 hover:bg-white/30'
                          }`}
                        >
                          {isLoadingReceiptCapture === capture._id ? 'Loading…' : 'Review Items'}
                        </button>
                        {capture.status !== 'parsed' && (
                          <span className="text-[10px] text-purple-100/70">
                            Awaiting parse
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-purple-100/80">No pending receipts awaiting review.</div>
            )}
          </div>

          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 border border-white/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black uppercase text-white tracking-widest">
                  Review Price Changes
                </h3>
                <p className="text-sm text-emerald-100 mt-2">
                  Flagged deltas over ${priceDeltaThreshold.toFixed(2)} from recent receipts.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-emerald-100">
                  {priceReviewItems.length} flagged
                </span>
                <button
                  onClick={handleOpenPriceReview}
                  disabled={priceReviewItems.length === 0}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border ${
                    priceReviewItems.length === 0
                      ? 'border-white/20 text-white/50 bg-white/10'
                      : 'border-white/30 text-white bg-white/20 hover:bg-white/30'
                  }`}
                >
                  Open Review
                </button>
              </div>
            </div>

            {!activeStoreId ? (
              <div className="mt-4 text-xs text-emerald-100/80">
                Select an active store to see price deltas.
              </div>
            ) : priceReviewItems.length === 0 ? (
              <div className="mt-4 text-xs text-emerald-100/80">
                No price changes exceed the threshold yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {(Array.isArray(priceReviewItems) ? priceReviewItems : []).map(({
                  captureId,
                  receiptName,
                  unitPrice,
                  suggestedProduct,
                  matchConfidence
                }, idx) => (
                  <div
                    key={`${captureId}:${idx}`}
                    className="bg-white/10 rounded-xl p-4 flex items-start justify-between gap-4"
                  >
                    <div>
                      <p className="text-white font-semibold">{receiptName}</p>
                      <p className="text-xs text-emerald-100 mt-1">
                        {suggestedProduct?.name || 'Unknown Product'}
                      </p>
                      <p className="text-[10px] text-emerald-100/80 mt-1">
                        Unit price: ${unitPrice?.toFixed?.(2) ?? '—'} • Confidence: {Math.round((matchConfidence || 0) * 100)}%
                      </p>
                    </div>
                    <button
                      onClick={() => handleOpenReceiptCapture({ _id: captureId } as ReceiptCapture)}
                      className="px-3 py-2 rounded-lg text-[10px] font-semibold border border-white/30 text-white bg-white/20 hover:bg-white/30"
                    >
                      Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {showReceiptScanner && (
        <ReceiptCaptureFlow
          stores={stores}
          isOpen={showReceiptScanner}
          onClose={handleReceiptScannerClose}
          onImageUploaded={handleReceiptImageUploaded}
          onParsedItems={handleReceiptScannerComplete}
          onCaptureComplete={handleReceiptCaptureComplete}
          onCaptureParse={handleReceiptScannerAction}
          storeId={activeStoreId}
          storeName={getDefaultStoreName()}
        />
      )}

      {showReceiptReview && activeReceiptCaptureId && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-6xl w-full h-[85vh] overflow-y-auto">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-white font-black uppercase text-lg tracking-widest">Receipt Review</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Capture ID: {activeReceiptCaptureId}</p>
              </div>
              <button
                onClick={handleReceiptReviewClose}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={handleReceiptParseClick}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
                >
                  Parse Receipt
                </button>
                <button
                  onClick={handleReceiptConfirm}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
                >
                  Confirm All
                </button>
                <button
                  onClick={handleResetReceiptReview}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
                >
                  Reset Review
                </button>
                <button
                  onClick={handleLockReceipt}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
                >
                  Lock {lockDurationDays}d
                </button>
                <button
                  onClick={handleUnlockReceipt}
                  className="px-4 py-2 rounded-full text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20"
                >
                  Unlock
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
                <div className="space-y-4">
                  {classifiedItems.length === 0 ? (
                    <div className="text-xs text-slate-400">No items to review.</div>
                  ) : (
                    (Array.isArray(classifiedItems) ? classifiedItems : []).map((item, idx) => (
                      <ReceiptItemBucket
                        key={`${item.captureId}:${item.lineIndex ?? idx}`}
                        item={item}
                        onConfirm={handleConfirmReceiptItem}
                        onScan={handleScanItem}
                        onSearchProduct={() => {
                          setProductSearchItem(item);
                          setProductSearchIntent('match');
                          setProductSearchQuery(item.receiptName || '');
                        }}
                        onCreateProduct={() => setCreateProductItem(item)}
                        onSelectForCommit={() => handleSelectForCommit(item)}
                        selectedForCommit={selectedItemsForCommit.has(getReceiptItemKey(item))}
                        onAddNoiseRule={() => handleAddNoiseRule(item.normalizedName || '')}
                      />
                    ))
                  )}
                </div>

                <div className="space-y-4">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">Commit Summary</p>
                    <p className="text-sm text-white font-semibold mt-2">{selectedForCommitCount} selected</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => handleReceiptCommitMode('safe')}
                        className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                          commitIntent === 'safe'
                            ? 'border-white/50 text-white bg-white/20'
                            : 'border-white/10 text-slate-300'
                        }`}
                      >
                        Safe
                      </button>
                      <button
                        onClick={() => handleReceiptCommitMode('selected')}
                        className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                          commitIntent === 'selected'
                            ? 'border-white/50 text-white bg-white/20'
                            : 'border-white/10 text-slate-300'
                        }`}
                      >
                        Selected
                      </button>
                      <button
                        onClick={() => handleReceiptCommitMode('locked')}
                        className={`px-3 py-2 rounded-full text-[10px] font-semibold border ${
                          commitIntent === 'locked'
                            ? 'border-white/50 text-white bg-white/20'
                            : 'border-white/10 text-slate-300'
                        }`}
                      >
                        Locked
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={handleSelectAllForCommit}
                        className="px-3 py-2 rounded-full text-[10px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleClearSelectedForCommit}
                        className="px-3 py-2 rounded-full text-[10px] font-semibold border border-white/10 text-slate-300 hover:bg-white/10"
                      >
                        Clear Selection
                      </button>
                    </div>

                    <button
                      onClick={handleCommitReceipt}
                      disabled={!commitIntent || isCommitting}
                      className="mt-4 w-full px-4 py-3 rounded-2xl text-xs font-semibold border border-white/20 text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCommitting ? 'Committing…' : 'Commit Items'}
                    </button>
                  </div>
                  </div>
                </div>
            </div>
          </div>
        </div>
      )}

      {scanModalOpen && (
        <ScannerModal
          mode={ScannerMode.RECEIPT_PARSE_LIVE}
          onScan={handleScannerScan}
          onClose={handleScannerClose}
          title="Scan UPC"
          subtitle="Scan the product UPC to attach"
          beepEnabled={settings?.beepEnabled ?? true}
          cooldownMs={settings?.cooldownMs ?? 2000}
          isOpen={scanModalOpen}
        />
      )}

      {createProductItem && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-black uppercase text-sm tracking-widest">Create Product</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                  Unknown/New item: {createProductItem.receiptName}
                </p>
              </div>
              <button
                onClick={() => dismissCreateProduct()}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
                <span>Canonical Name</span>
                <input
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="e.g. Coca-Cola 12oz"
                  value={createProductDraft.name}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, name: e.target.value }))}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Category</span>
                <select
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={createProductDraft.category}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="" disabled>Select category</option>
                  <option value="DRINK">Drink</option>
                  <option value="SNACK">Snack</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Size (oz)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={createProductDraft.sizeOz}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, sizeOz: Number(e.target.value) }))}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Taxability</span>
                <select
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={
                    createProductDraft.depositEligible === null
                      ? ''
                      : createProductDraft.depositEligible
                      ? 'eligible'
                      : 'not-eligible'
                  }
                  onChange={e => {
                    const value = e.target.value;
                    setCreateProductDraft(prev => ({
                      ...prev,
                      depositEligible: value === '' ? null : value === 'eligible'
                    }));
                  }}
                >
                  <option value="" disabled>Select deposit eligibility</option>
                  <option value="eligible">Eligible (MI 10¢)</option>
                  <option value="not-eligible">Not eligible</option>
                </select>
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Base Price ($)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={createProductDraft.price}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, price: Number(e.target.value) }))}
                />
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => dismissCreateProduct()}
                className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProduct}
                disabled={isCreatingProduct || !isCreateProductReady}
                className="flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 bg-ninpo-lime text-ninpo-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isCreatingProduct ? 'Creating…' : 'Create Product & Store Inventory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {productSearchItem && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-black uppercase text-sm tracking-widest">{productSearchIntent === 'attach' ? 'Attach to Existing' : 'Search Catalog'}</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                  Match: {productSearchItem.receiptName}
                  {productSearchIntent === 'attach' && productSearchItem.scannedUpc ? ` • UPC: ${productSearchItem.scannedUpc}` : ''}
                </p>
              </div>
              <button
                onClick={() => {
                  setProductSearchItem(null);
                  setProductSearchIntent('match');
                }}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <input
              value={productSearchQuery}
              onChange={e => setProductSearchQuery(e.target.value)}
              placeholder="Search by name, SKU, or UPC"
              className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 text-sm text-white"
            />

            {isLoadingProducts || isSearchingProducts ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading products…
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {Array.isArray(filteredProducts) && filteredProducts.length === 0 ? (
                  <p className="text-xs text-slate-500">No products match this search.</p>
                ) : (
                  (Array.isArray(filteredProducts) ? filteredProducts : []).map(product => (
                    <button
                      key={product.productId}
                      onClick={() => void handleProductSelect(product)}
                      className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10"
                    >
                      <div className="text-sm text-white font-semibold">{product.name}</div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {product.sku ? `SKU: ${product.sku}` : 'SKU: —'}
                        {product.upc ? ` • UPC: ${product.upc}` : ''}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  );
};

export default ManagementPricingIntelligence;
