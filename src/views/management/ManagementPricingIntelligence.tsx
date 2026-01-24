import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Trash2, Loader2, CheckCircle2, Check } from 'lucide-react';
import {
  ApprovalRequest,
  AuditLog,
  AuditLogType,
  ClassifiedReceiptItem,
  Product,
  ReceiptItemClassification,
  ScannerMode,
  StoreRecord,
  UnmappedUpcData,
  UpcItem
} from '../../types';
import { BACKEND_URL } from '../../constants';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import ReceiptItemBucket from '../../components/ReceiptItemBucket';
import ScannerModal from '../../components/ScannerModal';
import { uploadReceiptPhoto } from '../../utils/cloudinaryUtils';
import { classifyItems } from '../../utils/classificationUtils';
import ManagementApprovals from './ManagementApprovals';
import ManagementAuditLogs from './ManagementAuditLogs';
import ManagementStores from './ManagementStores';
import ManagementUpcRegistry from './ManagementUpcRegistry';
import { UPC_CONTAINER_LABELS } from './constants';

interface ReceiptCapture {
  _id: string;
  storeId: string;
  storeName: string;
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

interface StoreInventoryEntry {
  _id: string;
  storeId: string;
  productId?: string | { _id?: string; id?: string };
  product?: {
    _id?: string;
    id?: string;
    name?: string;
    sku?: string;
    upc?: string;
    price?: number;
  };
  observedPrice?: number;
  observedAt?: string;
  priceHistory?: PriceHistoryEntry[];
}

interface ManagementPricingIntelligenceProps {
  setScannerMode: (mode: ScannerMode) => void;
  setScannerModalOpen: (open: boolean) => void;
  approvalFilter: ApprovalRequest['status'];
  setApprovalFilter: (status: ApprovalRequest['status']) => void;
  filteredApprovals: ApprovalRequest[];
  handleApprove: (approval: ApprovalRequest) => void;
  handleReject: (id: string) => void;
  setSelectedApproval: (approval: ApprovalRequest | null) => void;
  setPreviewPhoto: (photo: string | null) => void;
  fmtTime: (iso?: string) => string;
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoadingStores: boolean;
  storeError: string | null;
  setStoreError: (err: string | null) => void;
  upcItems: UpcItem[];
  setUpcItems: (items: UpcItem[]) => void;
  upcInput: string;
  setUpcInput: (value: string) => void;
  upcDraft: UpcItem;
  setUpcDraft: (draft: UpcItem) => void;
  upcFilter: string;
  setUpcFilter: (value: string) => void;
  isUpcLoading: boolean;
  isUpcSaving: boolean;
  upcError: string | null;
  apiLoadUpcItems: () => Promise<void>;
  handleUpcLookup: (upc?: string) => void;
  apiSaveUpc: () => Promise<void>;
  apiDeleteUpc: () => Promise<void>;
  apiDeleteUpcDirect: (upc: string) => Promise<void>;
  apiLinkUpc: (upc: string, productId: string) => Promise<void>;
  filteredUpcItems: UpcItem[];
  loadUpcDraft: (entry: UpcItem) => void;
  products: Product[];
  unmappedUpcModalOpen: boolean;
  setUnmappedUpcModalOpen: (open: boolean) => void;
  unmappedUpcPayload: UnmappedUpcData | null;
  setUnmappedUpcPayload: (payload: UnmappedUpcData | null) => void;
  filteredAuditLogs: AuditLog[];
  auditTypeFilter: 'ALL' | AuditLogType;
  setAuditTypeFilter: (type: 'ALL' | AuditLogType) => void;
  auditActorFilter: string;
  setAuditActorFilter: (actor: string) => void;
  auditRangeFilter: '24h' | '7d' | '30d';
  setAuditRangeFilter: (range: '24h' | '7d' | '30d') => void;
  auditTypeOptions: (string | AuditLogType)[];
  isAuditLogsLoading: boolean;
  auditLogsError: string | null;
  handleDownloadAuditCsv: () => void;
  runAuditSummary: () => void;
  auditSummary: string | null;
  isAuditSummaryLoading: boolean;
}

const isMongoId = (value: string) => /^[a-f0-9]{24}$/i.test(value);

const ManagementPricingIntelligence: React.FC<ManagementPricingIntelligenceProps> = ({
  setScannerMode,
  setScannerModalOpen,
  approvalFilter,
  setApprovalFilter,
  filteredApprovals,
  handleApprove,
  handleReject,
  setSelectedApproval,
  setPreviewPhoto,
  fmtTime,
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoadingStores,
  storeError,
  setStoreError,
  upcItems,
  setUpcItems,
  upcInput,
  setUpcInput,
  upcDraft,
  setUpcDraft,
  upcFilter,
  setUpcFilter,
  isUpcLoading,
  isUpcSaving,
  upcError,
  apiLoadUpcItems,
  handleUpcLookup,
  apiSaveUpc,
  apiDeleteUpc,
  apiDeleteUpcDirect,
  apiLinkUpc,
  filteredUpcItems,
  loadUpcDraft,
  products,
  unmappedUpcModalOpen,
  setUnmappedUpcModalOpen,
  unmappedUpcPayload,
  setUnmappedUpcPayload,
  filteredAuditLogs,
  auditTypeFilter,
  setAuditTypeFilter,
  auditActorFilter,
  setAuditActorFilter,
  auditRangeFilter,
  setAuditRangeFilter,
  auditTypeOptions,
  isAuditLogsLoading,
  auditLogsError,
  handleDownloadAuditCsv,
  runAuditSummary,
  auditSummary,
  isAuditSummaryLoading
}) => {
  const { addToast, fetchProducts, setProducts, settings, currentUser } = useNinpoCore();
  const [receiptCaptures, setReceiptCaptures] = useState<ReceiptCapture[]>([]);
  const [receiptAliases, setReceiptAliases] = useState<ReceiptAliasRecord[]>([]);
  const [isAliasLoading, setIsAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasActionId, setAliasActionId] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
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
  const [noiseRules, setNoiseRules] = useState<NoiseRuleEntry[]>([]);
  const [showNoiseRules, setShowNoiseRules] = useState(false);
  const [isLoadingNoiseRules, setIsLoadingNoiseRules] = useState(false);
  const [timelineStoreId, setTimelineStoreId] = useState<string>('');
  const [timelineProductId, setTimelineProductId] = useState<string>('');
  const [storeInventory, setStoreInventory] = useState<StoreInventoryEntry[]>([]);
  const [isInventoryLoading, setIsInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const activeStore = useMemo(
    () => stores.find(store => store.id === activeStoreId) || null,
    [activeStoreId, stores]
  );

  const lockDurationDays = useMemo(() => {
    const rawValue = Number(settings?.priceLockDays);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 7;
  }, [settings?.priceLockDays]);

  const canCreateProducts = currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER';

  const getReceiptItemKey = useCallback((item: ClassifiedReceiptItem) => {
    if (item.captureId && typeof item.lineIndex === 'number') {
      return `${item.captureId}:${item.lineIndex}`;
    }
    return JSON.stringify({
      receiptName: item.receiptName,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice
    });
  }, []);

  const filteredProducts = useMemo(() => productSearchResults, [productSearchResults]);

  const safeItemsForCommit = useMemo(
    () => classifiedItems.filter(item => item.classification === 'A' && item.suggestedProduct && typeof item.lineIndex === 'number'),
    [classifiedItems]
  );

  const aliasConfidenceThreshold = 0.8;

  const aliasConfidenceSummary = useMemo(() => {
    const confidences = receiptAliases.map(alias => ({
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
      safePct: total ? (safe.length / total) * 100 : 0,
      gatedPct: total ? (gated.length / total) * 100 : 0,
      averageEffective,
      trend
    };
  }, [receiptAliases]);

  const receiptHealthSummary = useMemo(() => {
    const totals = receiptCaptures.reduce(
      (acc, capture) => {
        acc.totalItems += capture.stats.totalItems || 0;
        acc.itemsNeedingReview += capture.stats.itemsNeedingReview || 0;
        acc.itemsConfirmed += capture.stats.itemsConfirmed || 0;
        acc.failedCaptures += capture.status === 'failed' ? 1 : 0;
        acc.totalCaptures += 1;
        return acc;
      },
      {
        totalItems: 0,
        itemsNeedingReview: 0,
        itemsConfirmed: 0,
        failedCaptures: 0,
        totalCaptures: 0
      }
    );

    const autoMatchedItems = Math.max(totals.totalItems - totals.itemsNeedingReview, 0);
    const autoMatchedPct = totals.totalItems > 0 ? (autoMatchedItems / totals.totalItems) * 100 : 0;
    const reviewPct = totals.totalItems > 0 ? (totals.itemsNeedingReview / totals.totalItems) * 100 : 0;
    const errorPct = totals.totalCaptures > 0 ? (totals.failedCaptures / totals.totalCaptures) * 100 : 0;

    return {
      ...totals,
      autoMatchedItems,
      autoMatchedPct,
      reviewPct,
      errorPct
    };
  }, [receiptCaptures]);

  const receiptErrorRatesByStore = useMemo(() => {
    const map = new Map<string, { storeName: string; total: number; failed: number }>();
    receiptCaptures.forEach(capture => {
      const key = capture.storeId || capture.storeName || 'unknown';
      const existing = map.get(key) || {
        storeName: capture.storeName || 'Unknown Store',
        total: 0,
        failed: 0
      };
      existing.total += 1;
      if (capture.status === 'failed') {
        existing.failed += 1;
      }
      map.set(key, existing);
    });
    return Array.from(map.values())
      .map(entry => ({
        ...entry,
        errorRate: entry.total > 0 ? (entry.failed / entry.total) * 100 : 0
      }))
      .sort((a, b) => b.errorRate - a.errorRate);
  }, [receiptCaptures]);

  const priceDeltaThreshold = useMemo(() => {
    const rawValue = Number(settings?.priceDeltaReviewThreshold);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0.25;
  }, [settings?.priceDeltaReviewThreshold]);

  const priceReviewItems = useMemo(() => {
    if (!activeStoreId) return [];
    return classifiedItems
      .filter(item => typeof item.priceDelta === 'number' && Math.abs(item.priceDelta) >= priceDeltaThreshold)
      .map(item => {
        const history = item.matchHistory ?? [];
        const lastHistory = history.slice(-3);
        const latestHistory = lastHistory[lastHistory.length - 1];
        const matchMethod = item.matchMethod ?? latestHistory?.matchMethod;
        const matchConfidence = item.matchConfidence ?? latestHistory?.matchConfidence;
        const matchLabel = matchMethod ? matchMethod.replace(/_/g, ' ') : 'unknown';
        const matchScore =
          typeof matchConfidence === 'number' ? `${(matchConfidence * 100).toFixed(0)}%` : null;
        return {
          item,
          storeName: activeStore?.name ?? 'Active Store',
          receiptName: item.receiptName,
          priceDelta: item.priceDelta ?? 0,
          lastHistory,
          matchLabel,
          matchScore
        };
      });
  }, [activeStore?.name, activeStoreId, classifiedItems, priceDeltaThreshold]);

  const handleOpenReceiptReviewForItem = useCallback((item: ClassifiedReceiptItem) => {
    const next = new Map<string, boolean>();
    next.set(getReceiptItemKey(item), true);
    setSelectedItemsForCommit(next);
    if (item.captureId) {
      setActiveReceiptCaptureId(item.captureId);
    }
    setShowReceiptReview(true);
  }, [getReceiptItemKey]);

  const openReceiptScanner = () => {
    if (!activeStoreId) {
      setReceiptError('Please set an active store before capturing receipts.');
      addToast('Select an active store before capturing receipts.', 'error');
      return;
    }
    setReceiptError(null);
    setShowReceiptScanner(true);
  };

  const handlePrimarySupplierToggle = useCallback(
    async (storeId: string, nextValue: boolean) => {
      try {
        setStoreError(null);
        const res = await fetch(`${BACKEND_URL}/api/stores/${storeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ isPrimarySupplier: nextValue })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to update store');

        await refreshStores();
        const storeName = stores.find(store => store.id === storeId)?.name || 'Store';
        addToast(
          `${storeName} ${nextValue ? 'set as' : 'removed from'} primary supplier`,
          'success'
        );
      } catch (error: any) {
        const message = error?.message || 'Failed to update primary supplier';
        setStoreError(message);
        addToast(message, 'error');
      }
    },
    [addToast, refreshStores, setStoreError, stores]
  );

  const fetchReceiptCaptures = useCallback(async () => {
    try {
      const resp = await fetch(
        `${BACKEND_URL}/api/driver/receipt-captures?status=pending_parse&status=parsed&status=review_complete&status=failed&limit=40`,
        {
          credentials: 'include'
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        setReceiptCaptures(data.captures || []);
      }
    } catch (error) {
      console.error('Error fetching receipt captures:', error);
    }
  }, []);

  const resolveProductId = (entry: StoreInventoryEntry) => {
    if (entry.product?.id) return entry.product.id;
    if (entry.product?._id) return entry.product._id;
    if (typeof entry.productId === 'string') return entry.productId;
    if (entry.productId && typeof entry.productId === 'object') {
      return entry.productId._id || entry.productId.id || '';
    }
    return '';
  };

  const fetchStoreInventory = useCallback(async (storeId: string) => {
    if (!storeId) return;
    setIsInventoryLoading(true);
    setInventoryError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/store-inventory/${storeId}`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load store inventory');
      }
      const list = Array.isArray(data?.inventory) ? data.inventory : [];
      setStoreInventory(list);
    } catch (err: any) {
      setInventoryError(err?.message || 'Failed to load store inventory');
    } finally {
      setIsInventoryLoading(false);
    }
  }, []);

  const fetchReceiptAliases = useCallback(async () => {
    setIsAliasLoading(true);
    setAliasError(null);

    try {
      const params = new URLSearchParams();
      if (activeStoreId) {
        params.set('storeId', activeStoreId);
      }
      params.set('limit', '75');

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-aliases?${params.toString()}`, {
        credentials: 'include'
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to load aliases');
      }

      const data = await resp.json();
      setReceiptAliases(data.aliases || []);
    } catch (error) {
      console.error('Error fetching receipt aliases:', error);
      setAliasError(error instanceof Error ? error.message : 'Failed to load aliases');
    } finally {
      setIsAliasLoading(false);
    }
  }, [activeStoreId]);

  const updateAliasState = (updatedAlias: ReceiptAliasRecord) => {
    setReceiptAliases(prev =>
      prev.map(alias => (alias._id === updatedAlias._id ? updatedAlias : alias))
    );
  };

  const handleAliasAction = async (aliasId: string, lockToken: string | null, action: 'confirm' | 'reject') => {
    if (!lockToken) {
      setAliasError('Missing alias lock token. Refresh and try again.');
      return;
    }

    setAliasActionId(aliasId);
    setAliasError(null);

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-alias-${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ aliasId, lockToken })
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (data?.alias) {
          updateAliasState(data.alias);
        }
        throw new Error(data?.error || `Failed to ${action} alias`);
      }

      if (data?.alias) {
        updateAliasState(data.alias);
      }
    } catch (error) {
      console.error(`Error attempting to ${action} alias:`, error);
      setAliasError(error instanceof Error ? error.message : `Failed to ${action} alias`);
    } finally {
      setAliasActionId(null);
    }
  };

  const deleteReceiptCapture = async (captureId: string) => {
    if (!window.confirm('Delete this receipt? This cannot be undone.')) {
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (resp.ok) {
        setReceiptCaptures(prev => prev.filter(c => c._id !== captureId));
      } else {
        alert('Failed to delete receipt');
      }
    } catch (error) {
      console.error('Error deleting receipt:', error);
      alert('Error deleting receipt');
    }
  };

  const loadReceiptCaptureForReview = useCallback(async (captureId: string, captureStoreId?: string) => {
    setReceiptError(null);
    setIsLoadingReceiptCapture(captureId);
    try {
      if (captureStoreId && captureStoreId !== activeStoreId) {
        setActiveStoreId(captureStoreId);
      }

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        credentials: 'include'
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Failed to load receipt capture');

      const captureData = data?.capture ?? {};
      const draftItems = Array.isArray(captureData?.draftItems) ? captureData.draftItems : [];

      if (draftItems.length === 0) {
        addToast('Receipt capture has no parsed items yet.', 'info');
        return;
      }

      const enrichedItems = draftItems.map(item => ({
        ...item,
        captureId
      }));
      const { items: classified, bucketCounts } = classifyItems(enrichedItems);
      setClassifiedItems(classified);
      setSelectedItemsForCommit(new Map());
      setActiveReceiptCaptureId(captureId);

      const firstImage = Array.isArray(captureData?.images) ? captureData.images[0] : null;
      setReceiptImageUrl(firstImage?.url || null);
      setReceiptThumbnailUrl(firstImage?.thumbnailUrl || firstImage?.url || null);

      addToast(
        `Loaded ${draftItems.length} items: ${bucketCounts.A} auto-update, ${bucketCounts.B} review, ${bucketCounts.C} no-match, ${bucketCounts.D} noise`,
        'success'
      );

      setShowReceiptReview(true);
    } catch (error: any) {
      console.error('Error loading receipt capture:', error);
      setReceiptError(error?.message || 'Failed to load receipt capture');
    } finally {
      setIsLoadingReceiptCapture(null);
    }
  }, [activeStoreId, addToast, setActiveStoreId]);

  const handleOpenReceiptCapture = useCallback(async (capture: ReceiptCapture) => {
    await loadReceiptCaptureForReview(capture._id, capture.storeId);
  }, [loadReceiptCaptureForReview]);

  const updateReceiptItem = useCallback(
    (
      item: ClassifiedReceiptItem,
      updates: Partial<ClassifiedReceiptItem>,
      options: { clearSelection?: boolean; forceSelect?: boolean } = {}
    ) => {
      const updatedItem = { ...item, ...updates };
      setClassifiedItems(prev => prev.map(prevItem => (prevItem === item ? updatedItem : prevItem)));
      setSelectedItemsForCommit(prev => {
        const next = new Map(prev);
        const oldKey = getReceiptItemKey(item);
        const wasSelected = next.has(oldKey);
        if (wasSelected) next.delete(oldKey);
        const newKey = getReceiptItemKey(updatedItem);
        const shouldSelect = options.forceSelect ? true : options.clearSelection ? false : wasSelected;
        if (shouldSelect) next.set(newKey, true);
        return next;
      });
    },
    [getReceiptItemKey]
  );

  const fetchProductSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setProductSearchResults([]);
      return;
    }

    setIsSearchingProducts(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/search?query=${encodeURIComponent(trimmed)}`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to search products');
      const list = Array.isArray(data?.products) ? data.products : [];
      setProductSearchResults(list.map((product: any) => ({
        id: product.id || product.sku || product.productId,
        productId: product.productId || product.id || product.sku,
        sku: product.sku || product.id,
        upc: product.upc,
        name: product.name
      })));
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to search products');
    } finally {
      setIsSearchingProducts(false);
    }
  }, []);

  useEffect(() => {
    if (!productSearchItem) return;
    void fetchProductSearch(productSearchQuery);
  }, [fetchProductSearch, productSearchItem, productSearchQuery]);

  const fetchNoiseRules = useCallback(async () => {
    if (!activeStoreId) return;
    setIsLoadingNoiseRules(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-noise?storeId=${encodeURIComponent(activeStoreId)}`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load noise rules');
      const list = Array.isArray(data?.rules) ? data.rules : [];
      setNoiseRules(list);
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to load noise rules');
    } finally {
      setIsLoadingNoiseRules(false);
    }
  }, [activeStoreId]);

  const handleOpenNoiseRules = useCallback(() => {
    setShowNoiseRules(true);
    void fetchNoiseRules();
  }, [fetchNoiseRules]);

  const handleDeleteNoiseRule = useCallback(async (ruleId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-noise/${ruleId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete noise rule');
      setNoiseRules(prev => prev.filter(rule => rule.id !== ruleId));
      addToast('Noise rule removed', 'success');
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to delete noise rule');
    }
  }, [addToast]);

  const confirmReceiptItem = useCallback(async (item: ClassifiedReceiptItem, productId: string, upc?: string) => {
    if (!activeReceiptCaptureId) {
      setReceiptError('Receipt capture ID missing. Re-open the receipt queue and try again.');
      return;
    }
    if (!productId || !isMongoId(productId) || typeof item.lineIndex !== 'number') {
      setReceiptError('Receipt item is missing binding metadata.');
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          lineIndex: item.lineIndex,
          productId,
          upc
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to confirm receipt item');
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to confirm receipt item');
    }
  }, [activeReceiptCaptureId]);

  const handleCloseReceiptScanner = useCallback(() => {
    setShowReceiptScanner(false);
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
    setActiveReceiptCaptureId(null);
  }, []);

  const resetReceiptReview = useCallback(() => {
    setShowReceiptReview(false);
    setClassifiedItems([]);
    setSelectedItemsForCommit(new Map());
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
    setActiveReceiptCaptureId(null);
  }, []);

  const handlePhotoCaptured = useCallback(async (photoDataUrl: string, _mime: string) => {
    if (!activeStoreId || !activeStore) return;

    try {
      setReceiptError(null);
      const uploadResult = await uploadReceiptPhoto(photoDataUrl, activeStoreId, activeStore.name);

      if (!uploadResult) {
        setReceiptError('Cloudinary not configured. Please set up image uploads.');
        return;
      }

      addToast('Receipt image uploaded to Cloudinary', 'success');

      const captureRes = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId,
          storeName: activeStore.name,
          captureRequestId: createCaptureRequestId(),
          images: [
            {
              url: uploadResult.secureUrl,
              thumbnailUrl: uploadResult.secureUrl
            }
          ]
        })
      });

      const captureData = await captureRes.json().catch(() => ({}));

      if (!captureRes.ok) {
        throw new Error(captureData?.error || 'Failed to create receipt capture');
      }

      const captureId = captureData?.captureId;
      if (!captureId) {
        throw new Error('Receipt capture ID missing from server response');
      }

      const parseRes = await fetch(`${BACKEND_URL}/api/driver/receipt-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ captureId })
      });

      const parseData = await parseRes.json().catch(() => ({}));

      if (!parseRes.ok) {
        throw new Error(parseData?.error || 'Receipt parsing failed');
      }

      addToast('Receipt uploaded & parsed', 'success');
      setShowReceiptScanner(false);
      await loadReceiptCaptureForReview(captureId, activeStoreId);
      void fetchReceiptCaptures();
    } catch (err: any) {
      console.error('Receipt capture error:', err);
      setReceiptError(err?.message || 'Failed to process receipt');
    }
  }, [activeStore, activeStoreId, addToast, createCaptureRequestId, fetchReceiptCaptures, loadReceiptCaptureForReview]);

