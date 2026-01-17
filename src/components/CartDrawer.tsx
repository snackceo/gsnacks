// CartDrawer.tsx (FULL REPLACEMENT)
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ShoppingBag,
  X,
  Trash2,
  Loader2,
  Zap,
  Landmark,
  Plus,
  ScanLine,
  Info,
  AlertCircle
} from 'lucide-react';
import { Product, ReturnUpcCount, UserTier, ScannerMode } from '../types';
import ScannerModal from './ScannerModal'; // adjust path if your ScannerModal lives elsewhere
import { useNinpoCore } from '../hooks/useNinpoCore';

interface CartItem {
  productId: string;
  quantity: number;
}

type ReturnPayoutMethod = 'CREDIT' | 'CASH';

interface CartDrawerProps {
  isOpen: boolean;
  cart: CartItem[];
  products: Product[];
  address: string;
  acceptedPolicies: boolean;
  isProcessing: boolean;
  currentUserId?: string;
  membershipTier?: UserTier;

  onClose: () => void;
  onAddressChange: (v: string) => void;
  onPolicyChange: (v: boolean) => void;

  onRemoveItem: (productId: string) => void;

  onPayCredits: (
    returnUpcs: ReturnUpcCount[],
    returnPayoutMethod: ReturnPayoutMethod
  ) => Promise<boolean>;

  onPayExternal: (
    gateway: 'STRIPE' | 'GPAY',
    returnUpcs: ReturnUpcCount[],
    returnPayoutMethod: ReturnPayoutMethod
  ) => void;
}

const LS_KEY_UPCS = 'ninpo_return_upcs_v1';
const LS_KEY_UPC_ELIGIBILITY = 'ninpo_upc_eligibility_v1';
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';
const UPC_ELIGIBILITY_TTL_MS = 1 * 60 * 60 * 1000;

// Michigan default deposit
const MI_DEPOSIT_VALUE = 0.1; // 10¢
const DEFAULT_HANDLING_FEE = 0.02;
const DEFAULT_GLASS_HANDLING_FEE = 0.02;
const NOT_ELIGIBLE_MESSAGE = "This container isn't eligible for return value.";

type UpcEligibilityCache = Record<
  string,
  {
    isEligible: boolean;
    checkedAt: string;
    name?: string;
    containerType?: string;
    sizeOz?: number;
  }
>;

type ReturnUpcEntry = ReturnUpcCount;

type QuoteResponse = {
  subtotal: number;
  total: number;
  routeFeeFinal: number;
  distanceFeeFinal: number;
  distanceMiles: number;
};

function money(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}

