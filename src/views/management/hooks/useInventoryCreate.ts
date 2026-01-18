import { useCallback, useMemo, useRef, useState } from 'react';
import type { Product, SizeUnit, UpcContainerType, UpcItem } from '../../../types';
import { ScannerMode } from '../../../types';
import {
  BACKEND_URL,
  DEFAULT_NEW_PRODUCT,
  OFF_LOOKUP_FALLBACK_MESSAGE
} from '../constants';
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
  upcItemsRef
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

  const resetCreateForm = useCallback(() => {
    setNewProduct({ ...DEFAULT_NEW_PRODUCT });
    setScannedUpcForCreation('');
    setCreateError(null);
    setOffLookupStatus('idle');
    setOffLookupMessage('');
    setOffLookupIngredients('');
    setOffLookupNutriments(null);
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
      setUpcDraft(prev => ({
        ...prev,
        name: shouldFillText(prev.name, lookupData.name),
        price: shouldFillNumber(prev.price, lookupData.price),
        sizeOz: shouldFillNumber(prev.sizeOz, lookupData.sizeOz),
        sizeUnit: !lookupData.sizeUnit ? prev.sizeUnit : lookupData.sizeUnit,
        containerType: lookupData.containerType || prev.containerType,
        isEligible: lookupData.isEligible ?? prev.isEligible,
        depositValue:
          Number.isFinite(prev.depositValue) && prev.depositValue > 0
            ? prev.depositValue
            : Number.isFinite(lookupData.depositValue)
            ? Number(lookupData.depositValue)
            : prev.depositValue
      }));

      if (!productData && !lookupData) return;

      setNewProduct(prev => {
        const resolvedContainerType = lookupData.containerType;
        const resolvedIsGlass =
          resolvedContainerType === 'glass' ? true : resolvedContainerType ? false : undefined;
        return {
          ...prev,
          name: shouldFillText(prev.name, productData?.name || lookupData.name),
          brand: shouldFillText(prev.brand, productData?.brand),
          productType: shouldFillText(prev.productType, productData?.productType),
          nutritionNote: shouldFillText(prev.nutritionNote, productData?.nutritionNote),
          storageZone: shouldFillText(prev.storageZone, productData?.storageZone),
          storageBin: shouldFillText(prev.storageBin, productData?.storageBin),
          image: shouldFillText(prev.image, productData?.image),
          stock: shouldFillNumber(prev.stock, productData?.stock),
          price: shouldFillNumber(prev.price, productData?.price),
          sizeOz: shouldFillNumber(prev.sizeOz, productData?.sizeOz || lookupData.sizeOz),
          sizeUnit: !lookupData.sizeUnit ? prev.sizeUnit : lookupData.sizeUnit,
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

  const apiCreateProduct = useCallback(async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newProduct.name.trim(),
          price: Number(newProduct.price),
          deposit: upcDraft.isEligible ? 0.1 : 0.0,
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
          isGlass: !!newProduct.isGlass
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create failed');

      const created: Product = {
        ...data.product,
        sizeUnit: data.product?.sizeUnit || newProduct.sizeUnit,
        nutritionNote: data.product?.nutritionNote || newProduct.nutritionNote
      };
      setProducts(prev => [created, ...prev]);

      // Link UPC to SKU if scanned
      if (scannedUpcForCreation) {
        try {
          await fetch(`${BACKEND_URL}/api/upc/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ upc: scannedUpcForCreation, productId: created.id })
          });

          const canWriteRegistry =
            activeModule === 'inventory' && scannerMode === ScannerMode.INVENTORY_CREATE;
          if (canWriteRegistry) {
            const sizeOz = Number.isFinite(Number(newProduct.sizeOz))
              ? Number(newProduct.sizeOz)
              : Number(upcDraft.sizeOz || 0);
            const sizeUnit = newProduct.sizeUnit || upcDraft.sizeUnit;
            const registryPayload = {
              upc: scannedUpcForCreation,
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
              item => item.upc === scannedUpcForCreation
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
            await fetch(`${BACKEND_URL}/api/upc/${scannedUpcForCreation}`, {
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

      resetCreateForm();
      setScannerMode(ScannerMode.INVENTORY_CREATE);
      setScannerModalOpen(true);
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
    scannedUpcForCreation,
    scannerMode,
    setProducts,
    setScannerModalOpen,
    setScannerMode,
    upcDraft,
    upcItemsRef
  ]);

  const handleScannerScan = useCallback(
    async (upc: string) => {
      // Normalize: digits only
      const normalized = String(upc).replace(/\D/g, '').trim();
      if (!normalized) return;

      // Set authoritative creation UPC and override only relevant fields
      setScannedUpcForCreation(normalized);
      upcLastScannedRef.current = normalized;
      setOffLookupStatus('idle');
      setOffLookupMessage('');
      setOffLookupIngredients('');
      setOffLookupNutriments(null);
      // Clear only auto-fill fields before new lookup
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
    [applyLookupDrafts, fetchOffLookup, setUpcDraft, setUpcInput]
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
    },
    [setUpcDraft, setUpcInput]
  );

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
    apiCreateProduct
  };
};
