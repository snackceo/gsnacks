import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { Product, SizeUnit, UpcContainerType, UpcItem } from '../../../types';
import { ScannerMode } from '../../../types';
import { BACKEND_URL } from '../../../constants';
import { DEFAULT_NEW_PRODUCT, OFF_LOOKUP_FALLBACK_MESSAGE } from '../constants';
import {
  buildNutritionNoteFromOff,
  getOffNutritionEntries,
  parseOffQuantity,
  shouldFillNumber,
  shouldFillText
} from '../utils';
import type { OffLookupProduct } from '../utils';

interface UseInventoryCreateParams {
  activeModule: string;
  scannerMode: ScannerMode;
  setScannerMode: (mode: ScannerMode) => void;
  setScannerModalOpen: (open: boolean) => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setUpcInput: (value: string) => void;
  upcDraft: UpcItem;
  setUpcDraft: React.Dispatch<React.SetStateAction<UpcItem>>;
  upcItemsRef: React.MutableRefObject<UpcItem[]>;
  products: Product[];
}

export const useInventoryCreate = ({
  activeModule,
  scannerMode,
  setScannerMode,
  setScannerModalOpen,
  setProducts,
  setUpcInput,
  upcDraft,
  setUpcDraft,
  upcItemsRef,
  products
}: UseInventoryCreateParams) => {
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({ ...DEFAULT_NEW_PRODUCT });
  const [scannedUpcForCreation, setScannedUpcForCreation] = useState<string>('');
  const [offLookupStatus, setOffLookupStatus] = useState<
    'idle' | 'loading' | 'found' | 'not_found' | 'error'
  >('idle');
  const [offLookupMessage, setOffLookupMessage] = useState('');
  const [offLookupIngredients, setOffLookupIngredients] = useState('');
  const [offLookupNutriments, setOffLookupNutriments] = useState<
    OffLookupProduct['nutriments'] | null
  >(null);

  const offLookupRequestIdRef = useRef(0);
  const upcLastScannedRef = useRef<string>('');

  const offNutritionEntries = useMemo(
    () => getOffNutritionEntries(offLookupNutriments || undefined),
    [offLookupNutriments]
  );

  // Draft state management
  const [draftStatus, setDraftStatus] = useState<
    'idle' | 'scanned' | 'editing' | 'savingUpc' | 'savingInventory' | 'saved' | 'error'
  >('idle');
  const [isDirty, setIsDirty] = useState(false);
  const [pendingUpc, setPendingUpc] = useState<string | null>(null);
  const [lastAcceptedUpc, setLastAcceptedUpc] = useState<string | null>(null);
  const [lastAcceptedAtMs, setLastAcceptedAtMs] = useState(0);
  const recentUpcSetRef = useRef<Map<string, number>>(new Map());
  const [batchMode, setBatchMode] = useState(false);
  const [batchQueue, setBatchQueue] = useState<
    Array<{ id: string; upc: string; status: 'queued' | 'saved' | 'failed'; containerType: 'plastic' | 'aluminum' | 'glass'; error?: string }>
  >([]);
  const COOLDOWN_MS = 1200;
  const RECENT_TTL_MS = 15000; // 15 seconds

  const queueUpc = useCallback((upc: string) => {
    setBatchQueue(prev => [
      ...prev,
      {
        id: `${upc}-${Date.now()}`,
        upc,
        status: 'queued',
        containerType: 'plastic'
      }
    ]);
  }, []);

  const toggleBatchMode = useCallback(
    (on: boolean) => {
      setBatchMode(on);
      if (on) {
        setIsDirty(false);
        if (pendingUpc) {
          queueUpc(pendingUpc);
          setPendingUpc(null);
        }
      }
    },
    [pendingUpc, queueUpc]
  );

  const addBatchQueueToRegistry = useCallback(async () => {
    const items = batchQueue;
    if (!items.length) return { successCount: 0, failCount: 0 };

    let successCount = 0;
    let failCount = 0;

    const updated = await Promise.all(
      items.map(async item => {
        if (item.status === 'saved') return item;
        if (!item.containerType) {
          failCount += 1;
          return { ...item, status: 'failed', error: 'Container required' };
        }
        try {
          const res = await fetch(`${BACKEND_URL}/api/upc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              upc: item.upc,
              containerType: item.containerType,
              isEligible: true
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed to save');
          successCount += 1;
          return { ...item, status: 'saved', error: undefined };
        } catch (err: any) {
          failCount += 1;
          return { ...item, status: 'failed', error: err?.message || 'Failed' };
        }
      })
    );

    const remaining = updated.filter(item => item.status !== 'saved');
    setBatchQueue(remaining);
    return { successCount, failCount };
  }, [batchQueue]);

  const resetCreateForm = useCallback(() => {
    setNewProduct({ ...DEFAULT_NEW_PRODUCT });
    setScannedUpcForCreation('');
    setCreateError(null);
    setOffLookupStatus('idle');
    setOffLookupMessage('');
    setOffLookupIngredients('');
    setOffLookupNutriments(null);
    setDraftStatus('idle');
    setIsDirty(false);
    setPendingUpc(null);
    setLastAcceptedUpc(null);
    setLastAcceptedAtMs(0);
  }, []);

  const handleCancelCreate = useCallback(() => {
    resetCreateForm();
    setScannerMode(ScannerMode.INVENTORY_CREATE);
    setScannerModalOpen(true);
  }, [resetCreateForm, setScannerMode, setScannerModalOpen]);

  const applyLookupDrafts = useCallback(
    (
      lookupData: {
        name?: string;
        price?: number;
        sizeOz?: number;
        sizeUnit?: SizeUnit;
        containerType?: UpcContainerType;
        isEligible?: boolean;
        depositValue?: number;
      },
      productData?: Partial<Product>
    ) => {
      // Always overwrite with new lookup data for scan autofill reliability
      setUpcDraft(prev => ({
        ...prev,
        name: lookupData.name ?? '',
        price: Number(lookupData.price ?? 0),
        sizeOz: Number(lookupData.sizeOz ?? 0),
        sizeUnit: lookupData.sizeUnit ?? prev.sizeUnit,
        containerType: lookupData.containerType ?? prev.containerType,
        isEligible: lookupData.isEligible ?? prev.isEligible,
        depositValue: Number(lookupData.depositValue ?? prev.depositValue ?? 0)
      }));

      if (!productData && !lookupData) return;

      setNewProduct(prev => {
        const resolvedContainerType = lookupData.containerType;
        const resolvedIsGlass =
          resolvedContainerType === 'glass' ? true : resolvedContainerType ? false : undefined;
        return {
          ...prev,
          name: productData?.name ?? lookupData.name ?? '',
          brand: productData?.brand ?? '',
          productType: productData?.productType ?? '',
          nutritionNote: productData?.nutritionNote ?? '',
          storageZone: productData?.storageZone ?? '',
          storageBin: productData?.storageBin ?? '',
          image: productData?.image ?? '',
          stock: Number(productData?.stock ?? 0),
          price: Number(productData?.price ?? 0),
          sizeOz: Number(productData?.sizeOz ?? lookupData.sizeOz ?? 0),
          sizeUnit: lookupData.sizeUnit ?? prev.sizeUnit,
          isGlass: resolvedIsGlass === undefined ? prev.isGlass : resolvedIsGlass
        };
      });
    },
    [setNewProduct, setUpcDraft]
  );

  const applyOffLookup = useCallback(
    (payload: OffLookupProduct) => {
      if (!payload) return;
      const quantityParsed = parseOffQuantity(payload.quantity);
      const category = payload.categories ? String(payload.categories).split(',')[0]?.trim() : '';
      const nutritionNote = buildNutritionNoteFromOff(payload.ingredients, payload.nutriments);
      setOffLookupIngredients(payload.ingredients || '');
      setOffLookupNutriments(payload.nutriments || null);

      applyLookupDrafts(
        {
          name: payload.name,
          sizeOz: quantityParsed?.size,
          sizeUnit: quantityParsed?.unit,
          price: undefined,
          depositValue: undefined,
          isEligible: undefined,
          containerType: undefined
        },
        {
          name: payload.name || '',
          brand: payload.brand || '',
          image: payload.imageUrl || '',
          productType: category || '',
          nutritionNote
        }
      );
    },
    [applyLookupDrafts]
  );

  const fetchOffLookup = useCallback(
    async (upc: string) => {
      const normalized = String(upc || '').replace(/\D/g, '').trim();
      if (!normalized) return;

      const requestId = offLookupRequestIdRef.current + 1;
      offLookupRequestIdRef.current = requestId;
      setOffLookupStatus('loading');
      setOffLookupMessage('Fetching product info…');
      setOffLookupIngredients('');
      setOffLookupNutriments(null);

      try {
        const res = await fetch(`${BACKEND_URL}/api/upc/off/${normalized}`, {
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (offLookupRequestIdRef.current !== requestId) return;

        if (!res.ok) throw new Error(data?.error || 'Lookup failed');

        if (!data?.found) {
          setOffLookupStatus('not_found');
          setOffLookupMessage('Not found in OFF—enter details manually');
          return;
        }

        applyOffLookup(data.product);
        setOffLookupStatus('found');
        setOffLookupMessage('Auto-filled from Open Food Facts (editable).');
      } catch (e) {
        if (offLookupRequestIdRef.current !== requestId) return;
        setOffLookupStatus('error');
        setOffLookupMessage(OFF_LOOKUP_FALLBACK_MESSAGE);
      }
    },
    [applyOffLookup]
  );

  const apiCreateProduct = useCallback(async (upcOverride?: string) => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const resolvedUpc = upcOverride ?? scannedUpcForCreation;
      // Check if UPC is in registry
      let upcInRegistry = false;
      let productIdToEdit = '';
      if (resolvedUpc) {
        upcInRegistry = upcItemsRef.current.some(item => item.upc === resolvedUpc);
        // Try to find product by UPC
        const productMatch = products.find((p: any) => p.upc === resolvedUpc);
        if (productMatch && productMatch.id) {
          productIdToEdit = productMatch.id;
        }
      }
      let res, data;
      if (upcInRegistry && productIdToEdit) {
        // Edit product
        res = await fetch(`${BACKEND_URL}/api/products/${productIdToEdit}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: newProduct.name.trim(),
            price: Number(newProduct.price),
            deposit: upcDraft.depositValue ?? (upcDraft.isEligible ? 0.1 : 0),
            stock: Number(newProduct.stock),
            sizeOz: Number(newProduct.sizeOz),
            sizeUnit: newProduct.sizeUnit,
            category: newProduct.category,
            brand: newProduct.brand,
            productType: newProduct.productType,
            nutritionNote: newProduct.nutritionNote,
            storageZone: newProduct.storageZone,
            storageBin: newProduct.storageBin,
            image: newProduct.image,
            isGlass: !!newProduct.isGlass,
            isHeavy: !!newProduct.isHeavy,
            upc: resolvedUpc
          })
        });
      } else {
        // Create product
        res = await fetch(`${BACKEND_URL}/api/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: newProduct.name.trim(),
            price: Number(newProduct.price),
            deposit: upcDraft.depositValue ?? (upcDraft.isEligible ? 0.1 : 0),
            stock: Number(newProduct.stock),
            sizeOz: Number(newProduct.sizeOz),
            sizeUnit: newProduct.sizeUnit,
            category: newProduct.category,
            brand: newProduct.brand,
            productType: newProduct.productType,
            nutritionNote: newProduct.nutritionNote,
            storageZone: newProduct.storageZone,
            storageBin: newProduct.storageBin,
            image: newProduct.image,
            isGlass: !!newProduct.isGlass,
            isHeavy: !!newProduct.isHeavy,
            upc: resolvedUpc
          })
        });
      }
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || (upcInRegistry ? 'Update failed' : 'Create failed'));

      const created: Product = {
        ...data.product,
        sizeUnit: data.product?.sizeUnit || newProduct.sizeUnit,
        nutritionNote: data.product?.nutritionNote || newProduct.nutritionNote
      };
      setProducts(prev => [created, ...prev]);

      // Link UPC to SKU if scanned
      if (resolvedUpc) {
        try {
          await fetch(`${BACKEND_URL}/api/upc/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ upc: resolvedUpc, productId: created.id })
          });

          const canWriteRegistry =
            activeModule === 'inventory' && scannerMode === ScannerMode.INVENTORY_CREATE;
          if (canWriteRegistry) {
            const sizeOz = Number.isFinite(Number(newProduct.sizeOz))
              ? Number(newProduct.sizeOz)
              : Number(upcDraft.sizeOz || 0);
            const sizeUnit = newProduct.sizeUnit || upcDraft.sizeUnit;
            const registryPayload = {
              upc: resolvedUpc,
              name: upcDraft.name || newProduct.name.trim(),
              brand: newProduct.brand,
              productType: newProduct.productType,
              depositValue: upcDraft.isEligible ? 0.1 : 0,
              price: Number(newProduct.price),
              sizeOz,
              sizeUnit,
              isEligible: upcDraft.isEligible,
              containerType: upcDraft.containerType
            };
            const registryExists = upcItemsRef.current.some(
              item => item.upc === resolvedUpc
            );

            if (!registryExists) {
              const registryRes = await fetch(`${BACKEND_URL}/api/upc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(registryPayload)
              });
              if (!registryRes.ok && registryRes.status !== 409) {
                const registryData = await registryRes.json().catch(() => ({}));
                throw new Error(registryData?.error || 'Failed to create UPC registry entry');
              }
            }

            // Update UPC metadata
            await fetch(`${BACKEND_URL}/api/upc/${resolvedUpc}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                name: registryPayload.name,
                brand: registryPayload.brand,
                productType: registryPayload.productType,
                sizeOz: registryPayload.sizeOz,
                sizeUnit: registryPayload.sizeUnit,
                isEligible: registryPayload.isEligible,
                containerType: registryPayload.containerType
              })
            });
          }
        } catch (linkError) {
          console.error('Failed to link UPC:', linkError);
          // Don't fail the whole creation
        }
      }

      // Mark UPC as recently handled to prevent immediate re-read
      if (resolvedUpc) {
        recentUpcSetRef.current.set(resolvedUpc, Date.now());
      }

      // Set status and auto-reset after 500ms (fast intake UX)
      setDraftStatus('saved');
      setTimeout(() => {
        resetCreateForm();
        setScannerMode(ScannerMode.INVENTORY_CREATE);
      }, 500);

      return created;
    } catch (e: any) {
      setCreateError(e?.message || 'Create failed');
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [
    activeModule,
    newProduct,
    resetCreateForm,
    scannerMode,
    setProducts,
    setScannerModalOpen,
    setScannerMode,
    upcDraft,
    upcItemsRef,
    scannedUpcForCreation
  ]);

  const handleScannerScan = useCallback(
    async (upc: string) => {
      // Step 1: Normalize
      const normalized = String(upc).replace(/\D/g, '').trim();
      if (!normalized) return;

      // Step 2: Reject if saving
      if (draftStatus === 'savingUpc' || draftStatus === 'savingInventory') {
        return; // Ignore scans during save
      }

      // Step 3: Reject duplicates in cooldown window
      const now = Date.now();
      if (lastAcceptedUpc === normalized && now - lastAcceptedAtMs < COOLDOWN_MS) {
        return; // Cooldown active
      }

      // Step 4: Reject "recently handled" UPCs
      const recentTimestamp = recentUpcSetRef.current.get(normalized);
      if (recentTimestamp && now - recentTimestamp < RECENT_TTL_MS) {
        return; // Recently saved, suppress re-read
      }

      // Step 5: Decide whether to replace the current draft
      if (isDirty && scannedUpcForCreation && scannedUpcForCreation !== normalized) {
        // User is editing, don't auto-replace
        setPendingUpc(normalized);
        // Toast will be shown by component
        return;
      }

      // Accept the scan
      setLastAcceptedUpc(normalized);
      setLastAcceptedAtMs(now);
      setDraftStatus('scanned');
      setIsDirty(false);

      if (batchMode) {
        queueUpc(normalized);
        setUpcInput(normalized);
        return;
      }

      // Set authoritative creation UPC
      setScannedUpcForCreation(normalized);
      upcLastScannedRef.current = normalized;
      setOffLookupStatus('idle');
      setOffLookupMessage('');
      setOffLookupIngredients('');
      setOffLookupNutriments(null);

      // Initialize draft with defaults
      setUpcDraft(prev => ({
        ...prev,
        upc: normalized,
        name: '',
        price: 0,
        depositValue: 0.1,
        containerType: 'plastic',
        sizeOz: 0,
        sizeUnit: 'oz',
        isEligible: true
      }));
      setNewProduct(prev => ({
        ...prev,
        name: '',
        brand: '',
        productType: '',
        nutritionNote: '',
        storageZone: '',
        storageBin: '',
        image: '',
        stock: 0,
        price: 0,
        sizeOz: 0,
        sizeUnit: 'oz',
        isGlass: false
      }));
      setUpcInput(normalized);

      // Trigger auto-fill from OFF lookup
      void fetchOffLookup(normalized);

      // Photo is captured manually via button
      try {
        const scanRes = await fetch(`${BACKEND_URL}/api/upc/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ upc: normalized, qty: 1, resolveOnly: true })
        });
        const scanData = await scanRes.json().catch(() => ({}));
        if (!scanRes.ok) throw new Error(scanData?.error || 'UPC lookup failed');

        if (upcLastScannedRef.current !== normalized) return;

        const upcEntry = scanData?.upcEntry;
        const resolvedProduct = scanData?.product;
        const mappedLookup = upcEntry
          ? {
              name: upcEntry?.name,
              price: Number(upcEntry?.price || 0),
              sizeOz: Number(upcEntry?.sizeOz || 0),
              containerType: upcEntry?.containerType,
              isEligible: upcEntry?.isEligible !== false,
              depositValue: Number(upcEntry?.depositValue || 0)
            }
          : undefined;

        if (mappedLookup || resolvedProduct) {
          applyLookupDrafts(mappedLookup || {}, resolvedProduct || undefined);
          return;
        }

        const eligibilityRes = await fetch(
          `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(normalized)}`
        );
        if (!eligibilityRes.ok) return;
        const eligibilityData = await eligibilityRes.json().catch(() => ({}));
        if (upcLastScannedRef.current !== normalized) return;

        applyLookupDrafts({
          name: eligibilityData?.name,
          price: Number(eligibilityData?.price || 0),
          sizeOz: Number(eligibilityData?.sizeOz || 0),
          containerType: eligibilityData?.containerType,
          isEligible: eligibilityData?.eligible !== false,
          depositValue: Number(eligibilityData?.depositValue || 0)
        });
      } catch (err) {
        console.error('UPC lookup failed:', err);
      }
    },
    [
      applyLookupDrafts,
      batchMode,
      draftStatus,
      fetchOffLookup,
      isDirty,
      lastAcceptedAtMs,
      lastAcceptedUpc,
      queueUpc,
      scannedUpcForCreation,
      setUpcDraft,
      setUpcInput
    ]
  );

  const handleManualUpcChange = useCallback(
    (value: string) => {
      const normalized = String(value || '').replace(/\D/g, '').trim();
      setScannedUpcForCreation(normalized);
      upcLastScannedRef.current = normalized;
      setUpcInput(normalized);
      setUpcDraft(prev => ({ ...prev, upc: normalized }));
      setOffLookupStatus('idle');
      setOffLookupMessage('');
          setOffLookupIngredients('');
          setOffLookupNutriments(null);
        }, [setScannedUpcForCreation, setUpcDraft, setUpcInput]);
      
        const handleAddToUpcRegistry = useCallback(() => {
          if (!scannedUpcForCreation) return;
          setUpcDraft(prev => ({
            ...prev,
            upc: scannedUpcForCreation,
            isEligible: true,
            depositValue: 0.1
          }));
          setNewProduct(prev => ({ ...prev, deposit: 0.1 }));
          setOffLookupMessage('Added to UPC Registry. Deposit set to $0.10 and marked eligible.');
        }, [scannedUpcForCreation, setUpcDraft, setNewProduct, setOffLookupMessage]);
      
        return {
          isCreating,
          setIsCreating,
    createError,
    setCreateError,
    newProduct,
    setNewProduct,
    scannedUpcForCreation,
    setScannedUpcForCreation,
    offLookupStatus,
    offLookupMessage,
    setOffLookupMessage,
    offLookupIngredients,
    offLookupNutriments,
    offNutritionEntries,
    fetchOffLookup,
    handleManualUpcChange,
    handleScannerScan,
    handleCancelCreate,
    apiCreateProduct,
    handleAddToUpcRegistry,
    draftStatus,
    setDraftStatus,
    isDirty,
    setIsDirty,
    pendingUpc,
    setPendingUpc,
    lastAcceptedUpc,
    lastAcceptedAtMs,
    batchMode,
    toggleBatchMode,
    batchQueue,
    setBatchQueue,
    addBatchQueueToRegistry
  };
};