  useEffect(() => {
    if (!showReceiptReview || createProductItem || !canCreateProducts) return;
    const pendingItem = classifiedItems.find(item =>
      item.classification === 'C' &&
      !item.suggestedProduct &&
      !item.isNoiseRule &&
      !dismissedCreateItems.has(getReceiptItemKey(item))
    );
    if (pendingItem) {
      handleOpenCreateProduct(pendingItem);
    }
  }, [canCreateProducts, classifiedItems, createProductItem, dismissedCreateItems, getReceiptItemKey, handleOpenCreateProduct, showReceiptReview]);

  const handleStoreSelected = useCallback(
    (storeId: string) => {
      setActiveStoreId(storeId);
    },
    [setActiveStoreId]
  );

  const handleItemToggle = useCallback(
    (item: ClassifiedReceiptItem, _classification: ReceiptItemClassification, checked: boolean) => {
      const key = getReceiptItemKey(item);
      const newSelected = new Map(selectedItemsForCommit);
      if (checked) {
        newSelected.set(key, true);
      } else {
        newSelected.delete(key);
      }
      setSelectedItemsForCommit(newSelected);
    },
    [getReceiptItemKey, selectedItemsForCommit]
  );

  const handleItemReclassify = useCallback(
    (item: ClassifiedReceiptItem, classification: ReceiptItemClassification) => {
      updateReceiptItem(item, { classification });
    },
    [updateReceiptItem]
  );

