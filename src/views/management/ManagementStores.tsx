import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wand2, MapPin, Loader2, CheckCircle2, Camera, Check } from 'lucide-react';
import { BACKEND_URL } from '../../constants';
import { StoreRecord, ScannerMode, ClassifiedReceiptItem, ReceiptItemClassification } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import ReceiptItemBucket from '../../components/ReceiptItemBucket';
import ScannerModal from '../../components/ScannerModal';
import { uploadReceiptPhoto } from '../../utils/cloudinaryUtils';
import { classifyItems } from '../../utils/classificationUtils';

interface ManagementStoresProps {
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  setError: (err: string | null) => void;
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

const emptyAddress = { street: '', city: '', state: '', zip: '', country: '' };

const PRICE_LOCK_DAYS = 7;

const formatStoreType = (storeType?: string) => {
  if (!storeType) return 'Other';
  return storeType.charAt(0).toUpperCase() + storeType.slice(1);
};

const formatLocation = (store: StoreRecord) =>
  [store.address?.street, store.address?.city, store.address?.state, store.address?.zip, store.address?.country]
    .filter(Boolean)
    .join(', ');

const isMongoId = (value: string) => /^[a-f0-9]{24}$/i.test(value);

const ManagementStores: React.FC<ManagementStoresProps> = ({
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoading,
  error,
  setError
}) => {
  const { addToast, products, fetchProducts, setProducts, settings, currentUser } = useNinpoCore();
  const [rawInput, setRawInput] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [receiptThumbnailUrl, setReceiptThumbnailUrl] = useState<string | null>(null);
  const [lockPricesOnCommit, setLockPricesOnCommit] = useState(false);
  const [commitIntent, setCommitIntent] = useState<'safe' | 'selected' | null>(null);
  const [classifiedItems, setClassifiedItems] = useState<ClassifiedReceiptItem[]>([]);
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [selectedItemsForCommit, setSelectedItemsForCommit] = useState<Map<string, boolean>>(new Map());
  const [isCommitting, setIsCommitting] = useState(false);
  const [primarySupplierUpdatingId, setPrimarySupplierUpdatingId] = useState<string | null>(null);
  const [scanTargetItem, setScanTargetItem] = useState<ClassifiedReceiptItem | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [productSearchItem, setProductSearchItem] = useState<ClassifiedReceiptItem | null>(null);
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
  const [draft, setDraft] = useState<StoreRecord>({
    id: '',
    name: '',
    address: { ...emptyAddress },
    storeType: 'other'
  });

  const activeStore = useMemo(() => stores.find(s => s.id === activeStoreId) || null, [stores, activeStoreId]);
  const canCreateProducts = currentUser?.role === 'OWNER' || currentUser?.role === 'MANAGER';

  const filteredProducts = useMemo(() => productSearchResults, [productSearchResults]);

  const safeItemsForCommit = useMemo(
    () => classifiedItems.filter(item => item.classification === 'A' && item.suggestedProduct),
    [classifiedItems]
  );

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
      setError(err?.message || 'Failed to search products');
    } finally {
      setIsSearchingProducts(false);
    }
  }, [setError]);

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
      setError(err?.message || 'Failed to load noise rules');
    } finally {
      setIsLoadingNoiseRules(false);
    }
  }, [activeStoreId, setError]);

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
      setError(err?.message || 'Failed to delete noise rule');
    }
  }, [addToast, setError]);

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
      setError(err?.message || 'Failed to confirm match');
    }
  }, [activeStoreId, setError]);

  const handleEnrich = useCallback(async () => {
    setError(null);
    setIsEnriching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: rawInput, name: draft.name, address: draft.address || emptyAddress })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Enrich failed');
      setDraft(prev => ({
        ...prev,
        name: data.store?.name || prev.name,
        storeType: data.store?.storeType || prev.storeType,
        address: {
          street: data.store?.address?.street || '',
          city: data.store?.address?.city || '',
          state: data.store?.address?.state || '',
          zip: data.store?.address?.zip || '',
          country: data.store?.address?.country || ''
        },
        location: data.store?.location
      }));
      addToast('Gemini filled the address.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Enrich failed');
    } finally {
      setIsEnriching(false);
    }
  }, [addToast, draft.address, draft.name, rawInput, setError]);

  const handleSave = useCallback(async () => {
    setError(null);
    const name = draft.name?.trim();
    if (!name) {
      setError('Store name required');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          phone: draft.phone || '',
          address: draft.address || emptyAddress,
          storeType: draft.storeType || 'other',
          location: draft.location
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error('owner-only');
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      await refreshStores();
      if (data.store?.id) {
        setActiveStoreId(data.store.id);
      }
      addToast(`${name} saved`, 'success');
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [addToast, draft.address, draft.phone, draft.location, draft.storeType, draft.name, refreshStores, setActiveStoreId, setError]);

  const handleOpenReceiptScanner = useCallback(() => {
    if (!activeStoreId) {
      setError('Please set an active store before capturing receipts');
      return;
    }
    setShowReceiptScanner(true);
  }, [activeStoreId, setError]);

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
      // Upload to Cloudinary
      const uploadResult = await uploadReceiptPhoto(photoDataUrl, activeStoreId, activeStore.name);

      if (!uploadResult) {
        setError('Cloudinary not configured. Please set up image uploads.');
        return;
      }

      addToast('Receipt image uploaded to Cloudinary', 'success');
      setReceiptImageUrl(uploadResult.secureUrl);
      setReceiptThumbnailUrl(uploadResult.secureUrl);

      // Send to backend for Gemini parsing
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

      // Classify items into buckets
      const { items: classified, bucketCounts } = classifyItems(parseData.items);
      setClassifiedItems(classified);

      addToast(
        `Found ${parseData.items.length} items: ${bucketCounts.A} auto-update, ${bucketCounts.B} review, ${bucketCounts.C} no-match, ${bucketCounts.D} noise`,
        'success'
      );

      // Show review screen
      setShowReceiptScanner(false);
      setShowReceiptReview(true);
    } catch (err: any) {
      console.error('Receipt capture error:', err);
      setError(err?.message || 'Failed to process receipt');
    }
  }, [activeStoreId, activeStore, addToast, setError]);

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
      setError(err?.message || 'Failed to scan UPC');
    } finally {
      setScanModalOpen(false);
      setScanTargetItem(null);
    }
  }, [addToast, scanTargetItem, setError, updateReceiptItem]);

  const handleItemSearchProduct = useCallback(async (item: ClassifiedReceiptItem) => {
    setProductSearchItem(item);
    setProductSearchQuery(item.receiptName || '');

    if (!products || products.length === 0) {
      setIsLoadingProducts(true);
      try {
        await fetchProducts();
      } catch (err: any) {
        setError(err?.message || 'Failed to load products');
      } finally {
        setIsLoadingProducts(false);
      }
    }

    await fetchProductSearch(item.receiptName || '');
  }, [fetchProductSearch, fetchProducts, products, setError]);

  const handleProductSelect = useCallback(async (product: ProductSearchResult) => {
    if (!productSearchItem) return;

    try {
      if (productSearchItem.scannedUpc) {
        await linkUpcToProduct(productSearchItem.scannedUpc, product.sku || product.id);
        addToast('UPC linked to product', 'success');
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
    } catch (err: any) {
      setError(err?.message || 'Failed to attach product');
    }
  }, [addToast, confirmReceiptMatch, linkUpcToProduct, productSearchItem, setError, updateReceiptItem]);

  const handleOpenCreateProduct = useCallback((item: ClassifiedReceiptItem) => {
    if (!canCreateProducts) {
      setError('Owner access required to create products');
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
  }, [canCreateProducts, setError]);

  const handleCreateProduct = useCallback(async () => {
    if (isCreatingProduct || !createProductItem) return;
    if (!activeStoreId) {
      setError('Select an active store before creating products');
      return;
    }
    if (!canCreateProducts) {
      setError('Owner access required to create products');
      return;
    }

    const trimmedName = createProductDraft.name.trim();
    if (!trimmedName) {
      setError('Canonical name is required');
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
      setError(err?.message || 'Failed to create product');
    } finally {
      setIsCreatingProduct(false);
    }
  }, [activeStoreId, addToast, canCreateProducts, confirmReceiptMatch, createProductDraft, createProductItem, isCreatingProduct, linkUpcToProduct, setError, setProducts, updateReceiptItem]);

  const handleNeverMatch = useCallback(async (item: ClassifiedReceiptItem) => {
    if (!activeStoreId) {
      setError('Please set an active store before adding a noise rule');
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
      setError(err?.message || 'Failed to save noise rule');
    }
  }, [activeStoreId, addToast, setError, updateReceiptItem]);

  const createCommitId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `commit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const commitReceiptItems = useCallback(async (itemsToCommit: ClassifiedReceiptItem[], intent: 'safe' | 'selected') => {
    if (!activeStoreId || itemsToCommit.length === 0) {
      setError('No items selected for commit');
      return;
    }

    if (!receiptImageUrl) {
      setError('Receipt image is required before commit');
      return;
    }

    const unpreparedItems = itemsToCommit.filter(item => !item.suggestedProduct);
    if (unpreparedItems.length > 0) {
      setError('Create products for unknown/new items before commit');
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
      setError(err?.message || 'Failed to commit items');
    } finally {
      setIsCommitting(false);
      setCommitIntent(null);
    }
  }, [activeStoreId, activeStore, addToast, lockPricesOnCommit, receiptImageUrl, receiptThumbnailUrl, resetReceiptReview, setError]);

  const handleCommitSelected = useCallback(async () => {
    const itemsToCommit = classifiedItems.filter(item =>
      selectedItemsForCommit.has(JSON.stringify(item))
    );
    await commitReceiptItems(itemsToCommit, 'selected');
  }, [classifiedItems, commitReceiptItems, selectedItemsForCommit]);

  const handleCommitSafeUpdates = useCallback(async () => {
    await commitReceiptItems(safeItemsForCommit, 'safe');
  }, [commitReceiptItems, safeItemsForCommit]);

  const handlePrimarySupplierToggle = useCallback(async (store: StoreRecord) => {
    setPrimarySupplierUpdatingId(store.id);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores/${store.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isPrimarySupplier: !store.isPrimarySupplier })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error('owner-only');
      if (!res.ok) throw new Error(data?.error || 'Failed to update primary supplier');

      await refreshStores();
      addToast(
        `${store.name} ${store.isPrimarySupplier ? 'removed from' : 'set as'} primary supplier`,
        'success'
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to update primary supplier');
    } finally {
      setPrimarySupplierUpdatingId(null);
    }
  }, [addToast, refreshStores, setError]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase text-white tracking-widest">Stores</h2>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
          Use Gemini to normalize store addresses, then save and pick your active store for pricing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <Wand2 className="w-4 h-4" /> Gemini Fill
            </div>
            {isEnriching && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <textarea
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white min-h-[100px]"
            placeholder="Paste store name + address"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={draft.name}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Store Name"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <select
              value={draft.storeType || 'other'}
              onChange={e => setDraft(prev => ({ ...prev, storeType: e.target.value }))}
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            >
              <option value="walmart">Walmart</option>
              <option value="kroger">Kroger</option>
              <option value="aldi">Aldi</option>
              <option value="target">Target</option>
              <option value="meijer">Meijer</option>
              <option value="hub">Hub</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={draft.address?.street || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), street: e.target.value } }))
              }
              placeholder="Street"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.city || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), city: e.target.value } }))
              }
              placeholder="City"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.state || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), state: e.target.value } }))
              }
              placeholder="State"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.zip || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), zip: e.target.value } }))
              }
              placeholder="ZIP"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.country || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), country: e.target.value } }))
              }
              placeholder="Country"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.phone || ''}
              onChange={e => setDraft(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="Phone (optional)"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleEnrich}
              disabled={isEnriching}
              className={`px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-white/10 ${
                isEnriching ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/15'
              }`}
            >
              <Wand2 className="w-4 h-4" />
              {isEnriching ? 'Enriching…' : 'Fill with Gemini'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-neon ${
                isSaving ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isSaving ? 'Saving…' : 'Save Store'}
            </button>
          </div>

          {error && <p className="text-xs text-ninpo-red font-semibold uppercase tracking-widest">{error}</p>}
        </div>

        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <MapPin className="w-4 h-4" /> Store List
            </div>
            <button
              onClick={() => void refreshStores()}
              disabled={isLoading}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {stores.map(store => {
              const location = formatLocation(store);
              const isUpdating = primarySupplierUpdatingId === store.id;

              return (
                <div
                  key={store.id}
                  className={`p-4 rounded-2xl border text-sm text-white flex items-start justify-between gap-3 ${
                    activeStoreId === store.id
                      ? 'border-ninpo-lime/60 bg-ninpo-lime/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-black text-white">{store.name}</p>
                      {store.isPrimarySupplier && (
                        <span className="text-[10px] uppercase tracking-widest bg-ninpo-lime/20 text-ninpo-lime px-2 py-0.5 rounded-full">
                          Primary supplier
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{formatStoreType(store.storeType)}</p>
                    <p className="text-xs text-slate-400 mt-1">{location || 'No location metadata'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={() => setActiveStoreId(store.id)}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        activeStoreId === store.id
                          ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime'
                          : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {activeStoreId === store.id ? 'Active' : 'Set Active'}
                    </button>
                    <button
                      onClick={() => void handlePrimarySupplierToggle(store)}
                      disabled={isUpdating}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        store.isPrimarySupplier
                          ? 'bg-ninpo-lime/20 text-ninpo-lime border-ninpo-lime/40'
                          : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                      } ${isUpdating ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      <span className={isUpdating ? 'ml-2' : ''}>
                        {store.isPrimarySupplier ? 'Primary supplier' : 'Set primary'}
                      </span>
                    </button>
                    {store.createdFrom && (
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{store.createdFrom}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!stores.length && !isLoading && (
              <div className="text-xs text-slate-400">No stores yet. Create your first store above.</div>
            )}
          </div>
        </div>
      </div>

      {/* Receipt Capture Section */}
      {activeStore && (
        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <Camera className="w-4 h-4" /> Capture Receipt
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">
            Capture and scan receipts for <span className="text-ninpo-lime">{activeStore.name}</span>. Items will be automatically classified for review.
          </p>
          <button
            onClick={handleOpenReceiptScanner}
            className="w-full px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-ninpo-lime/90 shadow-neon"
          >
            <Camera className="w-4 h-4" />
            Open Receipt Scanner
          </button>
        </div>
      )}

      {/* Receipt Capture Flow Modal */}
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

      {/* Receipt Review Section */}
      {showReceiptReview && classifiedItems.length > 0 && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/95 backdrop-blur-sm p-4 flex items-center justify-center overflow-y-auto">
          <div className="bg-ninpo-card rounded-[2.5rem] border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
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

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-6">
              <ReceiptItemBucket
                items={classifiedItems}
                selectedItems={selectedItemsForCommit}
                onItemToggle={handleItemToggle}
                onItemReclassify={handleItemReclassify}
                onItemScanUpc={handleItemScanUpc}
                onItemSearchProduct={handleItemSearchProduct}
                onItemCreateProduct={canCreateProducts ? handleOpenCreateProduct : undefined}
                onItemNeverMatch={handleNeverMatch}
                isReadOnly={false}
              />
            </div>

            {/* Summary */}
            <div className="border-t border-white/10 px-6 py-4 bg-white/5">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                Selected {selectedItemsForCommit.size} of {classifiedItems.length} items for commit
              </p>
            </div>

            {/* Actions */}
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
                <h3 className="text-white font-black uppercase text-sm tracking-widest">Search Product</h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                  Match: {productSearchItem.receiptName}
                </p>
              </div>
              <button
                onClick={() => setProductSearchItem(null)}
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

export default ManagementStores;
