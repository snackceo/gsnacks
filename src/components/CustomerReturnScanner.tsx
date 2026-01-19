import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, Minus, Trash2, AlertCircle, Info } from 'lucide-react';
import InlineScanner from './InlineScanner';
import { ScannerMode } from '../types';
import { BACKEND_URL } from '../constants';

interface ReturnUpcEntry {
  upc: string;
  quantity: number;
}

interface UpcEligibility {
  isEligible: boolean;
  name?: string;
  containerType?: string;
  sizeOz?: number;
  checkedAt: string;
}

interface CustomerReturnScannerProps {
  onComplete: (upcs: ReturnUpcEntry[], estimatedCredit: number) => void;
  className?: string;
}

const LS_KEY_UPCS = 'ninpo_customer_return_upcs';
const LS_KEY_ELIGIBILITY = 'ninpo_customer_upc_eligibility';
const ELIGIBILITY_TTL_MS = 60 * 60 * 1000; // 1 hour
const MI_DEPOSIT_VALUE = 0.1;
const DEFAULT_HANDLING_FEE = 0.02;
const DEFAULT_GLASS_FEE = 0.02;

function money(n: number) {
  return `$${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
}

const CustomerReturnScanner: React.FC<CustomerReturnScannerProps> = ({
  onComplete,
  className = ''
}) => {
  const [returnUpcs, setReturnUpcs] = useState<ReturnUpcEntry[]>([]);
  const [eligibilityCache, setEligibilityCache] = useState<Record<string, UpcEligibility>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  
  const lastScanAtRef = useRef(0);
  const eligibilityCacheRef = useRef<Record<string, UpcEligibility>>({});

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY_UPCS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setReturnUpcs(parsed.filter((e: any) => e?.upc && e?.quantity > 0));
        }
      }
    } catch {}

    try {
      const storedCache = localStorage.getItem(LS_KEY_ELIGIBILITY);
      if (storedCache) {
        const parsed = JSON.parse(storedCache);
        if (parsed && typeof parsed === 'object') {
          eligibilityCacheRef.current = parsed;
          setEligibilityCache(parsed);
        }
      }
    } catch {}
  }, []);

  // Persist to localStorage when returnUpcs changes
  useEffect(() => {
    if (returnUpcs.length > 0) {
      try {
        localStorage.setItem(LS_KEY_UPCS, JSON.stringify(returnUpcs));
      } catch {}
    } else {
      try {
        localStorage.removeItem(LS_KEY_UPCS);
      } catch {}
    }
  }, [returnUpcs]);

  // Persist eligibility cache
  useEffect(() => {
    if (Object.keys(eligibilityCache).length > 0) {
      try {
        localStorage.setItem(LS_KEY_ELIGIBILITY, JSON.stringify(eligibilityCache));
      } catch {}
    }
  }, [eligibilityCache]);

  const updateEligibilityCache = useCallback((upc: string, data: Omit<UpcEligibility, 'checkedAt'>) => {
    const entry: UpcEligibility = { ...data, checkedAt: new Date().toISOString() };
    eligibilityCacheRef.current[upc] = entry;
    setEligibilityCache(prev => ({ ...prev, [upc]: entry }));
  }, []);

  const isEligibilityCacheFresh = (checkedAt?: string) => {
    if (!checkedAt) return false;
    const parsed = Date.parse(checkedAt);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed < ELIGIBILITY_TTL_MS;
  };

  const addOrIncrementUpc = useCallback((upc: string) => {
    setReturnUpcs(prev => {
      const existing = prev.find(e => e.upc === upc);
      if (!existing) return [{ upc, quantity: 1 }, ...prev];
      return prev.map(e => (e.upc === upc ? { ...e, quantity: e.quantity + 1 } : e));
    });
    setScanError(null);
  }, []);

  const handleScan = useCallback(async (upcRaw: string) => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    // Throttle
    const now = Date.now();
    if (now - lastScanAtRef.current < 900) return;
    lastScanAtRef.current = now;

    // Validate format
    if (!/^\d{8,14}$/.test(upc)) {
      setScanError('Invalid UPC format (8-14 digits required)');
      return;
    }

    // Check cache first
    const cached = eligibilityCacheRef.current[upc];
    if (cached && isEligibilityCacheFresh(cached.checkedAt)) {
      if (!cached.isEligible) {
        setScanError("This container isn't eligible for return");
        return;
      }
      addOrIncrementUpc(upc);
      return;
    }

    // Check eligibility via API
    setIsChecking(true);
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
          setScanError("This container isn't eligible for return");
          return;
        }

        addOrIncrementUpc(upc);
        return;
      }

      if (response.status === 404) {
        updateEligibilityCache(upc, { isEligible: false });
        setScanError("This container isn't eligible for return");
        return;
      }

      throw new Error('Eligibility check failed');
    } catch {
      setScanError('Unable to validate UPC. Please try again.');
    } finally {
      setIsChecking(false);
    }
  }, [addOrIncrementUpc, updateEligibilityCache]);

  const incrementUpc = useCallback((upc: string) => {
    setReturnUpcs(prev =>
      prev.map(e => (e.upc === upc ? { ...e, quantity: e.quantity + 1 } : e))
    );
  }, []);

  const decrementUpc = useCallback((upc: string) => {
    setReturnUpcs(prev =>
      prev
        .map(e =>
          e.upc === upc ? { ...e, quantity: Math.max(0, e.quantity - 1) } : e
        )
        .filter(e => e.quantity > 0)
    );
  }, []);

  const removeUpc = useCallback((upc: string) => {
    setReturnUpcs(prev => prev.filter(e => e.upc !== upc));
  }, []);

  const clearAll = useCallback(() => {
    setReturnUpcs([]);
    setScanError(null);
  }, []);

  // Calculate totals and fees
  const { totalCount, grossCredit, handlingFee, glassFee, netCredit } = useMemo(() => {
    const count = returnUpcs.reduce((sum, e) => sum + e.quantity, 0);
    let gross = 0;
    let handling = 0;
    let glass = 0;

    for (const entry of returnUpcs) {
      const isGlass = eligibilityCache[entry.upc]?.containerType === 'glass';
      gross += MI_DEPOSIT_VALUE * entry.quantity;
      handling += DEFAULT_HANDLING_FEE * entry.quantity;
      if (isGlass) {
        glass += DEFAULT_GLASS_FEE * entry.quantity;
      }
    }

    const net = Math.max(0, gross - handling - glass);

    return {
      totalCount: count,
      grossCredit: gross,
      handlingFee: handling,
      glassFee: glass,
      netCredit: net
    };
  }, [returnUpcs, eligibilityCache]);

  // Bottom sheet content for InlineScanner
  const bottomSheetContent = useMemo(() => (
    <div className="space-y-4">
      {/* Summary Card */}
      <div className="bg-black/30 border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
              Containers Scanned
            </p>
            <p className="text-white font-black text-2xl">{totalCount}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
              Estimated Credit
            </p>
            <p className="text-ninpo-lime font-black text-2xl">{money(netCredit)}</p>
          </div>
        </div>

        {/* Fee Breakdown */}
        {grossCredit > 0 && (
          <div className="space-y-1 pt-3 border-t border-dashed border-white/10 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            <div className="flex justify-between">
              <span>Gross Return Value</span>
              <span className="font-mono">{money(grossCredit)}</span>
            </div>
            {handlingFee > 0 && (
              <div className="flex justify-between">
                <span>Handling Fee</span>
                <span className="font-mono text-ninpo-red">- {money(handlingFee)}</span>
              </div>
            )}
            {glassFee > 0 && (
              <div className="flex justify-between">
                <span>Glass Handling Fee</span>
                <span className="font-mono text-ninpo-red">- {money(glassFee)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-dashed border-white/10 text-ninpo-lime">
              <span>Net Credit</span>
              <span className="font-mono font-black">{money(netCredit)}</span>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
          <Info className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />
          <p>Estimate only — final value verified at delivery</p>
        </div>
      </div>

      {/* Error Display */}
      {scanError && (
        <div className="bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ninpo-red shrink-0 mt-0.5" />
          <p className="text-[11px] text-ninpo-red font-bold uppercase tracking-widest">
            {scanError}
          </p>
        </div>
      )}

      {isChecking && (
        <div className="text-center text-[11px] text-slate-400 font-bold uppercase tracking-widest">
          Checking eligibility...
        </div>
      )}

      {/* UPC List */}
      {returnUpcs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
              Scanned Items
            </p>
            <button
              onClick={clearAll}
              className="text-[10px] text-ninpo-red font-black uppercase tracking-widest hover:underline"
            >
              Clear All
            </button>
          </div>

          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {returnUpcs.map(entry => {
              const info = eligibilityCache[entry.upc];
              const isGlass = info?.containerType === 'glass';
              
              return (
                <div
                  key={entry.upc}
                  className={`bg-black/30 border rounded-2xl px-4 py-3 space-y-2 ${
                    isGlass ? 'border-yellow-500/20' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-white font-bold tracking-wider truncate">
                        {info?.name || entry.upc}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                          {entry.upc}
                        </span>
                        {isGlass && (
                          <span className="text-[9px] text-yellow-500 font-bold uppercase tracking-widest">
                            Glass
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => decrementUpc(entry.upc)}
                        className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      
                      <div className="w-10 text-center">
                        <p className="text-white font-black text-sm">{entry.quantity}</p>
                      </div>
                      
                      <button
                        onClick={() => incrementUpc(entry.upc)}
                        className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      
                      <button
                        onClick={() => removeUpc(entry.upc)}
                        className="p-2 rounded-xl bg-ninpo-red/10 border border-ninpo-red/20 text-ninpo-red hover:bg-ninpo-red/20 transition ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                    <span>Per unit: {money(MI_DEPOSIT_VALUE)}</span>
                    <span className="text-ninpo-lime">
                      Total: {money(MI_DEPOSIT_VALUE * entry.quantity)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {returnUpcs.length === 0 && !scanError && !isChecking && (
        <div className="text-center py-8">
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">
            Scan a bottle or can barcode to begin
          </p>
        </div>
      )}
    </div>
  ), [totalCount, grossCredit, handlingFee, glassFee, netCredit, scanError, isChecking, returnUpcs, eligibilityCache, clearAll, decrementUpc, incrementUpc, removeUpc]);

  return (
    <div className={`space-y-4 ${className}`}>
      <InlineScanner
        mode={ScannerMode.CUSTOMER_RETURN_SCAN}
        onScan={handleScan}
        title="Bottle Return Scanner"
        subtitle="Scan containers for return credit"
        beepEnabled={true}
        cooldownMs={900}
        bottomSheetContent={bottomSheetContent}
        className="rounded-[2.5rem] overflow-hidden min-h-[600px]"
      />

      {returnUpcs.length > 0 && (
        <button
          onClick={() => onComplete(returnUpcs, netCredit)}
          className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-ninpo-lime/90 transition shadow-neon"
        >
          Continue to Checkout — {money(netCredit)} Credit
        </button>
      )}
    </div>
  );
};

export default CustomerReturnScanner;
