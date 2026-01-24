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

const PRICE_LOCK_DAYS = 7;

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
  const [lockPricesOnCommit, setLockPricesOnCommit] = useState(false);
  const [commitIntent, setCommitIntent] = useState<'safe' | 'selected' | null>(null);
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
    category: 'DRINK',
    sizeOz: 0,
    deposit: 0,
    isTaxable: true,
    price: 0
  });
  const [noiseRules, setNoiseRules] = useState<NoiseRuleEntry[]>([]);
  const [showNoiseRules, setShowNoiseRules] = useState(false);
  const [isLoadingNoiseRules, setIsLoadingNoiseRules] = useState(false);

  const activeStore = useMemo(
    () => stores.find(store => store.id === activeStoreId) || null,
    [activeStoreId, stores]
  );

  const canCreateProducts = currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER';

  const filteredProducts = useMemo(() => productSearchResults, [productSearchResults]);

  const safeItemsForCommit = useMemo(
    () => classifiedItems.filter(item => item.classification === 'A' && item.suggestedProduct),
    [classifiedItems]
  );

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
        `${BACKEND_URL}/api/driver/receipt-captures?status=pending_parse&status=parsed&status=review_complete&limit=20`,
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
        const oldKey = JSON.stringify(item);
        const wasSelected = next.has(oldKey);
        if (wasSelected) next.delete(oldKey);
        const newKey = JSON.stringify(updatedItem);
        const shouldSelect = options.forceSelect ? true : options.clearSelection ? false : wasSelected;
        if (shouldSelect) next.set(newKey, true);
        return next;
      });
    },
    []
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

  const confirmReceiptMatch = useCallback(async (item: ClassifiedReceiptItem, productId: string) => {
    if (!activeStoreId || !productId || !isMongoId(productId)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/driver/receipt-confirm-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          storeId: activeStoreId,
          productId,
          receiptName: item.receiptName,
          unitPrice: item.unitPrice,
          quantity: item.quantity
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to confirm match');
    } catch (err: any) {
      setReceiptError(err?.message || 'Failed to confirm match');
    }
  }, [activeStoreId]);

  const handleCloseReceiptScanner = useCallback(() => {
    setShowReceiptScanner(false);
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
  }, []);

  const resetReceiptReview = useCallback(() => {
    setShowReceiptReview(false);
    setClassifiedItems([]);
    setSelectedItemsForCommit(new Map());
    setReceiptImageUrl(null);
    setReceiptThumbnailUrl(null);
    setLockPricesOnCommit(false);
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
      setReceiptImageUrl(uploadResult.secureUrl);
      setReceiptThumbnailUrl(uploadResult.secureUrl);

      const parseRes = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          image: photoDataUrl,
          storeId: activeStoreId,
          storeName: activeStore.name,
          receiptImageUrl: uploadResult.secureUrl,
          receiptPublicId: uploadResult.publicId
        })
      });

      const parseData = await parseRes.json().catch(() => ({}));

      if (!parseRes.ok) {
        throw new Error(parseData?.error || 'Receipt parsing failed');
      }

      if (!parseData.items || parseData.items.length === 0) {
        addToast('No items were found in this receipt', 'info');
        setShowReceiptScanner(false);
        return;
      }

      const { items: classified, bucketCounts } = classifyItems(parseData.items);
      setClassifiedItems(classified);

      addToast(
        `Found ${parseData.items.length} items: ${bucketCounts.A} auto-update, ${bucketCounts.B} review, ${bucketCounts.C} no-match, ${bucketCounts.D} noise`,
        'success'
      );

      setShowReceiptScanner(false);
      setShowReceiptReview(true);
    } catch (err: any) {
      console.error('Receipt capture error:', err);
      setReceiptError(err?.message || 'Failed to process receipt');
    }
  }, [activeStore, activeStoreId, addToast]);

  const handleStoreSelected = useCallback(
    (storeId: string) => {
      setActiveStoreId(storeId);
    },
    [setActiveStoreId]
  );

  const handleItemToggle = useCallback(
    (item: ClassifiedReceiptItem, _classification: ReceiptItemClassification, checked: boolean) => {
      const key = JSON.stringify(item);
      const newSelected = new Map(selectedItemsForCommit);
      if (checked) {
        newSelected.set(key, true);
      } else {
        newSelected.delete(key);
      }
      setSelectedItemsForCommit(newSelected);
    },
    [selectedItemsForCommit]
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
          id: product.sku || product.frontendId || product._id,
          name: product.name,
          upc: product.upc,
          sku: product.sku
        };
        await confirmReceiptMatch(scanTargetItem, product._id || product.id);
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
  }, [addToast, confirmReceiptMatch, scanTargetItem, updateReceiptItem]);

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

      await confirmReceiptMatch(productSearchItem, product.productId);

      updateReceiptItem(
        productSearchItem,
        {
          suggestedProduct: {
            id: product.id,
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
  }, [addToast, confirmReceiptMatch, linkUpcToProduct, productSearchIntent, productSearchItem, updateReceiptItem]);

  const handleOpenCreateProduct = useCallback((item: ClassifiedReceiptItem) => {
    if (!canCreateProducts) {
      setReceiptError('Owner access required to create products');
      return;
    }

    setCreateProductItem(item);
    setCreateProductDraft({
      name: item.receiptName,
      category: 'DRINK',
      sizeOz: 0,
      deposit: 0,
      isTaxable: true,
      price: Number(item.unitPrice.toFixed(2))
    });
  }, [canCreateProducts]);

  const handleCreateProduct = useCallback(async () => {
    if (isCreatingProduct || !createProductItem) return;
    if (!activeStoreId) {
      setReceiptError('Select an active store before creating products');
      return;
    }
    if (!canCreateProducts) {
      setReceiptError('Owner access required to create products');
      return;
    }

    const trimmedName = createProductDraft.name.trim();
    if (!trimmedName) {
      setReceiptError('Canonical name is required');
      return;
    }

    setIsCreatingProduct(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: trimmedName,
          price: createProductDraft.price,
          deposit: createProductDraft.deposit,
          sizeOz: createProductDraft.sizeOz,
          category: createProductDraft.category,
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
      let productId = created.id;
      if (searchQuery) {
        const searchRes = await fetch(`${BACKEND_URL}/api/products/search?query=${encodeURIComponent(searchQuery)}`, {
          credentials: 'include'
        });
        const searchData = await searchRes.json().catch(() => ({}));
        if (searchRes.ok && Array.isArray(searchData?.products)) {
          const match = searchData.products.find((entry: any) => entry.sku === created.sku || entry.id === created.id);
          if (match?.productId) productId = match.productId;
        }
      }

      await confirmReceiptMatch(createProductItem, productId);

      updateReceiptItem(
        createProductItem,
        {
          suggestedProduct: {
            id: created.id,
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
  }, [activeStoreId, addToast, canCreateProducts, confirmReceiptMatch, createProductDraft, createProductItem, isCreatingProduct, linkUpcToProduct, setProducts, updateReceiptItem]);

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

  const createCommitId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `commit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const commitReceiptItems = useCallback(async (itemsToCommit: ClassifiedReceiptItem[], intent: 'safe' | 'selected') => {
    if (!activeStoreId || itemsToCommit.length === 0) {
      setReceiptError('No items selected for commit');
      return;
    }

    if (!receiptImageUrl) {
      setReceiptError('Receipt image is required before commit');
      return;
    }

    const unpreparedItems = itemsToCommit.filter(item => !item.suggestedProduct);
    if (unpreparedItems.length > 0) {
      setReceiptError('Create products for unknown/new items before commit');
      return;
    }

    setCommitIntent(intent);
    setIsCommitting(true);
    try {
      const commitId = createCommitId();
      const commitRes = await fetch(`${BACKEND_URL}/api/stores/${activeStoreId}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          commitId,
          receiptImageUrl,
          receiptThumbnailUrl,
          lockPrices: lockPricesOnCommit,
          lockDurationDays: PRICE_LOCK_DAYS,
          items: itemsToCommit.map((item, index) => ({
            lineIndex: index,
            productId: item.suggestedProduct?.id,
            receiptName: item.receiptName,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            unitPrice: item.unitPrice,
            classification: item.classification,
            matchMethod: item.matchMethod,
            matchConfidence: item.matchConfidence
          }))
        })
      });

      const commitData = await commitRes.json().catch(() => ({}));

      if (!commitRes.ok) {
        throw new Error(commitData?.error || 'Commit failed');
      }

      const committedCount = Number(commitData?.committed ?? itemsToCommit.length);
      const lockLabel = lockPricesOnCommit ? ` (locked ${PRICE_LOCK_DAYS} days)` : '';
      addToast(`${committedCount} items added to ${activeStore?.name} inventory${lockLabel}`, 'success');

      if (commitData?.errors?.length) {
        addToast(`Some items were skipped: ${commitData.errors.length} issue(s)`, 'info');
      }

      resetReceiptReview();
    } catch (err: any) {
      console.error('Commit error:', err);
      setReceiptError(err?.message || 'Failed to commit items');
    } finally {
      setIsCommitting(false);
      setCommitIntent(null);
    }
  }, [activeStore, activeStoreId, addToast, lockPricesOnCommit, receiptImageUrl, receiptThumbnailUrl, resetReceiptReview]);

  const handleCommitSelected = useCallback(async () => {
    const itemsToCommit = classifiedItems.filter(item =>
      selectedItemsForCommit.has(JSON.stringify(item))
    );
    await commitReceiptItems(itemsToCommit, 'selected');
  }, [classifiedItems, commitReceiptItems, selectedItemsForCommit]);

  const handleCommitSafeUpdates = useCallback(async () => {
    await commitReceiptItems(safeItemsForCommit, 'safe');
  }, [commitReceiptItems, safeItemsForCommit]);

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
    const handleQueueRefresh = () => {
      fetchReceiptCaptures();
    };

    window.addEventListener('receipt-queue-refresh', handleQueueRefresh);
    return () => window.removeEventListener('receipt-queue-refresh', handleQueueRefresh);
  }, [fetchReceiptCaptures]);

  useEffect(() => {
    fetchReceiptAliases();
  }, [fetchReceiptAliases]);

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

        {receiptCaptures.length > 0 && (
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Receipt Scanner Queue
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-sm text-purple-100">
                  {receiptCaptures.filter(c => c.status === 'parsed').length} pending review
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <input
                    type="checkbox"
                    checked={lockPricesOnCommit}
                    onChange={e => setLockPricesOnCommit(e.target.checked)}
                    className="h-4 w-4 rounded border border-white/20 bg-black/30"
                  />
                  Commit &amp; Lock Prices (freeze for {PRICE_LOCK_DAYS} days)
                </label>
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
                    {isCommitting && commitIntent === 'safe' ? 'Committing…' : 'Commit All Safe Updates'}
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
                    {isCommitting && commitIntent === 'selected' ? 'Committing…' : 'Commit Selected Items'}
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
                onClick={() => setCreateProductItem(null)}
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
                  value={createProductDraft.isTaxable ? 'taxable' : 'non-taxable'}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, isTaxable: e.target.value === 'taxable' }))}
                >
                  <option value="taxable">Taxable</option>
                  <option value="non-taxable">Non-taxable</option>
                </select>
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Deposit ($)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={createProductDraft.deposit}
                  onChange={e => setCreateProductDraft(prev => ({ ...prev, deposit: Number(e.target.value) }))}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <span>Unit Price ($)</span>
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
                onClick={() => setCreateProductItem(null)}
                className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProduct}
                disabled={isCreatingProduct || !createProductDraft.name.trim()}
                className="flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 bg-ninpo-lime text-ninpo-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isCreatingProduct ? 'Creating…' : 'Create Product & Inventory'}
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
