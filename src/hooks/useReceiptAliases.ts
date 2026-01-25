import { useState, useCallback, useEffect } from 'react';
import { BACKEND_URL } from '../constants';

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

interface NoiseRuleEntry {
  id: string;
  normalizedName: string;
  rawNames: Array<{ name: string; occurrences?: number }>;
  lastSeenAt?: string;
}

export const useReceiptAliases = (activeStoreId: string) => {
  const [receiptAliases, setReceiptAliases] = useState<ReceiptAliasRecord[]>([]);
  const [isAliasLoading, setIsAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasServiceStatus, setAliasServiceStatus] = useState<null | 'pricing-disabled' | 'db-not-ready'>(null);
  const [aliasActionId, setAliasActionId] = useState<string | null>(null);
  
  const [noiseRules, setNoiseRules] = useState<NoiseRuleEntry[]>([]);
  const [isLoadingNoiseRules, setIsLoadingNoiseRules] = useState(false);

  const fetchReceiptAliases = useCallback(async () => {
    if (!activeStoreId) return;
    setIsAliasLoading(true);
    setAliasError(null);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-aliases?storeId=${activeStoreId}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load aliases');
      }
      const data = await resp.json().catch(() => ({}));
      setReceiptAliases(Array.isArray(data.aliases) ? data.aliases : []);
    } catch (err: any) {
      setAliasError(err?.message || 'Failed to load aliases');
    } finally {
      setIsAliasLoading(false);
    }
  }, [activeStoreId]);

  const fetchNoiseRules = useCallback(async () => {
    if (!activeStoreId) return;
    setIsLoadingNoiseRules(true);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-noise-rules?storeId=${activeStoreId}`, {
        credentials: 'include'
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load noise rules');
      }
      const data = await resp.json().catch(() => ({}));
      setNoiseRules(Array.isArray(data.rules) ? data.rules : []);
    } catch (err: any) {
      // Silently fail for noise rules
      setNoiseRules([]);
    } finally {
      setIsLoadingNoiseRules(false);
    }
  }, [activeStoreId]);

  // Fetch when store changes
  useEffect(() => {
    if (activeStoreId) {
      void fetchReceiptAliases();
      void fetchNoiseRules();
    }
  }, [activeStoreId, fetchReceiptAliases, fetchNoiseRules]);

  return {
    receiptAliases,
    setReceiptAliases,
    isAliasLoading,
    aliasError,
    setAliasError,
    aliasServiceStatus,
    setAliasServiceStatus,
    aliasActionId,
    setAliasActionId,
    noiseRules,
    setNoiseRules,
    isLoadingNoiseRules,
    refreshAliases: fetchReceiptAliases,
    refreshNoiseRules: fetchNoiseRules
  };
};
