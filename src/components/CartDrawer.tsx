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
import { Product, ReturnUpcCount, UserTier } from '../types';
import CustomerReturnScanner from './CustomerReturnScanner';
import { BACKEND_URL } from '../constants'; // already correct
import { useNinpoCore } from '../hooks/useNinpoCore';
import { analytics } from '../services/analyticsService';
import { validateAddress, AddressValidationResult } from '../services/geminiService';

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
  onCartUpdate: (newCart: CartItem[]) => void;

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
  largeOrderFee?: number;
  heavyItemFee?: number;
};

type CheckoutPreviewFulfillment = {
  status: 'open' | 'scheduled';
  message: string;
  scheduledItems: Array<{
    productId: string;
    productName: string;
    storeId: string;
    storeName: string;
    nextOpenLabel: string | null;
    timeZone: string | null;
  }>;
};

type CheckoutPreviewResponse = {
  fulfillment?: CheckoutPreviewFulfillment;
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
  onCartUpdate,
  onPayCredits,
  onPayExternal
}) => {
  const core = useNinpoCore();
  const { addToast } = core;
  // ----------------------------
  // Container returns (Customer scanner)
  // ----------------------------
  const [scannerOpen, setScannerOpen] = useState(false);
  const [returnUpcs, setReturnUpcs] = useState<ReturnUpcEntry[]>([]);
  const [totalReturnContainers, setTotalReturnContainers] = useState(0);
  const [estimatedReturnCredit, setEstimatedReturnCredit] = useState(0);

  const [showPolicyAdvisories, setShowPolicyAdvisories] = useState(false);

  const [useCashPayout, setUseCashPayout] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [checkoutPreview, setCheckoutPreview] = useState<CheckoutPreviewResponse | null>(null);
  const [isCheckoutPreviewLoading, setIsCheckoutPreviewLoading] = useState(false);
  const [checkoutPreviewError, setCheckoutPreviewError] = useState<string | null>(null);

  // Address validation state
  const [addressValidation, setAddressValidation] = useState<AddressValidationResult | null>(null);
  const [isValidatingAddress, setIsValidatingAddress] = useState(false);
  const [showAddressSuggestion, setShowAddressSuggestion] = useState(false);

  // Cart Optimization state
  const [optimizationResult, setOptimizationResult] = useState<any>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const findProductByCartId = useCallback((productId: string) => {
    return products.find(
      p =>
        (p as any).frontendId === productId ||
        p.id === productId ||
        (p as any)._id === productId
    );
  }, [products]);

  const resolveProductId = useCallback((product?: Product | null) => {
    return (product as any)?.frontendId || product?.id || (product as any)?._id || '';
  }, []);

  const handleOptimizeCart = async () => {
    setIsOptimizing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/cart/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to optimize cart');
      }
      setOptimizationResult(data);
      addToast('Cart optimization complete!', 'success');
    } catch (error: any) {
      console.error('Cart optimization failed:', error);
      addToast(error.message || 'Cart optimization failed.', 'error');
      setOptimizationResult(null);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleAcceptOptimization = async () => {
    if (!optimizationResult) return;

    const newCartItems = optimizationResult.optimizedCart.items.map(item => ({
      productId: resolveProductId(item.product),
      quantity: item.quantity,
    }));

    try {
      const res = await fetch(`${BACKEND_URL}/api/cart/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            items: newCartItems,
            subtotal: optimizationResult.optimizedCart.subtotal,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update cart');
      }

      onCartUpdate(newCartItems);
      setOptimizationResult(null);
      addToast('Cart updated with optimized items!', 'success');

    } catch (error: any) {
        console.error('Failed to accept optimization:', error);
        addToast(error.message || 'Failed to update cart.', 'error');
    }
  };

  const cartIsEmpty = cart.length === 0;
  const hasReturnUpcs = totalReturnContainers > 0;
  const isPickupOnlyOrder = cartIsEmpty && hasReturnUpcs;

  const activeTier = membershipTier ?? UserTier.COMMON;
  const allowPlatinumTier = Boolean((core as any)?.settings?.allowPlatinumTier);
  const allowGreenTier = Boolean((core as any)?.settings?.allowGreenTier);
  const cashEligibleTiers: UserTier[] = [UserTier.GOLD];
  if (allowPlatinumTier) cashEligibleTiers.push(UserTier.PLATINUM);
  if (allowGreenTier) cashEligibleTiers.push(UserTier.GREEN);
  const allowCashPayout = cashEligibleTiers.includes(activeTier);

  useEffect(() => {
    if (!allowCashPayout && useCashPayout) {
      setUseCashPayout(false);
    }
  }, [allowCashPayout, useCashPayout]);

  const payoutMethod: ReturnPayoutMethod =
    allowCashPayout && useCashPayout ? 'CASH' : 'CREDIT';

  // Address validation (runs 800ms after user stops typing)
  useEffect(() => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress || trimmedAddress.length < 10) {
      setAddressValidation(null);
      setShowAddressSuggestion(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsValidatingAddress(true);
      try {
        const result = await validateAddress(trimmedAddress);
        setAddressValidation(result);
        
        // Show suggestion if address has issues and AI is confident
        if (!result.isValid && result.confidence > 70 && result.correctedAddress !== trimmedAddress) {
          setShowAddressSuggestion(true);
        } else {
          setShowAddressSuggestion(false);
        }
      } catch (error) {
        console.error('Address validation failed:', error);
        setAddressValidation(null);
        setShowAddressSuggestion(false);
      } finally {
        setIsValidatingAddress(false);
      }
    }, 800);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [address]);

  // Quote (distance/route fees)
  useEffect(() => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress || (!cart.length && totalReturnContainers === 0)) {
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
          distanceMiles: Number(data?.distanceMiles ?? 0),
          largeOrderFee: Number(data?.largeOrderFee ?? 0),
          heavyItemFee: Number(data?.heavyItemFee ?? 0)
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
  }, [address, cart, currentUserId, payoutMethod, returnUpcs, totalReturnContainers]);

  // Checkout preview (store availability + fallback timing)
  useEffect(() => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress || cart.length === 0) {
      setCheckoutPreview(null);
      setCheckoutPreviewError(null);
      setIsCheckoutPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsCheckoutPreviewLoading(true);
      setCheckoutPreviewError(null);
      try {
        const res = await fetch(`${BACKEND_URL}/api/shopping/checkout-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            cartItems: cart,
            deliveryAddress: {
              address: trimmedAddress
            },
            timestamp: new Date().toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Checkout preview failed');
        }

        setCheckoutPreview({
          fulfillment: data?.fulfillment
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setCheckoutPreview(null);
        setCheckoutPreviewError(err?.message || 'Checkout preview failed');
      } finally {
        setIsCheckoutPreviewLoading(false);
      }
    }, 700);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [address, cart]);

  // ----------------------------
  // Cart totals
  // ----------------------------
  const lineItems = useMemo(() => {
    return cart
      .map(ci => {
        const p = findProductByCartId(ci.productId);
        if (!p) return null;
        const unitPrice = Number(p.price || 0);
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
  }, [cart, findProductByCartId]);

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
  const activeLargeOrderFee = Number.isFinite(quote?.largeOrderFee ?? NaN) ? Number(quote?.largeOrderFee) : 0;
  const activeHeavyItemFee = Number.isFinite(quote?.heavyItemFee ?? NaN) ? Number(quote?.heavyItemFee) : 0;

  const subtotalCents = useMemo(() => Math.round(quoteSubtotal * 100), [quoteSubtotal]);
  const depositCents = Math.round(depositTotal * 100);
  const estimatedReturnCreditCents = useMemo(() => Math.round(estimatedReturnCredit * 100), [estimatedReturnCredit]);
  const activeRouteFeeCents = Math.round(activeRouteFee * 100);
  const activeDistanceFeeCents = Math.round(activeDistanceFee * 100);
  const activeLargeOrderFeeCents = Math.round(activeLargeOrderFee * 100);
  const activeHeavyItemFeeCents = Math.round(activeHeavyItemFee * 100);

  const deliveryCreditEligibleTiers: UserTier[] = [UserTier.SILVER, UserTier.GOLD];
  if (allowPlatinumTier) deliveryCreditEligibleTiers.push(UserTier.PLATINUM);
  if (allowGreenTier) deliveryCreditEligibleTiers.push(UserTier.GREEN);
  const creditsCoverDelivery = deliveryCreditEligibleTiers.includes(activeTier);
  const creditEligibleCents = creditsCoverDelivery
    ? subtotalCents + activeRouteFeeCents + activeDistanceFeeCents
    : subtotalCents;

  const creditAppliedCents =
    payoutMethod === 'CASH' ? 0 : Math.min(estimatedReturnCreditCents, creditEligibleCents);

  const deliveryCoveredByCredits =
    payoutMethod !== 'CASH' &&
    creditsCoverDelivery &&
    (activeRouteFeeCents + activeDistanceFeeCents) > 0 &&
    estimatedReturnCreditCents > subtotalCents;

  const previewTotalAfterCredit = useMemo(() => {
    const totalCents =
      subtotalCents + depositCents + activeRouteFeeCents + activeDistanceFeeCents + activeLargeOrderFeeCents + activeHeavyItemFeeCents - creditAppliedCents;
    return Math.max(0, totalCents) / 100;
  }, [subtotalCents, depositCents, activeRouteFeeCents, activeDistanceFeeCents, activeLargeOrderFeeCents, activeHeavyItemFeeCents, creditAppliedCents]);

  // ----------------------------
  // Scanner lifecycle
  // ----------------------------
  const openScanner = () => {
    setScannerOpen(true);
    analytics.trackScanner('opened');
  };

  const closeScanner = () => {
    setScannerOpen(false);
  };

  const handleScannerComplete = (upcs: ReturnUpcCount[], credit: number) => {
    const containerCount = upcs.reduce((sum, e) => sum + e.quantity, 0);
    setReturnUpcs(upcs);
    setEstimatedReturnCredit(credit);
    setTotalReturnContainers(containerCount);
    setScannerOpen(false);
    addToast(`Scanned ${containerCount} containers`, 'success');
    
    // Track bottle return completion
    analytics.trackReturn('completed', containerCount, credit);
  };

  const handleScannerChange = (containers: number, credit: number) => {
    setTotalReturnContainers(containers);
    setEstimatedReturnCredit(credit);
  };

  // Close scanner when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setScannerOpen(false);
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
      setReturnUpcs([]);
      setTotalReturnContainers(0);
      setEstimatedReturnCredit(0);
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
              <div className="flex items-center justify-between">
                <p className="text-white font-black uppercase tracking-widest text-xs">
                  Container Returns (Optional)
                </p>
                <button
                  onClick={openScanner}
                  className="px-4 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-ninpo-lime/90 transition"
                >
                  <ScanLine className="w-4 h-4" /> {hasReturnUpcs ? 'Continue Scanning' : 'Scan Containers'}
                </button>
              </div>

              {hasReturnUpcs && (
                <div className="flex items-center justify-between bg-black/30 border border-white/10 rounded-2xl p-5">
                  <div>
                    <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                      Containers Scanned
                    </p>
                    <p className="text-white font-black text-2xl mt-1">{totalReturnContainers}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                      Expected Credit
                    </p>
                    <p className="text-ninpo-lime font-black text-2xl mt-1">
                      {money(estimatedReturnCredit)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Address */}
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Delivery Address
              </p>
              <div className="relative">
                <input
                  id="deliveryAddress"
                  name="deliveryAddress"
                  placeholder="Drop Location..."
                  value={address}
                  onChange={e => onAddressChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white text-xs outline-none focus:border-ninpo-lime"
                />
                {isValidatingAddress && (
                  <div className="absolute right-5 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-ninpo-lime" />
                  </div>
                )}
              </div>

              {/* Address Validation Suggestion */}
              {showAddressSuggestion && addressValidation && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-yellow-500 font-bold text-xs mb-2">
                        Address Suggestion
                      </p>
                      <p className="text-white text-xs mb-3">
                        Did you mean: <span className="font-bold">{addressValidation.correctedAddress}</span>?
                      </p>
                      {addressValidation.issues && addressValidation.issues.length > 0 && (
                        <ul className="text-xs text-slate-300 space-y-1 mb-3">
                          {addressValidation.issues.map((issue, idx) => (
                            <li key={idx}>• {issue}</li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onAddressChange(addressValidation.correctedAddress);
                            setShowAddressSuggestion(false);
                          }}
                          className="px-4 py-2 bg-ninpo-lime text-ninpo-black rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-ninpo-lime/90 transition"
                        >
                          Use Suggested
                        </button>
                        <button
                          onClick={() => setShowAddressSuggestion(false)}
                          className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-white/20 transition"
                        >
                          Keep Original
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        {addressValidation.confidence}% AI confidence
                      </p>
                    </div>
                  </div>
                </div>
              )}
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

            {(checkoutPreview?.fulfillment?.status === 'scheduled' || checkoutPreviewError) && (
              <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-4 text-xs text-yellow-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-yellow-300">
                      Store availability update
                    </p>
                    {checkoutPreview?.fulfillment?.message ? (
                      <p className="text-[11px] text-yellow-100">
                        {checkoutPreview.fulfillment.message}
                      </p>
                    ) : (
                      <p className="text-[11px] text-yellow-100">
                        Store availability details are unavailable right now.
                      </p>
                    )}
                  </div>
                  {isCheckoutPreviewLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-yellow-300 ml-auto" />
                  )}
                </div>
                {checkoutPreview?.fulfillment?.status === 'scheduled' && checkoutPreview.fulfillment.scheduledItems?.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-yellow-100">
                    {checkoutPreview.fulfillment.scheduledItems.map(item => (
                      <li key={`${item.productId}-${item.storeId}`} className="flex flex-col">
                        <span className="font-semibold text-yellow-200">{item.productName}</span>
                        <span className="text-yellow-300/80">
                          {item.storeName} • {item.nextOpenLabel || 'Next opening time unavailable'}
                          {item.timeZone ? ` (${item.timeZone})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {checkoutPreviewError && (
                  <p className="text-[10px] text-yellow-200/80">
                    {checkoutPreviewError}
                  </p>
                )}
              </div>
            )}

            {/* Policy checkbox */}
            <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer select-none">
              <input
                id="acceptTerms"
                name="acceptTerms"
                type="checkbox"
                checked={acceptedPolicies}
                onChange={e => onPolicyChange(e.target.checked)}
                className="accent-ninpo-lime"
              />
              I agree to the
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline text-ninpo-lime ml-1">Terms of Service</a>
              and
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline text-ninpo-lime ml-1">Privacy Policy</a>
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

            {/* Cart Optimization */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-white font-black uppercase tracking-widest text-xs">
                  Optimize Cart
                </p>
                <button
                  onClick={handleOptimizeCart}
                  disabled={isOptimizing || cartIsEmpty}
                  className="px-4 py-3 rounded-2xl bg-ninpo-blue text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-ninpo-blue/90 transition disabled:opacity-50"
                >
                  {isOptimizing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  {isOptimizing ? 'Optimizing...' : 'Optimize My Cart'}
                </button>
              </div>
              {optimizationResult && (
                <div className="border-t border-white/10 pt-4 space-y-4">
                    <p className="text-sm text-white">Optimization Found: <span className='font-bold'>{optimizationResult.planName}</span></p>
                    <p className="text-xs text-slate-400">{optimizationResult.reason}</p>
                    <div className="bg-black/30 border border-white/10 rounded-2xl p-5 space-y-3">
                        {optimizationResult.optimizedCart.items.map((item, index) => (
                            <div key={index} className="flex justify-between items-center">
                                <p className="text-white">{item.product.name} (x{item.quantity})</p>
                                <div className='flex items-center gap-2'>
                                  {item.originalPrice && <p className="text-slate-400 line-through">{money(item.originalPrice)}</p>}
                                  <p className="text-ninpo-lime">{money(item.product.price)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between items-center">
                        <p className="text-white font-bold">New Subtotal:</p>
                        <p className="text-ninpo-lime font-bold">{money(optimizationResult.optimizedCart.subtotal)}</p>
                    </div>
                    {optimizationResult.routeInfo && (
                        <div>
                            <p className="text-white font-bold">Route Info:</p>
                            <p className="text-slate-300">Total Distance: {(optimizationResult.routeInfo.distance / 1609.34).toFixed(2)} miles</p>
                            <p className="text-slate-300">Total Duration: {Math.round(optimizationResult.routeInfo.duration / 60)} minutes</p>
                        </div>
                    )}
                    <div className="flex gap-4">
                        <button onClick={handleAcceptOptimization} className="flex-1 px-4 py-2 bg-ninpo-lime text-ninpo-black rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-ninpo-lime/90 transition">
                            Accept
                        </button>
                        <button onClick={() => setOptimizationResult(null)} className="flex-1 px-4 py-2 bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-white/20 transition">
                            Decline
                        </button>
                    </div>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Items Subtotal
                </p>
                <p className="text-white font-black">{money(quoteSubtotal)}</p>
              </div>

              {depositTotal > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Michigan Bottle Deposit (10¢ each)
                  </p>
                  <p className="text-white font-black">{money(depositTotal)}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Route Fee
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

              {activeLargeOrderFeeCents > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Large Order Handling
                  </p>
                  <p className="text-white font-black">{money(activeLargeOrderFee)}</p>
                </div>
              )}

              {activeHeavyItemFeeCents > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Heavy Item Handling
                  </p>
                  <p className="text-white font-black">{money(activeHeavyItemFee)}</p>
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
                className="py-4 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white flex flex-col items-center justify-center gap-1 disabled:opacity-40"
              >
                <span className="flex items-center gap-2">
                  <Zap className="w-3 h-3" /> Pay with Credits {money(previewTotalAfterCredit)}
                </span>
                <span className="text-[9px] font-normal text-slate-400 normal-case mt-1">From your wallet balance. Remaining balance charged to card.</span>
              </button>

              <button
                onClick={() => onPayExternal('STRIPE', returnUpcs, payoutMethod)}
                disabled={!canCheckoutStripe}
                className="py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest flex flex-col items-center justify-center gap-1 disabled:opacity-40"
              >
                <span className="flex items-center gap-2">
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Landmark className="w-3 h-3" />
                  )}
                  Pay with Card {money(previewTotalAfterCredit)}
                </span>
                <span className="text-[9px] font-normal text-slate-600 normal-case mt-1">Visa, Mastercard, Google Pay</span>
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

      {/* FULL-SCREEN CUSTOMER RETURN SCANNER */}
      {scannerOpen && (
        <div className="fixed inset-0 z-[10000] bg-ninpo-black">
          <div className="h-full flex flex-col">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <p className="text-white font-black uppercase tracking-widest text-sm">Container Returns</p>
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                  Scan bottles and cans for deposit credit
                </p>
              </div>
              <button
                onClick={closeScanner}
                className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <CustomerReturnScanner
                onComplete={handleScannerComplete}
                onChange={handleScannerChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CartDrawer;
