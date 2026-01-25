import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UpcItem } from '../../../types';
import { BACKEND_URL } from '../../../constants'; // already correct

const DEFAULT_UPC_DRAFT: UpcItem = {
  upc: '',
  name: '',
  depositValue: 0.1,
  price: 0,
  containerType: 'plastic',
  sizeOz: 0,
  sizeUnit: 'oz',
  isEligible: true
};

interface UseUpcRegistryParams {
  activeModule: string;
}

export const useUpcRegistry = ({ activeModule }: UseUpcRegistryParams) => {
  const [upcItems, setUpcItems] = useState<UpcItem[]>([]);
  const [upcInput, setUpcInput] = useState('');
  const [upcFilter, setUpcFilter] = useState('');
  const [upcDraft, setUpcDraft] = useState<UpcItem>(DEFAULT_UPC_DRAFT);
  const [isUpcLoading, setIsUpcLoading] = useState(false);
  const [isUpcSaving, setIsUpcSaving] = useState(false);
  const [upcError, setUpcError] = useState<string | null>(null);
  const upcItemsRef = useRef<UpcItem[]>([]);

  const apiLoadUpcItems = useCallback(async () => {
    setUpcError(null);
    setIsUpcLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'GET',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load UPC list');
      setUpcItems(Array.isArray(data?.upcItems) ? data.upcItems : []);
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to load UPC list');
    } finally {
      setIsUpcLoading(false);
    }
  }, []);

  const loadUpcDraft = useCallback((entry: UpcItem) => {
    setUpcDraft({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: 0.1,
      price: Number(entry.price || 0),
      containerType: entry.containerType || 'plastic',
      sizeOz: Number(entry.sizeOz || 0),
      sizeUnit: entry.sizeUnit || 'oz',
      isEligible: entry.isEligible !== false
    });
  }, []);

  const handleUpcLookup = useCallback(
    (upc?: string) => {
      const targetUpc = upc || upcInput.trim();
      if (!targetUpc) {
        setUpcError('UPC is required.');
        return;
      }

      setUpcError(null);
      const existing = upcItems.find(item => item.upc === targetUpc);
      if (existing) {
        loadUpcDraft(existing);
        return;
      }

      setUpcDraft({
        upc: targetUpc,
        name: '',
        depositValue: 0.1,
        price: 0,
        containerType: 'plastic',
        sizeOz: 0,
        sizeUnit: 'oz',
        isEligible: true
      });
    },
    [loadUpcDraft, upcInput, upcItems]
  );

  const apiSaveUpc = useCallback(async () => {
    if (!upcDraft.upc) {
      setUpcError('UPC is required.');
      return;
    }

    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          upc: upcDraft.upc,
          name: upcDraft.name,
          depositValue: Number(upcDraft.depositValue || 0),
          price: Number(upcDraft.price || 0),
          containerType: upcDraft.containerType,
          sizeOz: Number(upcDraft.sizeOz || 0),
          sizeUnit: upcDraft.sizeUnit,
          isEligible: upcDraft.isEligible
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save UPC');
      const saved: UpcItem = {
        ...data.upcItem,
        sizeUnit: data.upcItem?.sizeUnit || upcDraft.sizeUnit
      };
      setUpcItems(prev => {
        const next = prev.filter(item => item.upc !== saved.upc);
        return [saved, ...next];
      });
      // Vibrate device after successful save if supported
      if (typeof window !== 'undefined' && 'vibrate' in window.navigator) {
        window.navigator.vibrate(100);
      }
      // Clear inputs after successful save
      setUpcInput('');
      setUpcDraft(DEFAULT_UPC_DRAFT);
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to save UPC');
    } finally {
      setIsUpcSaving(false);
    }
  }, [upcDraft]);

  const apiDeleteUpc = useCallback(async () => {
    if (!upcDraft.upc) return;
    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/${upcDraft.upc}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete UPC');
      setUpcItems(prev => prev.filter(item => item.upc !== upcDraft.upc));
      // Invalidate caches
      try {
        localStorage.removeItem('ninpo_upc_eligibility_v1');
      } catch {}
      setUpcDraft(DEFAULT_UPC_DRAFT);
      setUpcInput('');
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to delete UPC');
    } finally {
      setIsUpcSaving(false);
    }
  }, [upcDraft]);

  const apiDeleteUpcDirect = useCallback(async (upc: string) => {
    if (!upc) return;
    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/${upc}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete UPC');
      setUpcItems(prev => prev.filter(item => item.upc !== upc));
      // Invalidate caches
      try {
        localStorage.removeItem('ninpo_upc_eligibility_v1');
      } catch {}
      // Clear draft if it was the deleted UPC
      if (upcDraft.upc === upc) {
        setUpcDraft(DEFAULT_UPC_DRAFT);
        setUpcInput('');
      }
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to delete UPC');
    } finally {
      setIsUpcSaving(false);
    }
  }, [upcDraft.upc]);

  const apiLinkUpc = useCallback(async (upc: string, productId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ upc, productId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Link failed');
    } catch (e: any) {
      setUpcError(e?.message || 'Link failed');
    }
  }, []);

  useEffect(() => {
    const shouldLoad = ['upc', 'upc-registry', 'pricing-intelligence', 'inventory'].includes(activeModule);
    if (shouldLoad && upcItems.length === 0 && !isUpcLoading) {
      apiLoadUpcItems();
    }
  }, [activeModule, apiLoadUpcItems, isUpcLoading, upcItems.length]);

  useEffect(() => {
    upcItemsRef.current = upcItems;
  }, [upcItems]);

  const filteredUpcItems = useMemo(() => {
    const needle = upcFilter.trim().toLowerCase();
    if (!needle) return upcItems;
    return upcItems.filter(item => {
      return (
        item.upc.toLowerCase().includes(needle) ||
        (item.name || '').toLowerCase().includes(needle)
      );
    });
  }, [upcFilter, upcItems]);

  const handleUpcScannerScan = useCallback(
    (upc: string) => {
      setUpcInput(upc);
      handleUpcLookup(upc);
    },
    [handleUpcLookup]
  );

  return {
    upcItems,
    setUpcItems,
    upcItemsRef,
    upcInput,
    setUpcInput,
    upcFilter,
    setUpcFilter,
    upcDraft,
    setUpcDraft,
    isUpcLoading,
    isUpcSaving,
    upcError,
    apiLoadUpcItems,
    handleUpcLookup,
    apiSaveUpc,
    apiDeleteUpc,
    apiDeleteUpcDirect,
    apiLinkUpc,
    loadUpcDraft,
    filteredUpcItems,
    handleUpcScannerScan
  };
};