  const linkUpcToProduct = useCallback(async (upc: string, productId: string) => {
    if (!upc || !productId) return;
    const res = await fetch(`${BACKEND_URL}/api/upc/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ upc, productId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to link UPC');
    }
  }, []);

  const createStoreInventory = useCallback(async (productId: string, cost: number) => {
    if (!activeStoreId) {
      throw new Error('Select an active store before creating store inventory');
    }
    const res = await fetch(`${BACKEND_URL}/api/shopping/store-inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        storeId: activeStoreId,
        productId,
        cost,
        markup: 1.2,
        available: true
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to create store inventory');
    }
  }, [activeStoreId]);

  const handleItemScanUpc = useCallback((item: ClassifiedReceiptItem) => {
    setScanTargetItem(item);
    setScanModalOpen(true);
  }, []);

  const handleReceiptScan = useCallback(async (upc: string) => {
    if (!scanTargetItem) return;
    const normalizedUpc = String(upc || '').replace(/\D/g, '').trim();
    if (!normalizedUpc) return;

    try {
      const scanRes = await fetch(`${BACKEND_URL}/api/upc/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ upc: normalizedUpc, qty: 1, resolveOnly: true })
      });
      const scanData = await scanRes.json().catch(() => ({}));
      if (!scanRes.ok) throw new Error(scanData?.error || 'UPC scan failed');

      if (scanData?.action === 'resolved' && scanData?.product) {
        const product = scanData.product;
        const mappedProduct = {
          id: product._id || product.id,
          name: product.name,
          upc: product.upc,
          sku: product.sku
        };
        await confirmReceiptItem(scanTargetItem, product._id || product.id, normalizedUpc);
        updateReceiptItem(
          scanTargetItem,
          {
            scannedUpc: normalizedUpc,
            suggestedProduct: mappedProduct,
            matchMethod: 'upc_scan',
            matchConfidence: 1,
            classification: 'A',
            reason: 'upc_scan',
            isNoiseRule: false
          },
          { forceSelect: true }
        );
        addToast('UPC matched to product', 'success');
      } else {
        updateReceiptItem(
          scanTargetItem,
          {
            scannedUpc: normalizedUpc,
            matchMethod: 'upc_unmapped',
            matchConfidence: 0,
            classification: 'C',
            reason: 'upc_unmapped'
          },
          { clearSelection: true }
        );
        addToast('UPC not mapped to a product', 'warning');
      }
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to scan UPC');
    } finally {
      setScanModalOpen(false);
      setScanTargetItem(null);
    }
  }, [addToast, confirmReceiptItem, scanTargetItem, updateReceiptItem]);

  const handleItemSearchProduct = useCallback(async (item: ClassifiedReceiptItem) => {
    setProductSearchIntent('match');
    setProductSearchItem(item);
    setProductSearchQuery(item.receiptName || '');

    if (!products || products.length === 0) {
      setIsLoadingProducts(true);
      try {
        await fetchProducts();
      } catch (err: any) {
        setReceiptError(err?.message || 'Failed to load products');
      } finally {
        setIsLoadingProducts(false);
      }
    }

    await fetchProductSearch(item.receiptName || '');
  }, [fetchProductSearch, fetchProducts, products]);

  const handleItemAttachExisting = useCallback(async (item: ClassifiedReceiptItem) => {
    if (!item.scannedUpc) {
      addToast('Scan a UPC before attaching to an existing product', 'warning');
      return;
    }

    setProductSearchIntent('attach');
    setProductSearchItem(item);
    setProductSearchQuery(item.scannedUpc || item.receiptName || '');

    if (!products || products.length === 0) {
      setIsLoadingProducts(true);
      try {
        await fetchProducts();
      } catch (err: any) {
        setReceiptError(err?.message || 'Failed to load products');
      } finally {
        setIsLoadingProducts(false);
      }
    }

    await fetchProductSearch(item.scannedUpc || item.receiptName || '');
  }, [addToast, fetchProductSearch, fetchProducts, products]);

  const handleProductSelect = useCallback(async (product: ProductSearchResult) => {
    if (!productSearchItem) return;

    if (productSearchIntent === 'attach' && !productSearchItem.scannedUpc) {
      setReceiptError('Scan a UPC before attaching to an existing product');
      return;
    }

    try {
      if (productSearchItem.scannedUpc) {
        await linkUpcToProduct(productSearchItem.scannedUpc, product.sku || product.id);
        addToast(productSearchIntent === 'attach' ? 'UPC attached to product' : 'UPC linked to product', 'success');
      }

      await confirmReceiptItem(productSearchItem, product.productId, productSearchItem.scannedUpc || product.upc);

      updateReceiptItem(
        productSearchItem,
        {
          suggestedProduct: {
            id: product.productId,
            name: product.name,
            upc: product.upc,
            sku: product.sku
          },
          matchMethod: 'manual_search',
          matchConfidence: 1,
          classification: 'A',
          reason: 'manual_search',
          isNoiseRule: false
        },
        { forceSelect: true }
      );
      addToast('Product matched to receipt item', 'success');
      setProductSearchItem(null);
      setProductSearchIntent('match');
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to attach product');
    }
  }, [addToast, confirmReceiptItem, linkUpcToProduct, productSearchIntent, productSearchItem, updateReceiptItem]);

  const handleOpenCreateProduct = useCallback((item: ClassifiedReceiptItem) => {
    if (!canCreateProducts) {
      setReceiptError('Manager or owner access required to create products');
      return;
    }

    setDismissedCreateItems(prev => {
      const next = new Set(prev);
      next.delete(getReceiptItemKey(item));
      return next;
    });
    setCreateProductItem(item);
    setCreateProductDraft({
      name: item.receiptName,
      category: '',
      sizeOz: 0,
      price: Number(item.unitPrice.toFixed(2)),
      isTaxable: null,
      depositEligible: null
    });
  }, [canCreateProducts, getReceiptItemKey]);

  const dismissCreateProduct = useCallback((markDismissed: boolean = true) => {
    if (createProductItem && markDismissed) {
      setDismissedCreateItems(prev => {
        const next = new Set(prev);
        next.add(getReceiptItemKey(createProductItem));
        return next;
      });
    }
    setCreateProductItem(null);
  }, [createProductItem, getReceiptItemKey]);

  const handleCreateProduct = useCallback(async () => {
    if (isCreatingProduct || !createProductItem) return;
    if (!activeStoreId) {
      setReceiptError('Select an active store before creating products');
      return;
    }
    if (!canCreateProducts) {
      setReceiptError('Manager or owner access required to create products');
      return;
    }

    const trimmedName = createProductDraft.name.trim();
    if (!trimmedName) {
      setReceiptError('Canonical name is required');
      return;
    }

    const trimmedCategory = createProductDraft.category.trim();
    if (!trimmedCategory) {
      setReceiptError('Category is required');
      return;
    }

    const sizeValue = Number(createProductDraft.sizeOz);
    if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
      setReceiptError('Size is required');
      return;
    }

    const priceValue = Number(createProductDraft.price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      setReceiptError('Base price is required');
      return;
    }

    if (typeof createProductDraft.isTaxable !== 'boolean') {
      setReceiptError('Taxability is required');
      return;
    }

    if (typeof createProductDraft.depositEligible !== 'boolean') {
      setReceiptError('Deposit eligibility is required');
      return;
    }

    const depositValue = createProductDraft.depositEligible ? 0.1 : 0;

    setIsCreatingProduct(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: trimmedName,
          price: priceValue,
          deposit: depositValue,
          sizeOz: sizeValue,
          category: trimmedCategory,
          isTaxable: createProductDraft.isTaxable,
          stock: 0
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to create product');

      const created = data.product;
      setProducts(prev => [created, ...prev]);
      addToast('Product created', 'success');

      if (createProductItem.scannedUpc) {
        await linkUpcToProduct(createProductItem.scannedUpc, created.sku || created.id);
        addToast('UPC linked to new product', 'success');
      }

      const searchQuery = created.sku || created.id;
      let productId = created.productId;
      if (!productId && searchQuery) {
        const searchRes = await fetch(`${BACKEND_URL}/api/products/search?query=${encodeURIComponent(searchQuery)}`, {
          credentials: 'include'
        });
        const searchData = await searchRes.json().catch(() => ({}));
        if (searchRes.ok && Array.isArray(searchData?.products)) {
          const match = searchData.products.find((entry: any) => entry.sku === created.sku || entry.id === created.id);
          if (match?.productId) productId = match.productId;
        }
      }

      if (!productId || !isMongoId(productId)) {
        throw new Error('Unable to resolve product ID for store inventory');
      }

      await createStoreInventory(productId, priceValue);
      await confirmReceiptItem(createProductItem, productId, createProductItem.scannedUpc);

      updateReceiptItem(
        createProductItem,
        {
          suggestedProduct: {
            id: productId,
            name: created.name,
            upc: created.upc,
            sku: created.sku
          },
          matchMethod: 'manual_create',
          matchConfidence: 1,
          classification: 'A',
          reason: 'manual_create',
          isNoiseRule: false
        },
        { forceSelect: true }
      );
      setCreateProductItem(null);
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to create product');
    } finally {
      setIsCreatingProduct(false);
    }
  }, [activeStoreId, addToast, canCreateProducts, confirmReceiptItem, createProductDraft, createProductItem, createStoreInventory, isCreatingProduct, linkUpcToProduct, setProducts, updateReceiptItem]);

  const handleNeverMatch = useCallback(async (item: ClassifiedReceiptItem) => {
    if (!activeStoreId) {
      setReceiptError('Please set an active store before adding a noise rule');
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Never match "${item.receiptName}" again for this store?`);
      if (!confirmed) return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-noise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ storeId: activeStoreId, receiptName: item.receiptName })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save noise rule');

      updateReceiptItem(
        item,
        {
          classification: 'D',
          reason: 'noise_rule',
          isNoiseRule: true,
          matchMethod: 'noise_rule',
          matchConfidence: 1,
          suggestedProduct: undefined,
          scannedUpc: undefined
        },
        { clearSelection: true }
      );

      addToast('Noise rule saved', 'success');
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to save noise rule');
    }
  }, [activeStoreId, addToast, updateReceiptItem]);

  const createCaptureRequestId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `capture_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };


  const commitReceiptItems = useCallback(async (
    itemsToCommit: ClassifiedReceiptItem[],
    intent: 'safe' | 'selected' | 'locked',
    lockPrices = false
  ) => {
    if (!activeReceiptCaptureId) {
      setReceiptError('Open a receipt capture before committing items');
      return;
    }

    if (!activeStoreId || itemsToCommit.length === 0) {
      setReceiptError('No items selected for commit');
      return;
    }

    const unpreparedItems = itemsToCommit.filter(item => !item.suggestedProduct || typeof item.lineIndex !== 'number');
    if (unpreparedItems.length > 0) {
      setReceiptError('Confirm or create products for selected items before commit');
      return;
    }

    setCommitIntent(intent);
    setIsCommitting(true);
    try {
      for (const item of itemsToCommit) {
        if (!item.suggestedProduct) continue;
        await confirmReceiptItem(item, item.suggestedProduct.id, item.scannedUpc || item.suggestedProduct.upc);
      }

      const selectedLineIndices = itemsToCommit
        .map(item => item.lineIndex)
        .filter((value): value is number => typeof value === 'number');

      const commitRes = await fetch(`${BACKEND_URL}/api/driver/receipt-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: activeReceiptCaptureId,
          commitMode: intent,
          selectedLineIndices,
          lockPrices,
          lockDurationDays
        })
      });

      const commitData = await commitRes.json().catch(() => ({}));

      if (!commitRes.ok) {
        throw new Error(commitData?.error || 'Commit failed');
      }

      const committedCount = Number(commitData?.committed ?? itemsToCommit.length);
      const lockLabel = lockPrices ? ` (locked ${lockDurationDays} days)` : '';
      addToast(`${committedCount} items committed for ${activeStore?.name}${lockLabel}`, 'success');

      if (commitData?.errors?.length) {
        addToast(`Some items were skipped: ${commitData.errors.length} issue(s)`, 'info');
      }

      resetReceiptReview();
      void fetchReceiptCaptures();
    } catch (err: any) {
      console.error('Commit error:', err);
      setReceiptError(err?.message || 'Failed to commit items');
    } finally {
      setIsCommitting(false);
      setCommitIntent(null);
    }
  }, [activeReceiptCaptureId, activeStore, activeStoreId, addToast, confirmReceiptItem, fetchReceiptCaptures, lockDurationDays, resetReceiptReview]);

  const handleCommitSelected = useCallback(async () => {
    const itemsToCommit = classifiedItems.filter(item =>
      selectedItemsForCommit.has(getReceiptItemKey(item))
    );
    await commitReceiptItems(itemsToCommit, 'selected');
  }, [classifiedItems, commitReceiptItems, getReceiptItemKey, selectedItemsForCommit]);

  const handleCommitSafeUpdates = useCallback(async () => {
    await commitReceiptItems(safeItemsForCommit, 'safe');
  }, [commitReceiptItems, safeItemsForCommit]);

  const handleCommitAndLock = useCallback(async () => {
    const itemsToCommit = classifiedItems.filter(item =>
      selectedItemsForCommit.has(getReceiptItemKey(item))
    );
    await commitReceiptItems(itemsToCommit, 'locked', true);
  }, [classifiedItems, commitReceiptItems, getReceiptItemKey, selectedItemsForCommit]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchReceiptCaptures();
    }, 30000);
    return () => clearInterval(id);
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    fetchReceiptCaptures();
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    if (activeStoreId && !timelineStoreId) {
      setTimelineStoreId(activeStoreId);
    }
  }, [activeStoreId, timelineStoreId]);

  useEffect(() => {
    if (!timelineStoreId) return;
    void fetchStoreInventory(timelineStoreId);
  }, [fetchStoreInventory, timelineStoreId]);

  useEffect(() => {
    const handleQueueRefresh = () => {
      fetchReceiptCaptures();
    };

    window.addEventListener('receipt-queue-refresh', handleQueueRefresh);
    return () => window.removeEventListener('receipt-queue-refresh', handleQueueRefresh);
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    fetchReceiptAliases();
  }, [fetchReceiptAliases]);

  const timelineOptions = useMemo(() => {
    return storeInventory
      .filter(entry => (entry.priceHistory || []).length > 0)
      .map(entry => {
        const productId = resolveProductId(entry) || entry._id;
        return {
          id: productId,
          name: entry.product?.name || 'Unknown product',
          sku: entry.product?.sku,
          upc: entry.product?.upc,
          entry
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [storeInventory]);

  useEffect(() => {
    if (timelineOptions.length === 0) {
      setTimelineProductId('');
      return;
    }
    const exists = timelineOptions.some(option => option.id === timelineProductId);
    if (!timelineProductId || !exists) {
      setTimelineProductId(timelineOptions[0].id);
    }
  }, [timelineOptions, timelineProductId]);

  const selectedTimelineOption = useMemo(
    () => timelineOptions.find(option => option.id === timelineProductId) || null,
    [timelineOptions, timelineProductId]
  );

  const timelineHistory = useMemo(() => {
    const history = selectedTimelineOption?.entry.priceHistory || [];
    return [...history].sort((a, b) => {
      const aTime = a.observedAt ? new Date(a.observedAt).getTime() : 0;
      const bTime = b.observedAt ? new Date(b.observedAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [selectedTimelineOption]);

  const timelineStats = useMemo(() => {
    const prices = timelineHistory.map(entry => entry.price).filter(price => Number.isFinite(price));
    if (prices.length === 0) {
      return { min: 0, max: 0, range: 1 };
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    return { min, max, range };
  }, [timelineHistory]);

  const isCreateProductReady = useMemo(() => {
    const hasName = createProductDraft.name.trim().length > 0;
    const hasCategory = createProductDraft.category.trim().length > 0;
    const sizeValue = Number(createProductDraft.sizeOz);
    const priceValue = Number(createProductDraft.price);
    const hasSize = Number.isFinite(sizeValue) && sizeValue > 0;
    const hasPrice = Number.isFinite(priceValue) && priceValue > 0;
    const hasTaxability = typeof createProductDraft.isTaxable === 'boolean';
    const hasDepositEligibility = typeof createProductDraft.depositEligible === 'boolean';
    return hasName && hasCategory && hasSize && hasPrice && hasTaxability && hasDepositEligibility;
  }, [createProductDraft]);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Pricing Intelligence
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            receipts • review queue • price updates • alias bindings • audit history
          </p>
        </div>
      </section>

      <section className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  Upload Receipt
                </h3>
                <p className="text-sm text-orange-100 mt-2">Capture and process a new receipt</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={openReceiptScanner}
                  className="px-6 py-3 bg-white/20 hover:bg-white/30 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all"
                  title="Use scanner to capture receipts"
                >
                  <Camera className="w-5 h-5" />
                  Capture / Upload
                </button>
              </div>
            </div>
            {activeStore && (
              <p className="text-xs text-orange-100 mt-3">
                Active store: <span className="font-semibold">{activeStore.name}</span>
              </p>
            )}
            {receiptError && (
              <p className="text-xs text-white/80 bg-white/10 border border-white/20 rounded-lg px-3 py-2 mt-3">
                {receiptError}
              </p>
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
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-purple-100">
                  {receiptCaptures.filter(c => c.status === 'parsed').length} pending receipts
                </span>
                <button
                  onClick={openReceiptScanner}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  New Receipt
                </button>
              </div>
            </div>

            {receiptCaptures.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {receiptCaptures.slice(0, 6).map(capture => (
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
                            deleteReceiptCapture(capture._id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/30 rounded text-red-400 hover:text-red-300"
                          title="Delete this receipt"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-purple-100 space-y-1">
                        <div>
                          {capture.imageCount} photo{capture.imageCount !== 1 ? 's' : ''}
                        </div>
                        <div>
                          {capture.stats.itemsConfirmed}/{capture.stats.totalItems} items confirmed
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

                        {capture.stats.itemsNeedingReview > 0 && (
                          <div className="text-yellow-300 font-semibold">
                            {capture.stats.itemsNeedingReview} need review
                          </div>
                        )}
                      </div>

                      <div className="mt-3 text-xs text-purple-200">
                        {new Date(capture.createdAt).toLocaleString()}
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
                  onClick={() => {
                    if (priceReviewItems.length > 0) setShowReceiptReview(true);
                  }}
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
                {priceReviewItems.map(({
                  item,
                  storeName,
                  receiptName,
                  priceDelta,
                  lastHistory,
                  matchLabel,
                  matchScore
                }) => (
                  <div
                    key={getReceiptItemKey(item)}
                    className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {receiptName}
                      </div>
                      {item.suggestedProduct?.name && (
                        <div className="text-xs text-emerald-100 mt-1">
                          Matched: {item.suggestedProduct.name}
                        </div>
                      )}
                      <div className="text-xs text-emerald-100 mt-1">
                        Store: {storeName}
                      </div>
                      <div className="text-xs text-emerald-100 mt-1">
                        Price delta:{' '}
                        <span className={priceDelta >= 0 ? 'text-lime-200' : 'text-rose-200'}>
                          {priceDelta >= 0 ? '+' : ''}
                          {priceDelta.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-100 mt-1">
                        Match: {matchLabel}{matchScore ? ` • ${matchScore}` : ''}
                      </div>
                      <div className="text-xs text-emerald-100 mt-1">
                        Last 3 prices:{' '}
                        {lastHistory.length > 0
                          ? lastHistory.map(entry => `$${entry.price.toFixed(2)}`).join(' • ')
                          : 'No history'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenReceiptReviewForItem(item)}
                      className="px-3 py-2 rounded-lg text-xs font-semibold border border-white/30 text-white bg-white/20 hover:bg-white/30"
                    >
                      Review Receipt
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black uppercase text-white tracking-widest">Aliases / Bindings</h3>
              <p className="text-xs text-slate-400 mt-2">
                Receipt name aliases mapped to products for the active store.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {receiptAliases.length} aliases
              </span>
              <button
                onClick={fetchReceiptAliases}
                className="px-3 py-2 rounded-lg border border-slate-600 text-slate-200 text-xs font-semibold hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
          </div>

          {aliasError && (
            <div className="mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              {aliasError}
            </div>
          )}

          {isAliasLoading ? (
            <div className="mt-6 text-sm text-slate-400">Loading aliases…</div>
          ) : receiptAliases.length === 0 ? (
            <div className="mt-6 text-sm text-slate-400">No alias bindings found yet.</div>
          ) : (
            <div className="mt-6 space-y-4">
              {receiptAliases.map(alias => {
                const baseConfidence = alias.baseConfidence ?? alias.matchConfidence;
                const effectiveConfidence = alias.effectiveConfidence ?? alias.matchConfidence;
                return (
                  <div
                    key={alias._id}
                    className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-white">
                          {alias.normalizedName}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {alias.productName || 'Unknown product'}
                          {alias.productSku ? ` • ${alias.productSku}` : ''}
                          {alias.upc ? ` • UPC ${alias.upc}` : ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Store: {alias.storeName || 'Unknown'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAliasAction(alias._id, alias.lockToken, 'confirm')}
                          disabled={aliasActionId === alias._id}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                            aliasActionId === alias._id
                              ? 'border-slate-600 text-slate-400'
                              : 'border-emerald-400 text-emerald-200 hover:bg-emerald-500/20'
                          }`}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => handleAliasAction(alias._id, alias.lockToken, 'reject')}
                          disabled={aliasActionId === alias._id}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                            aliasActionId === alias._id
                              ? 'border-slate-600 text-slate-400'
                              : 'border-rose-400 text-rose-200 hover:bg-rose-500/20'
                          }`}
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400 flex flex-wrap gap-3">
                      <span>Confidence: {(alias.matchConfidence * 100).toFixed(0)}%</span>
                      <span>Base: {(baseConfidence * 100).toFixed(0)}%</span>
                      <span>Effective: {(effectiveConfidence * 100).toFixed(0)}%</span>
                      {alias.lastSeenAt && (
                        <span>Last seen: {new Date(alias.lastSeenAt).toLocaleString()}</span>
                      )}
                    </div>

                    {alias.rawNames?.length ? (
                      <div className="text-xs text-slate-500">
                        Variants: {alias.rawNames.slice(0, 4).map(entry => entry.name).join(', ')}
                        {alias.rawNames.length > 4 ? '…' : ''}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-slate-700 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-black uppercase text-white tracking-widest">Post-Commit Intelligence</h3>
              <p className="text-xs text-slate-400 mt-2">
                Price history, alias confidence, and system health snapshots for committed receipts.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => timelineStoreId && fetchStoreInventory(timelineStoreId)}
                className="px-3 py-2 rounded-lg border border-slate-600 text-slate-200 text-xs font-semibold hover:bg-slate-800"
              >
                Refresh Post-Commit Data
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-black uppercase tracking-widest text-white">Price Timeline</h4>
                <p className="text-xs text-slate-400 mt-1">Per store/product observed price trends.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Store
                  <select
                    className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    value={timelineStoreId}
                    onChange={e => {
                      setTimelineStoreId(e.target.value);
                      setTimelineProductId('');
                    }}
                  >
                    <option value="" disabled>Select store</option>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Product
                  <select
                    className="mt-2 w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    value={timelineProductId}
                    onChange={e => setTimelineProductId(e.target.value)}
                    disabled={timelineOptions.length === 0}
                  >
                    {timelineOptions.length === 0 ? (
                      <option value="">No history yet</option>
                    ) : (
                      timelineOptions.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                          {option.sku ? ` • ${option.sku}` : ''}
                          {option.upc ? ` • ${option.upc}` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              {inventoryError && (
                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
                  {inventoryError}
                </div>
              )}

              {isInventoryLoading ? (
                <div className="text-xs text-slate-400">Loading price history…</div>
              ) : !timelineStoreId ? (
                <div className="text-xs text-slate-400">Select a store to view price history.</div>
              ) : timelineHistory.length === 0 ? (
                <div className="text-xs text-slate-400">No price history recorded for this selection.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-end gap-1 h-12">
                    {timelineHistory.slice(-12).map((entry, index) => {
                      const height = 10 + ((entry.price - timelineStats.min) / timelineStats.range) * 32;
                      return (
                        <div
                          key={`${entry.observedAt || 'entry'}-${index}`}
                          className="w-2 rounded bg-emerald-400/70"
                          style={{ height: `${height}px` }}
                          title={`$${entry.price.toFixed(2)}`}
                        />
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Range: ${timelineStats.min.toFixed(2)} → ${timelineStats.max.toFixed(2)}
                  </div>
                  <div className="space-y-2">
                    {timelineHistory
                      .slice(-5)
                      .reverse()
                      .map((entry, index) => (
                        <div key={`${entry.observedAt || 'row'}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 text-xs text-slate-300">
                          <div>
                            <div>{entry.observedAt ? new Date(entry.observedAt).toLocaleDateString() : 'Unknown date'}</div>
                            <div className="text-[10px] text-slate-500">
                              {entry.matchMethod ? entry.matchMethod : 'Receipt'}
                              {typeof entry.matchConfidence === 'number'
                                ? ` • ${(entry.matchConfidence * 100).toFixed(0)}%`
                                : ''}
                            </div>
                          </div>
                          <span className="font-semibold text-white">${entry.price.toFixed(2)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-black uppercase tracking-widest text-white">Alias Confidence</h4>
                <p className="text-xs text-slate-400 mt-1">Safe vs gated alias confidence trends.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Safe</div>
                <div className="text-lg font-bold text-emerald-200">{aliasConfidenceSummary.safeCount}</div>
                <div className="text-[10px] text-slate-500">
                  ≥ {(aliasConfidenceThreshold * 100).toFixed(0)}% ({aliasConfidenceSummary.safePct.toFixed(0)}%)
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Gated</div>
                <div className="text-lg font-bold text-amber-200">{aliasConfidenceSummary.gatedCount}</div>
                <div className="text-[10px] text-slate-500">
                  Needs review ({aliasConfidenceSummary.gatedPct.toFixed(0)}%)
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Avg Effective Confidence</div>
                <div className="text-lg font-bold text-white">
                  {(aliasConfidenceSummary.averageEffective * 100).toFixed(0)}%
                </div>
                <div className="mt-2 flex items-end gap-1 h-10">
                  {aliasConfidenceSummary.trend.length === 0 ? (
                    <span className="text-[10px] text-slate-500">No trend data yet.</span>
                  ) : (
                    aliasConfidenceSummary.trend.map((value, index) => (
                      <div
                        key={`alias-trend-${index}`}
                        className="w-2 rounded bg-indigo-400/70"
                        style={{ height: `${8 + value * 28}px` }}
                        title={`${(value * 100).toFixed(0)}%`}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-black uppercase tracking-widest text-white">System Health</h4>
                <p className="text-xs text-slate-400 mt-1">Auto-match, review, and error rates.</p>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Auto-matched</span>
                    <span className="text-white font-semibold">{receiptHealthSummary.autoMatchedPct.toFixed(0)}%</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {receiptHealthSummary.autoMatchedItems} of {receiptHealthSummary.totalItems} items
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${receiptHealthSummary.autoMatchedPct}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Requires review</span>
                    <span className="text-white font-semibold">{receiptHealthSummary.reviewPct.toFixed(0)}%</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {receiptHealthSummary.itemsNeedingReview} queued
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${receiptHealthSummary.reviewPct}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Error rate</span>
                    <span className="text-white font-semibold">{receiptHealthSummary.errorPct.toFixed(1)}%</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {receiptHealthSummary.failedCaptures} failed of {receiptHealthSummary.totalCaptures} captures
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-400"
                      style={{ width: `${receiptHealthSummary.errorPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Error rate by store</div>
                {receiptErrorRatesByStore.length === 0 ? (
                  <div className="text-xs text-slate-500">No receipt captures yet.</div>
                ) : (
                  receiptErrorRatesByStore.slice(0, 5).map(store => (
                    <div key={store.storeName} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{store.storeName}</span>
                      <span className="text-white font-semibold">
                        {store.errorRate.toFixed(1)}% ({store.failed}/{store.total})
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <ManagementApprovals
        approvalFilter={approvalFilter}
        setApprovalFilter={setApprovalFilter}
        filteredApprovals={filteredApprovals}
        handleApprove={handleApprove}
        handleReject={handleReject}
        setSelectedApproval={setSelectedApproval}
        setPreviewPhoto={setPreviewPhoto}
        fmtTime={fmtTime}
      />

      <ManagementStores
        stores={stores}
        activeStoreId={activeStoreId}
        setActiveStoreId={setActiveStoreId}
        refreshStores={refreshStores}
        isLoading={isLoadingStores}
        error={storeError}
        setError={setStoreError}
      />

      <ManagementUpcRegistry
        upcItems={upcItems}
        setUpcItems={setUpcItems}
        upcInput={upcInput}
        setUpcInput={setUpcInput}
        upcDraft={upcDraft}
        setUpcDraft={setUpcDraft}
        upcFilter={upcFilter}
        setUpcFilter={setUpcFilter}
        isUpcLoading={isUpcLoading}
        isUpcSaving={isUpcSaving}
        upcError={upcError}
        apiLoadUpcItems={apiLoadUpcItems}
        handleUpcLookup={handleUpcLookup}
        apiSaveUpc={apiSaveUpc}
        apiDeleteUpc={apiDeleteUpc}
        apiDeleteUpcDirect={apiDeleteUpcDirect}
        apiLinkUpc={apiLinkUpc}
        filteredUpcItems={filteredUpcItems}
        loadUpcDraft={loadUpcDraft}
        products={products}
        unmappedUpcModalOpen={unmappedUpcModalOpen}
        setUnmappedUpcModalOpen={setUnmappedUpcModalOpen}
        unmappedUpcPayload={unmappedUpcPayload}
        setUnmappedUpcPayload={setUnmappedUpcPayload}
        ScannerModal={null}
        UPC_CONTAINER_LABELS={UPC_CONTAINER_LABELS}
      />

      <ManagementAuditLogs
        filteredAuditLogs={filteredAuditLogs}
        auditTypeFilter={auditTypeFilter}
        setAuditTypeFilter={setAuditTypeFilter}
        auditActorFilter={auditActorFilter}
        setAuditActorFilter={setAuditActorFilter}
        auditRangeFilter={auditRangeFilter}
        setAuditRangeFilter={setAuditRangeFilter}
        auditTypeOptions={auditTypeOptions}
        isAuditLogsLoading={isAuditLogsLoading}
        auditLogsError={auditLogsError}
        handleDownloadAuditCsv={handleDownloadAuditCsv}
        runAuditSummary={runAuditSummary}
        auditSummary={auditSummary}
        isAuditSummaryLoading={isAuditSummaryLoading}
      />

      {showReceiptScanner && (
        <ReceiptCaptureFlow
          isOpen={showReceiptScanner}
          mode={ScannerMode.RECEIPT_PARSE_LIVE}
          stores={stores}
          defaultStoreId={activeStoreId}
          title="Receipt Scanner"
          subtitle="Capture receipt with barcode"
          onPhotoCaptured={handlePhotoCaptured}
          onClose={handleCloseReceiptScanner}
          showClose={true}
          onStoreSelected={handleStoreSelected}
          onPrimarySupplierToggle={handlePrimarySupplierToggle}
        />
      )}

      {scanModalOpen && (
        <ScannerModal
          mode={ScannerMode.UPC_LOOKUP}
          onScan={handleReceiptScan}
          onClose={() => {
            setScanModalOpen(false);
            setScanTargetItem(null);
          }}
          title="Scan UPC"
          subtitle="Scan product barcode to match this receipt line"
          beepEnabled={settings.beepEnabled ?? true}
          cooldownMs={settings.cooldownMs ?? 1000}
          isOpen={scanModalOpen}
        />
      )}

      {showReceiptReview && classifiedItems.length > 0 && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/95 backdrop-blur-sm p-4 flex items-center justify-center overflow-y-auto">
          <div className="bg-ninpo-card rounded-[2.5rem] border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="border-b border-white/10 p-6 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">Receipt Review</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenNoiseRules}
                    className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-white/10 text-slate-200 bg-white/5 hover:bg-white/10"
                  >
                    Manage Noise Rules
                  </button>
                  <button
                    onClick={resetReceiptReview}
                    className="text-slate-400 hover:text-white transition p-2"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                Items from <span className="text-ninpo-lime">{activeStore?.name}</span> classified into four buckets
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <ReceiptItemBucket
                items={classifiedItems}
                selectedItems={selectedItemsForCommit}
                onItemToggle={handleItemToggle}
                onItemReclassify={handleItemReclassify}
                onItemScanUpc={handleItemScanUpc}
                onItemSearchProduct={handleItemSearchProduct}
                onItemAttachExisting={handleItemAttachExisting}
                onItemCreateProduct={canCreateProducts ? handleOpenCreateProduct : undefined}
                onItemNeverMatch={handleNeverMatch}
                getItemKey={getReceiptItemKey}
                isReadOnly={false}
              />
            </div>

            <div className="border-t border-white/10 px-6 py-4 bg-white/5">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                Selected {selectedItemsForCommit.size} of {classifiedItems.length} items for commit
              </p>
            </div>

            <div className="border-t border-white/10 px-6 py-4">
              <div className="flex flex-col gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Commit actions for reviewed receipt items
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={resetReceiptReview}
                    className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCommitSafeUpdates}
                    disabled={isCommitting || safeItemsForCommit.length === 0}
                    className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                      safeItemsForCommit.length === 0
                        ? 'bg-white/5 text-slate-500 border border-white/10'
                        : 'bg-white/10 text-white border border-white/10'
                    } ${isCommitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isCommitting && commitIntent === 'safe' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isCommitting && commitIntent === 'safe' ? 'Committing…' : 'Commit All Safe'}
                  </button>
                  <button
                    onClick={handleCommitSelected}
                    disabled={isCommitting || selectedItemsForCommit.size === 0}
                    className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                      selectedItemsForCommit.size === 0
                        ? 'bg-white/5 text-slate-500 border border-white/10'
                        : 'bg-ninpo-lime text-ninpo-black'
                    } ${isCommitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isCommitting && commitIntent === 'selected' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isCommitting && commitIntent === 'selected' ? 'Committing…' : 'Commit Selected'}
                  </button>
                  <button
                    onClick={handleCommitAndLock}
                    disabled={isCommitting || selectedItemsForCommit.size === 0}
                    className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                      selectedItemsForCommit.size === 0
                        ? 'bg-white/5 text-slate-500 border border-white/10'
                        : 'bg-amber-400 text-ninpo-black'
                    } ${isCommitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isCommitting && commitIntent === 'locked' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isCommitting && commitIntent === 'locked'
                      ? 'Committing…'
                      : `Commit & Lock Prices (${lockDurationDays} days)`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
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
                  value={createProductDraft.isTaxable === null ? '' : createProductDraft.isTaxable ? 'taxable' : 'non-taxable'}
                  onChange={e => {
                    const value = e.target.value;
                    setCreateProductDraft(prev => ({
                      ...prev,
                      isTaxable: value === '' ? null : value === 'taxable'
                    }));
                  }}
                >
                  <option value="" disabled>Select taxability</option>
                  <option value="taxable">Taxable</option>
                  <option value="non-taxable">Non-taxable</option>
                </select>
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Deposit Eligibility</span>
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
                {filteredProducts.length === 0 ? (
                  <p className="text-xs text-slate-500">No products match this search.</p>
                ) : (
                  filteredProducts.map(product => (
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

      {showNoiseRules && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-ninpo-card rounded-[2rem] border border-white/10 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-black uppercase text-sm tracking-widest">Noise Rules</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Store: {activeStore?.name}</p>
              </div>
              <button
                onClick={() => setShowNoiseRules(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {isLoadingNoiseRules ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading noise rules…
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {noiseRules.length === 0 ? (
                  <p className="text-xs text-slate-500">No noise rules yet.</p>
                ) : (
                  noiseRules.map(rule => (
                    <div
                      key={rule.id}
                      className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="text-sm text-white font-semibold">{rule.normalizedName}</div>
                        {rule.rawNames?.length ? (
                          <p className="text-[10px] text-slate-400 mt-1">
                            {rule.rawNames.slice(0, 2).map(entry => entry.name).join(', ')}
                            {rule.rawNames.length > 2 ? '…' : ''}
                          </p>
                        ) : null}
                      </div>
                      <button
                        onClick={() => void handleDeleteNoiseRule(rule.id)}
                        className="px-2 py-1 rounded-full text-[10px] font-semibold border border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
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