const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  cart,
  products,
  address,
  acceptedPolicies,
  isProcessing,
  currentUserId,
  membershipTier,
  onClose,
  onAddressChange,
  onPolicyChange,
  onRemoveItem,
  onPayCredits,
  onPayExternal
}) => {
  const { addToast } = useNinpoCore();
  // ----------------------------
  // Container returns (Customer scanner)
  // ----------------------------
  const [returnUpcs, setReturnUpcs] = useState<ReturnUpcEntry[]>([]);
  const [manualUpc, setManualUpc] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [lastBlockedUpc, setLastBlockedUpc] = useState<string | null>(null);
  const [lastBlockedReason, setLastBlockedReason] = useState<'cooldown' | 'duplicate' | null>(null);

  const [hasEligibilityCache, setHasEligibilityCache] = useState(false);
  const [eligibilityCache, setEligibilityCache] = useState<UpcEligibilityCache>({});
  const eligibilityCacheRef = useRef<UpcEligibilityCache>({});

  const [showBottleReturnAdvisory, setShowBottleReturnAdvisory] = useState(false);
  const [showPolicyAdvisories, setShowPolicyAdvisories] = useState(false);

  const [useCashPayout, setUseCashPayout] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Anti-spam throttle for scanner input (ScannerModal already has cooldown, but we still need
  // to prevent repeated eligibility calls when the camera sees the same code repeatedly).
  const lastScanAtRef = useRef<number>(0);

  const normalizeReturnUpcs = (raw: unknown): ReturnUpcEntry[] => {
    if (!Array.isArray(raw)) return [];
    if (raw.length === 0) return [];

    // Legacy: stored as string[] of UPCs
    if (typeof raw[0] === 'string') {
      const counts = new Map<string, number>();
      raw.forEach(value => {
        const upc = String(value || '').trim();
        if (!upc) return;
        counts.set(upc, (counts.get(upc) || 0) + 1);
      });
      return Array.from(counts.entries()).map(([upc, quantity]) => ({ upc, quantity }));
    }

    return raw
      .map(entry => ({
        upc: String((entry as ReturnUpcEntry)?.upc || '').trim(),
        quantity: Math.max(1, Number((entry as ReturnUpcEntry)?.quantity || 1))
      }))
      .filter(entry => entry.upc);
  };

  // Load UPCs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_UPCS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setReturnUpcs(normalizeReturnUpcs(parsed));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load eligibility cache on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_UPC_ELIGIBILITY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        eligibilityCacheRef.current = parsed as UpcEligibilityCache;
        setEligibilityCache(parsed as UpcEligibilityCache);
        setHasEligibilityCache(Object.keys(parsed).length > 0);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist UPCs
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_UPCS, JSON.stringify(returnUpcs));
    } catch {
      // ignore
    }
  }, [returnUpcs]);

  const updateEligibilityCache = useCallback(
    (
      upc: string,
      payload: {
        isEligible: boolean;
        name?: string;
        containerType?: string;
        sizeOz?: number;
      }
    ) => {
      const next = {
        ...eligibilityCacheRef.current,
        [upc]: {
          isEligible: payload.isEligible,
          name: payload.name,
          containerType: payload.containerType,
          sizeOz: payload.sizeOz,
          checkedAt: new Date().toISOString()
        }
      };
      eligibilityCacheRef.current = next;
      setEligibilityCache(next);
      setHasEligibilityCache(true);
      try {
        localStorage.setItem(LS_KEY_UPC_ELIGIBILITY, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    []
  );

  const clearEligibilityCache = () => {
    eligibilityCacheRef.current = {};
    setEligibilityCache({});
    setHasEligibilityCache(false);
    try {
      localStorage.removeItem(LS_KEY_UPC_ELIGIBILITY);
    } catch {
      // ignore
    }
  };

  const isEligibilityCacheFresh = (checkedAt?: string) => {
    if (!checkedAt) return false;
    const parsed = Date.parse(checkedAt);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed < UPC_ELIGIBILITY_TTL_MS;
  };

  // IMPORTANT FIX:
  // Your previous logic refused duplicates, which is wrong for returns.
  // Scanning the same UPC multiple times should increment quantity.
  const addOrIncrementUpc = (upc: string) => {
    setReturnUpcs(prev => {
      const existing = prev.find(e => e.upc === upc);
      if (!existing) return [{ upc, quantity: 1 }, ...prev];
      return prev.map(e => (e.upc === upc ? { ...e, quantity: e.quantity + 1 } : e));
    });

    setScannerError(null);
    setManualUpc('');
    setLastBlockedUpc(null);
    setLastBlockedReason(null);
  };

  const incrementUpc = (upc: string) => {
    setReturnUpcs(prev =>
      prev.map(entry =>
        entry.upc === upc ? { ...entry, quantity: entry.quantity + 1 } : entry
      )
    );
  };

  const decrementUpc = (upc: string) => {
    setReturnUpcs(prev =>
      prev
        .map(entry =>
          entry.upc === upc
            ? { ...entry, quantity: Math.max(0, entry.quantity - 1) }
            : entry
        )
        .filter(entry => entry.quantity > 0)
    );
  };

  const addUpc = useCallback(
    async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
      const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
      if (!upc) return;

      // Throttle repeated scan events
      if (source === 'scanner') {
        const now = Date.now();
        if (now - lastScanAtRef.current < 900) return;
        lastScanAtRef.current = now;
      }

      // Basic UPC/EAN sanity check
      if (!/^\d{8,14}$/.test(upc)) {
        setScannerError('Invalid UPC format. Enter 8–14 digits.');
        return;
      }

      const cached = eligibilityCacheRef.current[upc];
      if (cached && isEligibilityCacheFresh(cached.checkedAt)) {
        if (!cached.isEligible) {
          setScannerError(NOT_ELIGIBLE_MESSAGE);
          return;
        }
        addOrIncrementUpc(upc);
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(upc)}`
        );

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          const isEligible = data?.eligible !== false;
          updateEligibilityCache(upc, {
            isEligible,
            name: data?.name,
            containerType: data?.containerType,
            sizeOz: data?.sizeOz
          });

          if (!isEligible) {
            setScannerError(NOT_ELIGIBLE_MESSAGE);
            return;
          }

          addOrIncrementUpc(upc);
          return;
        }

        if (response.status === 404) {
          updateEligibilityCache(upc, { isEligible: false });
          setScannerError(NOT_ELIGIBLE_MESSAGE);
          return;
        }

        const text = await response.text().catch(() => '');
        throw new Error(text || `Eligibility check failed: ${response.status}`);
      } catch {
        setScannerError('Unable to validate UPC eligibility. Please try again.');
      }
    },
    [updateEligibilityCache]
  );

  const removeUpc = (upc: string) => {
    setReturnUpcs(prev => prev.filter(entry => entry.upc !== upc));
  };

  const clearUpcs = () => {
    setReturnUpcs([]);
    setScannerError(null);
  };

  const totalReturnCount = useMemo(
    () => returnUpcs.reduce((sum, entry) => sum + entry.quantity, 0),
    [returnUpcs]
  );

  const cartIsEmpty = cart.length === 0;
  const hasReturnUpcs = totalReturnCount > 0;
  const isPickupOnlyOrder = cartIsEmpty && hasReturnUpcs;

  const depositValue = MI_DEPOSIT_VALUE;
  const handlingFee = DEFAULT_HANDLING_FEE;
  const glassHandlingFee = DEFAULT_GLASS_HANDLING_FEE;
  const netStandardCash = Math.max(0, depositValue - handlingFee);
  const netGlassCash = Math.max(0, depositValue - handlingFee - glassHandlingFee);

  const activeTier = membershipTier ?? UserTier.COMMON;
  const allowCashPayout = [UserTier.GOLD, UserTier.PLATINUM, UserTier.GREEN].includes(activeTier);

  useEffect(() => {
    if (!allowCashPayout && useCashPayout) {
      setUseCashPayout(false);
    }
  }, [allowCashPayout, useCashPayout]);

  const payoutMethod: ReturnPayoutMethod =
    allowCashPayout && useCashPayout ? 'CASH' : 'CREDIT';

  // Estimated deposit credit (preview only)
  const estimatedReturnBreakdown = useMemo(() => {
    if (totalReturnCount === 0) {
      return { gross: 0, handlingFee: 0, glassFee: 0, net: 0 };
    }

    let gross = 0;
    let totalHandlingFee = 0;
    let totalGlassFee = 0;

    for (const entry of returnUpcs) {
      const isGlass = eligibilityCache[entry.upc]?.containerType === 'glass';
      gross += depositValue * entry.quantity;
      totalHandlingFee += handlingFee * entry.quantity;
      if (isGlass) {
        totalGlassFee += glassHandlingFee * entry.quantity;
      }
    }

    const net = gross - totalHandlingFee - totalGlassFee;
    return {
      gross,
      handlingFee: totalHandlingFee,
      glassFee: totalGlassFee,
      net: Math.max(0, net)
    };
  }, [
    depositValue,
    eligibilityCache,
    glassHandlingFee,
    handlingFee,
    returnUpcs,
    totalReturnCount
  ]);

  const estimatedReturnCredit = useMemo(() => {
    if (payoutMethod === 'CASH') {
      return estimatedReturnBreakdown.net;
    }
    return estimatedReturnBreakdown.gross;
  }, [payoutMethod, estimatedReturnBreakdown]);

  // Quote (distance/route fees)
  useEffect(() => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress || (!cart.length && totalReturnCount === 0)) {
      setQuote(null);
      setQuoteError(null);
      setIsQuoteLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsQuoteLoading(true);
      setQuoteError(null);
      try {
        const res = await fetch(`${BACKEND_URL}/api/payments/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            items: cart,
            userId: currentUserId,
            address: trimmedAddress,
            returnUpcCounts: returnUpcs,
            returnPayoutMethod: payoutMethod
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Quote failed');
        }

        setQuote({
          subtotal: Number(data?.subtotal ?? 0),
          total: Number(data?.total ?? 0),
          routeFeeFinal: Number(data?.routeFeeFinal ?? 0),
          distanceFeeFinal: Number(data?.distanceFeeFinal ?? 0),
          distanceMiles: Number(data?.distanceMiles ?? 0)
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setQuote(null);
        setQuoteError(err?.message || 'Quote failed');
      } finally {
        setIsQuoteLoading(false);
      }
    }, 600);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [address, cart, currentUserId, payoutMethod, returnUpcs, totalReturnCount]);

  // ----------------------------
  // Cart totals
  // ----------------------------
  const lineItems = useMemo(() => {
    return cart
      .map(ci => {
        const p = products.find(x => x.id === ci.productId || (x as any).frontendId === ci.productId);
        if (!p) return null;
        const unitPrice = Number(p.price || 0) + Number(p.deposit || 0);
        return {
          product: p,
          productId: ci.productId,
          quantity: ci.quantity,
          unitPrice,
          lineTotal: unitPrice * ci.quantity
        };
      })
      .filter(Boolean) as Array<{
      product: Product;
      productId: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }>;
  }, [cart, products]);

  const subtotal = useMemo(() => lineItems.reduce((sum, li) => sum + li.lineTotal, 0), [lineItems]);
  const depositTotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + Number(li.product.deposit || 0) * li.quantity, 0),
    [lineItems]
  );
  const quoteSubtotal = Number.isFinite(quote?.subtotal) ? Number(quote?.subtotal) : subtotal;

  const quoteDistanceMiles = Number.isFinite(quote?.distanceMiles) ? Number(quote?.distanceMiles) : 0;
  const formattedDistanceMiles = Number.isFinite(quoteDistanceMiles) ? quoteDistanceMiles.toFixed(1) : '0.0';

  const activeRouteFee = Number.isFinite(quote?.routeFeeFinal) ? Number(quote?.routeFeeFinal) : 0;
  const activeDistanceFee = Number.isFinite(quote?.distanceFeeFinal) ? Number(quote?.distanceFeeFinal) : 0;

  const subtotalCents = useMemo(() => Math.round(quoteSubtotal * 100), [quoteSubtotal]);
  const estimatedReturnCreditCents = useMemo(() => Math.round(estimatedReturnCredit * 100), [estimatedReturnCredit]);
  const activeDeliveryFeeCents = Math.round(activeRouteFee * 100);
  const activeDistanceFeeCents = Math.round(activeDistanceFee * 100);

  const creditsCoverDelivery = [UserTier.SILVER, UserTier.GOLD, UserTier.PLATINUM, UserTier.GREEN].includes(activeTier);
  const creditEligibleCents = creditsCoverDelivery
    ? subtotalCents + activeDeliveryFeeCents + activeDistanceFeeCents
    : subtotalCents;

  const creditAppliedCents =
    payoutMethod === 'CASH' ? 0 : Math.min(estimatedReturnCreditCents, creditEligibleCents);

  const deliveryCoveredByCredits =
    payoutMethod !== 'CASH' &&
    creditsCoverDelivery &&
    activeDeliveryFeeCents + activeDistanceFeeCents > 0 &&
    estimatedReturnCreditCents > subtotalCents;

  const previewTotalAfterCredit = useMemo(() => {
    const totalCents =
      subtotalCents + activeDeliveryFeeCents + activeDistanceFeeCents - creditAppliedCents;
    return Math.max(0, totalCents) / 100;
  }, [subtotalCents, activeDeliveryFeeCents, activeDistanceFeeCents, creditAppliedCents]);

  // ----------------------------
  // Scanner lifecycle
  // ----------------------------
  const openScanner = () => {
    setScannerError(null);
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    setLastBlockedUpc(null);
    setLastBlockedReason(null);
  };

  // Close scanner when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setScannerOpen(false);
      setScannerError(null);
      setLastBlockedUpc(null);
      setLastBlockedReason(null);
    }
  }, [isOpen]);

  // ----------------------------
  // Checkout gating
  // ----------------------------
  const canCheckoutCredits =
    (!!address.trim() &&
      acceptedPolicies &&
      !isProcessing &&
      !!membershipTier &&
      (!cartIsEmpty || hasReturnUpcs));

  const canCheckoutStripe =
    (!!address.trim() && acceptedPolicies && !isProcessing && (!cartIsEmpty || hasReturnUpcs));

  const handleCreditsClick = async () => {
    if (!canCheckoutCredits) return;
    const didComplete = await onPayCredits(returnUpcs, payoutMethod);
    if (didComplete) {
      clearUpcs();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-lg bg-ninpo-black border-l border-white/5 shadow-2xl transition-transform ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-ninpo-lime" />
              <div>
                <p className="text-white font-black uppercase tracking-widest text-sm">Cart</p>
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                  Review • Container returns • Checkout
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Cart Items */}
            <div className="space-y-3">
              {lineItems.length === 0 ? (
                <div className="p-10 bg-white/5 border border-white/10 rounded-3xl text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-600">
                    Cart is empty
                  </p>
                </div>
              ) : (
                lineItems.map(li => (
                  <div
                    key={li.productId}
                    className="bg-white/5 border border-white/10 rounded-3xl p-5 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-white font-black truncate">{li.product.name}</p>
                      <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                        {li.quantity} × {money(li.unitPrice)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <p className="text-white font-black">{money(li.lineTotal)}</p>
                      <button
                        onClick={() => onRemoveItem(li.productId)}
                        className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-ninpo-red/20 hover:border-ninpo-red/20 transition"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Container Returns */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-black uppercase tracking-widest text-xs">
                      Container Returns (Optional)
                    </p>
                    <button
                      type="button"
                      aria-label="Toggle container return advisory"
                      aria-expanded={showBottleReturnAdvisory}
                      onClick={() => setShowBottleReturnAdvisory(prev => !prev)}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/40 text-slate-300 hover:text-white hover:border-white/20 transition"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {showBottleReturnAdvisory && (
                    <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                      Enter eligible Michigan 10¢ deposit UPCs to see an estimated return value.
                      Credit settlement preserves the full deposit value; cash settlement deducts
                      cash handling and glass surcharges after verification.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={openScanner}
                    className="px-4 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                  >
                    <ScanLine className="w-4 h-4" /> Scan
                  </button>
                  {lastBlockedUpc && lastBlockedReason === 'duplicate' && (
                    <button
                      onClick={() => addUpc(lastBlockedUpc, 'scanner')}
                      className="px-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Add anyway
                    </button>
                  )}

                  <button
                    onClick={clearUpcs}
                    disabled={totalReturnCount === 0}
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    Clear
                  </button>

                  <button
                    onClick={clearEligibilityCache}
                    disabled={!hasEligibilityCache}
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    Refresh eligibility
                  </button>
                </div>
              </div>

              {/* Manual entry */}
              <div className="flex gap-2">
                <input
                  id="returnManualUpc"
                  name="returnManualUpc"
                  value={manualUpc}
                  onChange={e => setManualUpc(e.target.value)}
                  placeholder="Enter UPC manually (8–14 digits)"
                  className="flex-1 bg-black/40 border border-white/10 rounded-2xl p-4 text-white text-xs outline-none focus:border-ninpo-lime"
                />
                <button
                  onClick={() => addUpc(manualUpc, 'manual')}
                  className="px-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>

              {scannerError && (
                <div className="text-[11px] text-ninpo-red bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4">
                  {scannerError}
                </div>
              )}

              {/* Summary */}
              <div className="flex items-center justify-between bg-black/30 border border-white/10 rounded-2xl p-4">
                <div>
                  <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                    Containers Scanned
                  </p>
                  <p className="text-white font-black text-lg">{totalReturnCount}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                    {payoutMethod === 'CASH'
                      ? 'Estimated Payout (Net)'
                      : 'Estimated Return Credit'}
                  </p>
                  <p className="text-ninpo-lime font-black text-lg">
                    {money(estimatedReturnCredit)}
                  </p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                    Estimate only — verified at delivery
                  </p>
                </div>
              </div>

              {payoutMethod === 'CASH' && estimatedReturnBreakdown.gross > 0 && (
                <div className="space-y-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest border border-dashed border-white/10 rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <p>Estimated Return (Gross)</p>
                    <p className="font-mono text-slate-400">
                      {money(estimatedReturnBreakdown.gross)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p>Cash Handling Fee</p>
                    <p className="font-mono text-slate-400">
                      - {money(estimatedReturnBreakdown.handlingFee)}
                    </p>
                  </div>
                  {estimatedReturnBreakdown.glassFee > 0 && (
                    <div className="flex items-center justify-between">
                      <p>Glass Handling Surcharge</p>
                      <p className="font-mono text-slate-400">
                        - {money(estimatedReturnBreakdown.glassFee)}
                      </p>
                    </div>
                  )}
                  <div className="border-t border-dashed border-white/10 mt-2 pt-2 flex items-center justify-between">
                    <p>Estimated Payout (Net)</p>
                    <p className="font-mono text-ninpo-lime">
                      {money(estimatedReturnBreakdown.net)}
                    </p>
                  </div>
                </div>
              )}

              {payoutMethod !== 'CASH' && (
                <div className="flex items-start gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  <Info className="w-3 h-3 text-slate-500 mt-0.5" />
                  <p>Credits are issued at the full $0.10 per eligible container.</p>
                </div>
              )}

              {/* UPC list */}
              {returnUpcs.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {returnUpcs.map(entry => (
                    <div
                      key={entry.upc}
                      className="flex items-center justify-between bg-black/30 border border-white/10 rounded-2xl px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-white font-bold tracking-wider">
                            {eligibilityCache[entry.upc]?.name || entry.upc}
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                            Return UPC
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                          Qty × {entry.quantity}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => decrementUpc(entry.upc)}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition"
                        >
                          -
                        </button>
                        <button
                          onClick={() => incrementUpc(entry.upc)}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition"
                        >
                          +
                        </button>
                        <button
                          onClick={() => removeUpc(entry.upc)}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-ninpo-red/20 hover:border-ninpo-red/20 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Address */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Delivery Address
              </p>
              <input
                id="deliveryAddress"
                name="deliveryAddress"
                placeholder="Drop Location..."
                value={address}
                onChange={e => onAddressChange(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white text-xs outline-none focus:border-ninpo-lime"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  One-Way Distance (Auto)
                </p>
                {isQuoteLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
              </div>
              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white text-xs">
                <p className="text-white font-black text-lg">
                  {formattedDistanceMiles} mi
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Calculated from delivery address.
                </p>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                Rounded down to 0.1 mi for distance fee tiers.
              </p>
              {quoteError && (
                <p className="text-[10px] text-ninpo-red font-bold uppercase tracking-widest">
                  {quoteError}
                </p>
              )}
            </div>

            {/* Policy checkbox */}
            <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer select-none">
              <input
                id="acceptHubProtocol"
                name="acceptHubProtocol"
                type="checkbox"
                checked={acceptedPolicies}
                onChange={e => onPolicyChange(e.target.checked)}
                className="accent-ninpo-lime"
              />
              Accept Hub Protocol
            </label>

            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-slate-300">Return policy</p>
                <button
                  type="button"
                  aria-label="Toggle return policy advisories"
                  aria-expanded={showPolicyAdvisories}
                  onClick={() => setShowPolicyAdvisories(prev => !prev)}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/40 text-slate-300 hover:text-white hover:border-white/20 transition"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                </button>
              </div>
              {showPolicyAdvisories && (
                <div className="space-y-2">
                  <p>Containers must be empty, clean, and clearly marked with the MI 10¢ label.</p>
                  <p>Return value posts after verification and credits never expire.</p>
                  <p>
                    Common/Bronze credits apply to products only; Silver+ can cover route and
                    distance fees.
                  </p>
                  <p>Gold+ may request cash payouts.</p>
                  <p>
                    AI output is advisory; eligibility is determined by the UPC whitelist and
                    deposit labeling.
                  </p>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Subtotal
                </p>
                <p className="text-white font-black">{money(quoteSubtotal)}</p>
              </div>

              {depositTotal > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    MI 10¢ deposit (included)
                  </p>
                  <p className="text-white font-black">{money(depositTotal)}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {isPickupOnlyOrder ? 'Route Fee — Pickup-Only Order' : 'Route Fee — Delivery Order'}
                </p>
                <p className="text-white font-black">{money(activeRouteFee)}</p>
              </div>

              {activeDistanceFeeCents > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Distance Fee{quoteDistanceMiles > 0 ? ` (${quoteDistanceMiles.toFixed(1)} mi)` : ''}
                  </p>
                  <p className="text-white font-black">{money(activeDistanceFee)}</p>
                </div>
              )}

              {payoutMethod !== 'CASH' && estimatedReturnCredit > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Estimated Return Credit
                  </p>
                  <p className="text-ninpo-lime font-black">
                    - {money(estimatedReturnCredit)}
                  </p>
                </div>
              )}

              {payoutMethod === 'CASH' && estimatedReturnCredit > 0 && (
                 <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Estimated Cash Payout
                  </p>
                  <p className="text-ninpo-lime font-black">
                    {money(estimatedReturnCredit)}
                  </p>
                </div>
              )}


              {allowCashPayout && (
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2 space-y-2">
                  <label className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest text-slate-300">
                    <span>Receive Return Value as Cash</span>
                    <input
                      id="useCashPayout"
                      name="useCashPayout"
                      type="checkbox"
                      checked={useCashPayout}
                      onChange={e => setUseCashPayout(e.target.checked)}
                      className="accent-ninpo-lime"
                    />
                  </label>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">
                    Cash payout won’t reduce today’s total.
                  </p>
                </div>
              )}

              <div className="border-t border-white/10 pt-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {payoutMethod === 'CASH'
                    ? 'Preview Total Due Today'
                    : 'Preview Total After Credit'}
                </p>
                <p className="text-white font-black text-lg">{money(previewTotalAfterCredit)}</p>
              </div>

              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                {payoutMethod === 'CASH'
                  ? 'Return value will be paid out in cash after verification.'
                  : 'Return value will be applied after delivery and verification.'}
              </p>

              {creditsCoverDelivery ? (
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                  {deliveryCoveredByCredits
                    ? 'Route fee covered by credits.'
                    : 'Silver+ credits can cover route and distance fees.'}
                </p>
              ) : (
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                  Route and distance fees are excluded from credits for Common/Bronze tiers.
                </p>
              )}

              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                Estimate only — verified at delivery.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleCreditsClick}
                disabled={!canCheckoutCredits}
                className="py-4 bg-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest text-white flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <Zap className="w-3 h-3" /> Credits
              </button>

              <button
                onClick={() => onPayExternal('STRIPE', returnUpcs, payoutMethod)}
                disabled={!canCheckoutStripe}
                className="py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Landmark className="w-3 h-3" />
                )}
                Stripe
              </button>
            </div>

            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
              Authorize now, capture after verification.
            </p>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
              {payoutMethod === 'CASH'
                ? 'Cash payouts do not reduce today’s total.'
                : 'Applying return value as credits may reduce or waive route and distance fees.'}
            </p>

            {cartIsEmpty && hasReturnUpcs && (
              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                Verification required. Final return value will be confirmed at delivery.
              </p>
            )}

            {!acceptedPolicies && (
              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                Accept the policy to proceed.
              </p>
            )}
            {!address.trim() && (
              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                A valid address is required to proceed.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* SINGLE CUSTOMER SCANNER (shared component) */}
      <ScannerModal
        mode={ScannerMode.DRIVER_VERIFY_CONTAINERS /* best available enum for “returns scan” without editing types.ts */}
        isOpen={scannerOpen}
        title="Container UPC Scanner"
        subtitle="Point camera at barcode. Each scan increments quantity."
        cooldownMs={900}
        beepEnabled={true}
        onClose={closeScanner}
        onCooldown={(upc, reason) => {
          addToast('Same UPC — tap to add again', 'info');
          if (reason === 'duplicate') {
            setLastBlockedUpc(upc);
            setLastBlockedReason(reason);
          } else {
            setLastBlockedUpc(null);
            setLastBlockedReason(reason);
          }
        }}
        onScan={(upc) => addUpc(upc, 'scanner')}
        // onPhotoCaptured can be wired to AI later; kept optional to avoid breaking checkout
      />
    </div>
  );
};

export default CartDrawer;
