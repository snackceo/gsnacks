import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShoppingBag,
  X,
  Trash2,
  Loader2,
  Zap,
  Landmark,
  Camera,
  Plus,
  ScanLine,
  Info,
  AlertCircle
} from 'lucide-react';
import { Product, ReturnUpcCount, UserTier } from '../types';

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
  routeFee: number;
  membershipTier?: UserTier;
  pickupOnlyMultiplier: number;
  distanceMiles: number;
  isDistanceLoading: boolean;
  distanceError: string | null;
  distanceIncludedMiles: number;
  distanceBand1MaxMiles: number;
  distanceBand2MaxMiles: number;
  distanceBand1Rate: number;
  distanceBand2Rate: number;
  distanceBand3Rate: number;
  dailyReturnLimit: number;

  onClose: () => void;
  onAddressChange: (v: string) => void;
  onPolicyChange: (v: boolean) => void;

  onRemoveItem: (productId: string) => void;

  // Not implemented in your current flow (kept for compatibility)
  onPayCredits: (
    returnUpcs: ReturnUpcCount[],
    returnPayoutMethod: ReturnPayoutMethod
  ) => Promise<boolean>;

  // Your existing Stripe flow handler from App.tsx
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
const UPC_ELIGIBILITY_TTL_MS = 24 * 60 * 60 * 1000;

// Business defaults (we can later move these into settings)
const MI_DEPOSIT_VALUE = 0.1; // 10¢
const DEFAULT_DAILY_LIMIT = 250;
const DEFAULT_HANDLING_FEE = 0.02;
const DEFAULT_GLASS_HANDLING_FEE = 0.02;
const DEFAULT_DISTANCE_INCLUDED_MILES = 3.0;
const DEFAULT_DISTANCE_BAND1_MAX = 10.0;
const DEFAULT_DISTANCE_BAND2_MAX = 20.0;
const DEFAULT_DISTANCE_BAND1_RATE = 0.5;
const DEFAULT_DISTANCE_BAND2_RATE = 0.75;
const DEFAULT_DISTANCE_BAND3_RATE = 1.0;
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

function money(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}

const roundDownToTenth = (value: number) => Math.floor(value * 10) / 10;

const calculateDistanceFee = ({
  distanceMiles,
  includedMiles,
  band1Max,
  band2Max,
  band1Rate,
  band2Rate,
  band3Rate
}: {
  distanceMiles: number;
  includedMiles: number;
  band1Max: number;
  band2Max: number;
  band1Rate: number;
  band2Rate: number;
  band3Rate: number;
}) => {
  const roundedDistance = roundDownToTenth(Math.max(0, distanceMiles));
  const normalizedIncluded = Math.max(0, includedMiles);
  const normalizedBand1Max = Math.max(normalizedIncluded, band1Max);
  const normalizedBand2Max = Math.max(normalizedBand1Max, band2Max);

  const band1Miles = Math.max(0, Math.min(roundedDistance, normalizedBand1Max) - normalizedIncluded);
  const band2Miles = Math.max(0, Math.min(roundedDistance, normalizedBand2Max) - normalizedBand1Max);
  const band3Miles = Math.max(0, roundedDistance - normalizedBand2Max);

  return (
    band1Miles * Math.max(0, band1Rate) +
    band2Miles * Math.max(0, band2Rate) +
    band3Miles * Math.max(0, band3Rate)
  );
};

