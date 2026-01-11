import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingBag, X, Trash2, Loader2, Zap, Landmark, Camera, Plus, ScanLine } from 'lucide-react';
import { Product } from '../types';

interface CartItem {
  productId: string;
  quantity: number;
}

interface CartDrawerProps {
  isOpen: boolean;
  cart: CartItem[];
  products: Product[];
  address: string;
  acceptedPolicies: boolean;
  isProcessing: boolean;

  onClose: () => void;
  onAddressChange: (v: string) => void;
  onPolicyChange: (v: boolean) => void;

  onRemoveItem: (productId: string) => void;

  // Not implemented in your current flow (kept for compatibility)
  onPayCredits: () => void;

  // Your existing Stripe flow handler from App.tsx
  onPayExternal: (gateway: 'STRIPE' | 'GPAY') => void;
}

const LS_KEY_UPCS = 'ninpo_return_upcs_v1';

// Business defaults (we can later move these into settings)
const MI_DEPOSIT_VALUE = 0.1; // 10¢
const DEFAULT_DAILY_CAP = 25.0;

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
  onClose,
  onAddressChange,
  onPolicyChange,
  onRemoveItem,
  onPayCredits,
  onPayExternal
}) => {
  // ----------------------------
  // Bottle returns (UPC list)
  // ----------------------------
  const [returnUpcs, setReturnUpcs] = useState<string[]>([]);
  const [manualUpc, setManualUpc] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  // Load UPCs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_UPCS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setReturnUpcs(parsed.map(String).map(s => s.trim()).filter(Boolean));
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

  const addUpc = (upcRaw: string) => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    // Basic UPC/EAN sanity check (you can loosen if needed)
    if (!/^\d{8,14}$/.test(upc)) {
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      return;
    }

    setReturnUpcs(prev => {
      if (prev.includes(upc)) return prev;
      return [upc, ...prev];
    });

    setScannerError(null);
    setManualUpc('');
  };

  const removeUpc = (upc: string) => {
    setReturnUpcs(prev => prev.filter(x => x !== upc));
  };

  const clearUpcs = () => {
    setReturnUpcs([]);
    setScannerError(null);
  };

  // Estimated deposit credit (preview only)
  const estimatedReturnCredit = useMemo(() => {
    const raw = returnUpcs.length * MI_DEPOSIT_VALUE;
    return Math.min(raw, DEFAULT_DAILY_CAP);
  }, [returnUpcs.length]);

  // ----------------------------
  // Cart totals
  // ----------------------------
  const lineItems = useMemo(() => {
    return cart
      .map(ci => {
        const p = products.find(x => x.id === ci.productId || (x as any).frontendId === ci.productId);
        if (!p) return null;
        return {
          product: p,
          productId: ci.productId,
          quantity: ci.quantity,
          unitPrice: Number(p.price || 0),
          lineTotal: Number(p.price || 0) * ci.quantity
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

  // Preview total after estimated return credit (cannot go below 0)
  const previewTotalAfterCredit = useMemo(() => {
    return Math.max(0, subtotal - estimatedReturnCredit);
  }, [subtotal, estimatedReturnCredit]);

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

        const detector = new (window as any).BarcodeDetector({
          formats: ['upc_a', 'ean_13', 'ean_8', 'upc_e']
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
                addUpc(rawValue);

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
  const cartIsEmpty = cart.length === 0;
  const canCheckout = !cartIsEmpty && !!address.trim() && acceptedPolicies && !isProcessing;

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
                Bottle UPC Scanner
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
              Scanned: <span className="text-white">{returnUpcs.length}</span>
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
                  Review • Bottle returns • Checkout
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

            {/* Bottle Returns */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-xs">
                    Bottle Returns (Preview)
                  </p>
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                    Scan UPCs now. Driver verifies at pickup.
                  </p>
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
                    disabled={returnUpcs.length === 0}
                    className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    Clear
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
                  onClick={() => addUpc(manualUpc)}
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
                  <p className="text-white font-black text-lg">{returnUpcs.length}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest">
                    Estimated Credit
                  </p>
                  <p className="text-ninpo-lime font-black text-lg">{money(estimatedReturnCredit)}</p>
                </div>
              </div>

              {/* UPC list */}
              {returnUpcs.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {returnUpcs.map(upc => (
                    <div
                      key={upc}
                      className="flex items-center justify-between bg-black/30 border border-white/10 rounded-2xl px-4 py-3"
                    >
                      <span className="text-[11px] text-white font-bold tracking-wider">{upc}</span>
                      <button
                        onClick={() => removeUpc(upc)}
                        className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-ninpo-red/20 hover:border-ninpo-red/20 transition"
                      >
                        Remove
                      </button>
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
                  Estimated Bottle Credit (preview)
                </p>
                <p className="text-ninpo-lime font-black">- {money(estimatedReturnCredit)}</p>
              </div>

              <div className="border-t border-white/10 pt-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Preview Total After Credit
                </p>
                <p className="text-white font-black text-lg">{money(previewTotalAfterCredit)}</p>
              </div>

              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                Note: Bottle credit is estimated. Final amount is verified at pickup.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onPayCredits}
                disabled
                className="py-4 bg-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-center gap-2 disabled:opacity-40"
                title="Credits checkout will be wired in a later step"
              >
                <Zap className="w-3 h-3" /> Credits (Soon)
              </button>

              <button
                onClick={() => onPayExternal('STRIPE')}
                disabled={!canCheckout}
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