const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  cart,
  products,
  address,
  acceptedPolicies,
  isProcessing,
  routeFee,
  membershipTier,
  pickupOnlyMultiplier,
  distanceMiles,
  isDistanceLoading,
  distanceError,
  distanceIncludedMiles,
  distanceBand1MaxMiles,
  distanceBand2MaxMiles,
  distanceBand1Rate,
  distanceBand2Rate,
  distanceBand3Rate,
  dailyReturnLimit,
  onClose,
  onAddressChange,
  onPolicyChange,
  onRemoveItem,
  onPayCredits,
  onPayExternal
}) => {
  // ----------------------------
  // Container returns (UPC list)
  // ----------------------------
  const [returnUpcs, setReturnUpcs] = useState<ReturnUpcEntry[]>([]);
  const [manualUpc, setManualUpc] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [hasEligibilityCache, setHasEligibilityCache] = useState(false);
  const [eligibilityCache, setEligibilityCache] = useState<UpcEligibilityCache>({});
  const [showBottleReturnAdvisory, setShowBottleReturnAdvisory] = useState(false);
  const [showPolicyAdvisories, setShowPolicyAdvisories] = useState(false);
  const [useCashPayout, setUseCashPayout] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const eligibilityCacheRef = useRef<UpcEligibilityCache>({});
  const lastScanAtRef = useRef<number>(0);

  const normalizeReturnUpcs = (raw: unknown): ReturnUpcEntry[] => {
    if (!Array.isArray(raw)) return [];
    if (raw.length === 0) return [];
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
  }, []);

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

  const updateEligibilityCache = (
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
  };

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

  const playScannerTone = (frequency: number, durationMs: number, gain = 0.2) => {
    if (typeof window === 'undefined') return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const context = audioContextRef.current;
    if (context.state === 'suspended') {
      context.resume();
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gainNode.gain.value = gain;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationMs / 1000);
  };

  const addEligibleUpc = (upc: string) => {
    let didAdd = false;
    setReturnUpcs(prev => {
      if (prev.some(entry => entry.upc === upc)) return prev;
      didAdd = true;
      return [{ upc, quantity: 1 }, ...prev];
    });

    if (didAdd) {
      setScannerError(null);
      setManualUpc('');
      playScannerTone(980, 120, 0.2);
    } else {
      playScannerTone(220, 240, 0.25);
      setScannerError('This container may already be counted.');
    }
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

  const addUpc = async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    if (source === 'scanner') {
      const now = Date.now();
      if (now - lastScanAtRef.current < 1200) {
        playScannerTone(220, 240, 0.25);
        setScannerError('Scan paused. Wait a moment or tap + to increment.');
        return;
      }
      lastScanAtRef.current = now;
    }

    // Basic UPC/EAN sanity check (you can loosen if needed)
    if (!/^\d{8,14}$/.test(upc)) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      return;
    }

    const cached = eligibilityCacheRef.current[upc];
    if (cached && isEligibilityCacheFresh(cached.checkedAt)) {
      if (!cached.isEligible) {
        playScannerTone(220, 240, 0.25);
        setScannerError(NOT_ELIGIBLE_MESSAGE);
        return;
      }

      addEligibleUpc(upc);
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(upc)}`
      );
      if (response.ok) {
        const data = await response.json();
        const isEligible = data?.eligible !== false;
        updateEligibilityCache(upc, {
          isEligible,
          name: data?.name,
          containerType: data?.containerType,
          sizeOz: data?.sizeOz
        });
        if (!isEligible) {
          playScannerTone(220, 240, 0.25);
          setScannerError(NOT_ELIGIBLE_MESSAGE);
          return;
        }
        addEligibleUpc(upc);
        return;
      }

      if (response.status === 404) {
        updateEligibilityCache(upc, { isEligible: false });
        playScannerTone(220, 240, 0.25);
        setScannerError(NOT_ELIGIBLE_MESSAGE);
        return;
      }

      throw new Error(`Eligibility check failed: ${response.status}`);
    } catch {
      playScannerTone(220, 240, 0.25);
      setScannerError('Unable to validate UPC eligibility. Please try again.');
    }
  };

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
  const dailyContainerLimit = Number.isFinite(dailyReturnLimit)
    ? dailyReturnLimit
    : DEFAULT_DAILY_LIMIT;
  const cappedReturnCount = Math.min(totalReturnCount, dailyContainerLimit);
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
  const estimatedReturnCredit = useMemo(() => {
    if (cappedReturnCount === 0) return 0;
    let remaining = cappedReturnCount;
    let total = 0;

    for (const entry of returnUpcs) {
      if (remaining <= 0) break;
      const eligibleCount = Math.min(entry.quantity, remaining);
      const containerType = eligibilityCache[entry.upc]?.containerType;
      const netValue = containerType === 'glass' ? netGlassCash : netStandardCash;
      const creditValue = depositValue;
      const valuePerContainer = payoutMethod === 'CASH' ? netValue : creditValue;
      total += valuePerContainer * eligibleCount;
      remaining -= eligibleCount;
    }

    return total;
  }, [
    cappedReturnCount,
    depositValue,
    eligibilityCache,
    netGlassCash,
    netStandardCash,
    payoutMethod,
    returnUpcs
  ]);

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
  const sanitizedRouteFee = Number.isFinite(routeFee) ? routeFee : 0;
  const sanitizedPickupMultiplier = Number.isFinite(pickupOnlyMultiplier)
    ? pickupOnlyMultiplier
    : 0.5;
  const sanitizedDistanceMiles = Number.isFinite(distanceMiles) ? Math.max(0, distanceMiles) : 0;
  const sanitizedIncludedMiles = Number.isFinite(distanceIncludedMiles)
    ? distanceIncludedMiles
    : DEFAULT_DISTANCE_INCLUDED_MILES;
  const sanitizedBand1Max = Number.isFinite(distanceBand1MaxMiles)
    ? distanceBand1MaxMiles
    : DEFAULT_DISTANCE_BAND1_MAX;
  const sanitizedBand2Max = Number.isFinite(distanceBand2MaxMiles)
    ? distanceBand2MaxMiles
    : DEFAULT_DISTANCE_BAND2_MAX;
  const sanitizedBand1Rate = Number.isFinite(distanceBand1Rate)
    ? distanceBand1Rate
    : DEFAULT_DISTANCE_BAND1_RATE;
  const sanitizedBand2Rate = Number.isFinite(distanceBand2Rate)
    ? distanceBand2Rate
    : DEFAULT_DISTANCE_BAND2_RATE;
  const sanitizedBand3Rate = Number.isFinite(distanceBand3Rate)
    ? distanceBand3Rate
    : DEFAULT_DISTANCE_BAND3_RATE;

  const roundedDistanceMiles = roundDownToTenth(sanitizedDistanceMiles);
  const subtotalCents = useMemo(() => Math.round(subtotal * 100), [subtotal]);
  const estimatedReturnCreditCents = useMemo(
    () => Math.round(estimatedReturnCredit * 100),
    [estimatedReturnCredit]
  );
  const activeRouteFee = isPickupOnlyOrder
    ? sanitizedRouteFee * sanitizedPickupMultiplier
    : sanitizedRouteFee;
  const activeDeliveryFeeCents = Math.round(activeRouteFee * 100);
  const baseDistanceFee =
    activeTier === UserTier.GREEN
      ? 0
      : calculateDistanceFee({
          distanceMiles: sanitizedDistanceMiles,
          includedMiles: sanitizedIncludedMiles,
          band1Max: sanitizedBand1Max,
          band2Max: sanitizedBand2Max,
          band1Rate: sanitizedBand1Rate,
          band2Rate: sanitizedBand2Rate,
          band3Rate: sanitizedBand3Rate
        });
  const activeDistanceFee = isPickupOnlyOrder
    ? baseDistanceFee * sanitizedPickupMultiplier
    : baseDistanceFee;
  const activeDistanceFeeCents = Math.round(activeDistanceFee * 100);
  const creditsCoverDelivery = [UserTier.SILVER, UserTier.GOLD, UserTier.PLATINUM, UserTier.GREEN].includes(
    activeTier
  );
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

  // Preview total after estimated return credit (cannot go below 0)
  const previewTotalAfterCredit = useMemo(() => {
    const totalCents =
      subtotalCents + activeDeliveryFeeCents + activeDistanceFeeCents - creditAppliedCents;
    return Math.max(0, totalCents) / 100;
  }, [subtotalCents, activeDeliveryFeeCents, activeDistanceFeeCents, creditAppliedCents]);

  // ----------------------------
  // Scanner modal behavior
  // ----------------------------
  const stopScanner = async () => {
    setIsScanning(false);

    if (scanLoopRef.current) {
      window.clearTimeout(scanLoopRef.current);
      scanLoopRef.current = null;
    }

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {
        // ignore
      }
    }
  };

  const closeScanner = async () => {
    await stopScanner();
    setScannerOpen(false);
    setScannerError(null);
  };

  const openScanner = async () => {
    setScannerError(null);
    setScannerOpen(true);
  };

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;

    const start = async () => {
      setScannerError(null);
      await stopScanner();

      // BarcodeDetector is the cleanest mobile-first approach
      const hasBarcodeDetector = typeof (window as any).BarcodeDetector !== 'undefined';
      if (!hasBarcodeDetector) {
        setScannerError('Scanner not supported on this device/browser. Use manual UPC entry below.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        streamRef.current = stream;
        if (videoRef.current) {
          (videoRef.current as any).srcObject = stream;
          await videoRef.current.play();
        }

        if (cancelled) return;

        const preferredFormats = ['upc_a', 'ean_13', 'ean_8', 'upc_e'];
        let supportedFormats = preferredFormats;
        if (typeof (window as any).BarcodeDetector.getSupportedFormats === 'function') {
          try {
            const detectedFormats = await (window as any).BarcodeDetector.getSupportedFormats();
            if (Array.isArray(detectedFormats) && detectedFormats.length > 0) {
              supportedFormats = preferredFormats.filter(format =>
                detectedFormats.includes(format)
              );
            }
          } catch {
            supportedFormats = preferredFormats;
          }
        }

        if (supportedFormats.length === 0) {
          setScannerError('Scanner not supported on this device/browser. Use manual UPC entry below.');
          return;
        }

        const detector = new (window as any).BarcodeDetector({
          formats: supportedFormats
        });

        setIsScanning(true);

        const scanTick = async () => {
          if (!scannerOpen || cancelled) return;
          if (!videoRef.current || videoRef.current.readyState < 2) {
            scanLoopRef.current = window.setTimeout(scanTick, 250);
            return;
          }

          try {
            const barcodes = await detector.detect(videoRef.current);
            if (Array.isArray(barcodes) && barcodes.length > 0) {
              const rawValue = barcodes[0]?.rawValue;
              if (rawValue) {
                addUpc(rawValue, 'scanner');

                // Soft throttle so it doesn't spam the same UPC
                await new Promise(r => setTimeout(r, 900));
              }
            }
          } catch {
            // ignore detection errors; keep scanning
          }

          scanLoopRef.current = window.setTimeout(scanTick, 250);
        };

        scanTick();
      } catch (e: any) {
        setScannerError(e?.message || 'Camera permission denied or unavailable.');
      }
    };

    start();

    return () => {
      cancelled = true;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  // Close on drawer close
  useEffect(() => {
    if (!isOpen) {
      closeScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ----------------------------
  // Render
  // ----------------------------
  const scannerModal = scannerOpen && typeof document !== 'undefined'
    ? createPortal(
      <div className="fixed inset-0 z-[12000] flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeScanner} />
        <div className="relative w-full max-w-lg bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-white font-black uppercase tracking-widest text-sm">
                Container UPC Scanner
              </p>
              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                Point camera at barcode. Auto-adds detected UPCs.
              </p>
            </div>
            <button
              onClick={closeScanner}
              className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-5 rounded-3xl overflow-hidden border border-white/10 bg-black/40 aspect-video flex items-center justify-center relative">
            {/* Camera feed (if supported) */}
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {isScanning && <span className="scanning-line" />}
            {!isScanning && (
              <div className="absolute text-center px-8">
                <Camera className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {scannerError
                    ? 'Scanner unavailable'
                    : 'Initializing camera...'}
                </p>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              Scanned: <span className="text-white">{totalReturnCount}</span>
            </div>

            <button
              onClick={closeScanner}
              className="px-5 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
            >
              <ScanLine className="w-4 h-4" /> Done
            </button>
          </div>

              {scannerError && (
                <div className="mt-4 text-[11px] text-ninpo-red bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4">
                  {scannerError}
                </div>
              )}

          <p className="mt-4 text-[10px] text-slate-600 font-bold uppercase tracking-widest">
            Tip: If scanning fails, close this and use manual UPC entry in cart.
          </p>
        </div>
      </div>,
      document.body
    )
    : null;

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
              className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
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
                      ? 'Estimated Cash Payout (net)'
                      : 'Estimated Return Credit'}
                  </p>
                  <p className="text-ninpo-lime font-black text-lg">{money(estimatedReturnCredit)}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                    Estimate only — verified at delivery
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                <Info className="w-3 h-3 text-slate-500 mt-0.5" />
                <p>
                  {payoutMethod === 'CASH'
                    ? `Cash payouts subtract ${money(handlingFee)} per container plus ${money(
                        glassHandlingFee
                      )} for glass.`
                    : 'Credits are issued at the full $0.10 per eligible container.'}{' '}
                  Daily per-person limits apply. Estimates do not affect your payment authorization.
                </p>
              </div>
              {totalReturnCount > dailyContainerLimit && (
                <div className="text-[10px] text-ninpo-red font-bold uppercase tracking-widest">
                  Daily limit reached: only {dailyContainerLimit} containers can be credited today.
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
                {isDistanceLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
              </div>
              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-white text-xs">
                <p className="text-white font-black text-lg">
                  {Number.isFinite(distanceMiles) ? distanceMiles.toFixed(1) : '0.0'} mi
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  Calculated from delivery address.
                </p>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                Rounded down to 0.1 mi for distance fee tiers.
              </p>
              {distanceError && (
                <p className="text-[10px] text-ninpo-red font-bold uppercase tracking-widest">
                  {distanceError}
                </p>
              )}
            </div>

            {/* Policy checkbox */}
            <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer select-none">
              <input
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
                  <p>Daily limit: {dailyContainerLimit} containers per customer.</p>
                  <p>
                    Common/Bronze credits apply to products only; Silver+ can cover route and
                    distance fees.
                  </p>
                  <p>Gold+ may request cash payouts.</p>
                  <p>No splitting returns across multiple addresses to bypass the limit.</p>
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
                <p className="text-white font-black">{money(subtotal)}</p>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {isPickupOnlyOrder ? 'Route Fee — Pickup-Only Order' : 'Route Fee — Delivery Order'}
                </p>
                <p className="text-white font-black">{money(activeRouteFee)}</p>
              </div>
              {activeDistanceFeeCents > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Distance Fee{roundedDistanceMiles > 0 ? ` (${roundedDistanceMiles.toFixed(1)} mi)` : ''}
                  </p>
                  <p className="text-white font-black">{money(activeDistanceFee)}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {payoutMethod === 'CASH'
                    ? 'Estimated Cash Payout (net)'
                    : 'Estimated Return Credit'}
                </p>
                <p className="text-ninpo-lime font-black">
                  {payoutMethod === 'CASH' ? money(estimatedReturnCredit) : `- ${money(estimatedReturnCredit)}`}
                </p>
              </div>

              {allowCashPayout && (
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2 space-y-2">
                  <label className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-widest text-slate-300">
                    <span>Receive Return Value as Cash</span>
                    <input
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

      {scannerModal}
    </div>
  );
};

export default CartDrawer;
