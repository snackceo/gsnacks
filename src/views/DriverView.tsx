/// <reference types="vite/client" />
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom'; 
import { Order, OrderStatus, ReturnUpcCount, User, UserRole, ScannerMode, FulfillmentTarget, FulfillmentScanEntry } from '../types';
import { explainDriverIssue } from '../services/geminiService';
import { apiFetch } from '../utils/apiFetch';
import {
  Clock,
  ScanLine,
  X,
  Zap,
  PackageCheck,
  Navigation2,
  UserCheck,
  XCircle
} from 'lucide-react';
import ScannerModal from '../components/ScannerModal';
import DriverVerificationDelivery from './DriverVerificationDelivery';
import DriverOrderFlow from '../components/DriverOrderFlow';
import DriverOrderDetail from '../components/DriverOrderDetail';
import useCameraStream from '../hooks/useCameraStream';
import { useOrderManagement } from '../hooks/useOrderManagement';
import { useReturnScanner } from '../hooks/useReturnScanner';
import { useDeliveryWorkflow } from '../hooks/useDeliveryWorkflow';

interface DriverViewProps {
  currentUser: User | null;
  orders: Order[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
}

function money(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return `$${v.toFixed(2)}`;
}

interface DriverState {
  scannerOpen: boolean;
  showScanSummary: boolean;
  scanSummaryOpen: boolean;
  showPayoutChoice: boolean;
  isCapturing: boolean;
  captureError: string | null;
  issueExplanation: string | null;
  issueStatus: 'idle' | 'loading' | 'error';
  driverMode: 'RETURNS_INTAKE' | 'PICK_PACK';
  scannerMode: ScannerMode;
  workflowMode: 'verification' | 'delivery';
  fulfillmentScans: FulfillmentScanEntry[];
}

type DriverAction =
  | { type: 'SET_STATE'; payload: Partial<DriverState> }
  | { type: 'ADD_FULFILLMENT_SCAN'; payload: { key: string; upc: string; productId?: string } }
  | { type: 'RESET_FULFILLMENT' };

const driverReducer = (state: DriverState, action: DriverAction): DriverState => {
  switch (action.type) {
    case 'SET_STATE':
      return { ...state, ...action.payload };
    case 'ADD_FULFILLMENT_SCAN':
      const existingIndex = state.fulfillmentScans.findIndex(entry => entry.key === action.payload.key);
      if (existingIndex >= 0) {
        const nextScans = [...state.fulfillmentScans];
        nextScans[existingIndex] = {
          ...nextScans[existingIndex],
          quantity: nextScans[existingIndex].quantity + 1,
          upc: action.payload.upc,
        };
        return { ...state, fulfillmentScans: nextScans };
      }
      return { ...state, fulfillmentScans: [...state.fulfillmentScans, { ...action.payload, quantity: 1 }] };
    case 'RESET_FULFILLMENT':
      return { ...state, fulfillmentScans: [] };
    default:
      return state;
  }
};

const DriverView: React.FC<DriverViewProps> = ({ currentUser, orders = [], updateOrder }) => {
  const { activeOrder, setActiveOrder, detailOrderId, setDetailOrderId, isNavigating, handleAccept, handlePickUp, handleStartNavigation } = useOrderManagement({ orders, updateOrder });
  const { verifiedReturnUpcs, setVerifiedReturnUpcs, manualUpc, setManualUpc, scannerError, setScannerError, lastBlockedUpc, setLastBlockedUpc, lastBlockedReason, setLastBlockedReason, pendingDuplicateScan, setPendingDuplicateScan, scanEvents, setScanEvents, quantityEvents, setQuantityEvents, addUpc, clearUpcs, verifiedReturnUpcsRef } = useReturnScanner();
  const { isVerifying, capturedPhoto, setCapturedPhoto, returnCapturedPhoto, setReturnCapturedPhoto, contaminationConfirmed, setContaminationConfirmed, driverNotice, setDriverNotice, completeDelivery, resetPhotoState, resetReturnPhotoState } = useDeliveryWorkflow({ activeOrder, currentUser, updateOrder, verifiedReturnUpcs });

  const initialState: DriverState = {
    scannerOpen: false,
    showScanSummary: false,
    scanSummaryOpen: false,
    showPayoutChoice: false,
    isCapturing: false,
    captureError: null,
    issueExplanation: null,
    issueStatus: 'idle',
    driverMode: 'RETURNS_INTAKE',
    scannerMode: ScannerMode.DRIVER_VERIFY_CONTAINERS,
    workflowMode: 'delivery',
    fulfillmentScans: [],
  };

  const [state, dispatch] = useReducer(driverReducer, initialState);
  const { scannerOpen, showScanSummary, scanSummaryOpen, showPayoutChoice, isCapturing, captureError, issueExplanation, issueStatus, driverMode, scannerMode, workflowMode, fulfillmentScans } = state;

  const [verificationScans, setVerificationScans] = useState<{ upc: string; timestamp: string }[]>([]);
  const [, setRecognizedCount] = useState(0);

  const { error: cameraError, stopCamera } = useCameraStream({ autoStart: false });
  const scanSessionIdRef = useRef<string>('');
  const scanSessionStartedAtRef = useRef<string>('');
  
  const handleScannerModeChange = useCallback((mode: ScannerMode) => {
    dispatch({ type: 'SET_STATE', payload: { scannerMode: mode } });
  }, []);

  const handleCancel = (orderId: string) => {
    if (!orderId) return;
    updateOrder(orderId, OrderStatus.CLOSED);
  };

  const resetPhotoState = () => {
    setCapturedPhoto(null);
  };

  const resetReturnPhotoState = () => {
    setReturnCapturedPhoto(null);
    setContaminationConfirmed(false);
  };

  const extractUpcCandidates = (item: any) => {
    const candidates: string[] = [];
    const pushCandidate = (value?: string) => { // eslint-disable-line
      const normalized = normalizeUpc(value || '');
      if (normalized) candidates.push(normalized);
    };

    pushCandidate(item?.upc);
    pushCandidate(item?.upcCode);
    pushCandidate(item?.barcode);
    pushCandidate(item?.product?.upc);
    pushCandidate(item?.product?.upcCode);
    pushCandidate(item?.product?.barcode);

    if (Array.isArray(item?.upcs)) {
      item.upcs.forEach((candidate: string) => pushCandidate(candidate));
    }
    if (Array.isArray(item?.product?.upcs)) {
      item.product.upcs.forEach((candidate: string) => pushCandidate(candidate));
    }

    if (typeof item?.productId === 'string') {
      pushCandidate(item.productId);
    }
    if (typeof item?.sku === 'string') {
      pushCandidate(item.sku);
    }

    const normalized = candidates.filter(candidate => /^\d{8,14}$/.test(candidate));
    return Array.from(new Set(normalized));
  };

  const fulfillmentTargets = useMemo<FulfillmentTarget[]>(() => { // eslint-disable-line
    if (!activeOrder) return [];
    return (activeOrder.items ?? [])
      .map((item: any, index: number) => {
        const upcCandidates = extractUpcCandidates(item);
        const key = String(item?.productId ?? item?.sku ?? upcCandidates[0] ?? `item-${index}`);
        const label =
          item?.name ||
          item?.product?.name ||
          item?.productId ||
          `Item ${index + 1}`;
        return {
          key,
          label,
          quantity: Number(item?.quantity || 0),
          productId: item?.productId,
          upcCandidates
        };
      })
      .filter(target => target.quantity > 0);
  }, [activeOrder, extractUpcCandidates]);

  
  const fulfillmentProgress = useMemo(() => {
    return fulfillmentTargets.map(target => {
      const scanned = fulfillmentScans.find(entry => entry.key === target.key)?.quantity ?? 0;
      return { ...target, scanned, upcCandidates: target.upcCandidates };
    });
  }, [fulfillmentScans, fulfillmentTargets]); // eslint-disable-line
  const fulfillmentMissingUpcs = useMemo(
    () => fulfillmentTargets.filter(target => target.upcCandidates.length === 0).length,
    [fulfillmentTargets] // eslint-disable-line
  );

  const addVerificationScan = async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    // Check for duplicates
    const isDuplicate = verificationScans.some(scan => scan.upc === upc);
    if (isDuplicate) {
      // playScannerTone(440, 120, 0.2);
      setScannerError('Duplicate scan detected');
      return;
    }

    // Check if UPC is recognized
    try {
      // const response = await fetch(
      //   `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(upc)}`
      // );
      const isRecognized = response.ok;

      if (isRecognized) {
        setRecognizedCount(prev => prev + 1);
        setScannerError('Recognized container');
        // playScannerTone(980, 120, 0.2);
      } else {
        // setUnrecognizedCount(prev => prev + 1); // This state seems to be unused
        setScannerError('Unrecognized container');
        playScannerTone(220, 240, 0.25);
      }

      // Add to scans list
      setVerificationScans(prev => [...prev, {
        upc,
        timestamp: new Date().toISOString()
      }]);

    } catch {
      // On error, treat as unrecognized
      // setUnrecognizedCount(prev => prev + 1); // This state seems to be unused
      // setScannerError('Unable to verify container');
      playScannerTone(220, 240, 0.25);

      setVerificationScans(prev => [...prev, {
        upc,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const addFulfillmentScan = async (
    upcRaw: string,
    source: 'scanner' | 'manual' = 'manual', // This state seems to be unused
    quantity = 1
  ) => {
    const upc = String(upcRaw || '').replace(/\D/g, '').trim();
    if (!upc) return;

    if (!/^\d{8,14}$/.test(upc)) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      return;
    }

    if (!activeOrder) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Select an order before scanning fulfillment items.');
      return;
    }

    if (fulfillmentTargets.length === 0) {
      playScannerTone(220, 240, 0.25);
      setScannerError('No fulfillment items available for this order.');
      return;
    }

    const matchingTargets = fulfillmentTargets.filter(target => target.upcCandidates.includes(upc));
    if (matchingTargets.length === 0) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Scanned UPC is not part of this order.');
      return;
    }

    let addedCount = 0;
    const match = matchingTargets.find(target => {
      const scannedCount = fulfillmentScans.find(s => s.key === target.key)?.quantity || 0;
      return scannedCount < target.quantity;
    });

    if (match) {
      dispatch({ type: 'ADD_FULFILLMENT_SCAN', payload: { key: match.key, upc, productId: match.productId } });
      addedCount = 1;
    }

    if (addedCount === 0) {
      playScannerTone(220, 240, 0.25);
      setScannerError('All matching items have already been scanned.');
      return;
    }

    if (addedCount < quantity) {
      setScannerError('Some items were already fully scanned.');
    } else {
      setScannerError(null);
    }

    if (source === 'scanner') {
      playScannerTone(980, 120, 0.2);
    }
  };

  const handleScannerScan = async (upc: string, qty = 1) => {
    if (scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS) {
      for (let i = 0; i < qty; i += 1) { // This state seems to be unused
        await addVerificationScan(upc, 'scanner');
      }
    } else if (scannerMode === ScannerMode.DRIVER_FULFILL_ORDER) { // This state seems to be unused
      await addFulfillmentScan(upc, 'scanner', qty);
    } else {
      // Original logic for other modes
      for (let i = 0; i < qty; i++) {
        await addUpc(upc, 'scanner');
      }
    }
  };

  const sendScanSessionMetadata = async (stage: 'pre_capture' | 'post_capture') => {
    const verifiedReturnUpcs = verifiedReturnUpcsRef.current;
    const countUpcs = (entries: ReturnUpcCount[]) => entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    if (!activeOrder) return;
    if (scanEvents.length === 0 && quantityEvents.length === 0) return;
    try {
      await fetch(`${BACKEND_URL}/api/scan-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: activeOrder.id,
          driverId: currentUser?.username || currentUser?.id || 'DRIVER',
          sessionId: scanSessionIdRef.current,
          startedAt: scanSessionStartedAtRef.current,
          stage,
          summary: {
            totalScanEvents: scanEvents.length,
            totalQuantityChanges: quantityEvents.length,
            verifiedReturnCount: countUpcs(verifiedReturnUpcs)
          },
          scanEvents,
          quantityEvents
        })
      });
    } catch {
      // best-effort: ignore if endpoint is unavailable
    }
  };

  const capturePayment = async () => {
    if (!activeOrder) return;

    dispatch({ type: 'SET_STATE', payload: { isCapturing: true, captureError: null, issueExplanation: null, issueStatus: 'idle' } });
    setDriverNotice(null);
    await sendScanSessionMetadata('pre_capture');
    try {
      const res = await apiFetch(`/api/payments/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: activeOrder.id,
          verifiedReturnUpcCounts: verifiedReturnUpcs
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Capture failed');

      await sendScanSessionMetadata('post_capture');

      const capturedOrder = data?.order;
      const verifiedReturnCredit = Number(capturedOrder?.verifiedReturnCredit || 0);

      const resolvedVerifiedCounts =
        Array.isArray(capturedOrder?.verifiedReturnUpcCounts) &&
        capturedOrder.verifiedReturnUpcCounts.length > 0
          ? capturedOrder.verifiedReturnUpcCounts
          : verifiedReturnUpcs;

      updateOrder(activeOrder.id, OrderStatus.PAID, {
        verifiedReturnCredit,
        verifiedReturnUpcs: capturedOrder?.verifiedReturnUpcs || [],
        verifiedReturnUpcCounts: resolvedVerifiedCounts,
        paidAt: new Date().toISOString()
      });

      setDriverNotice({ tone: 'success', message: 'Payment captured successfully.' });
    } catch (e: any) {
      const message = e?.message || 'Payment capture failed.';
      dispatch({ type: 'SET_STATE', payload: { captureError: message } });
      setDriverNotice({ tone: 'error', message });
    } finally {
      dispatch({ type: 'SET_STATE', payload: { isCapturing: false } });
    }
  };

  const explainCaptureIssue = async () => {
    if (!activeOrder || !captureError) return;
    dispatch({ type: 'SET_STATE', payload: { issueStatus: 'loading' } });
    try {
      const explanation = await explainDriverIssue(activeOrder, captureError);
      dispatch({ type: 'SET_STATE', payload: { issueExplanation: explanation || 'No explanation returned.', issueStatus: 'idle' } });
    } catch {
      dispatch({ type: 'SET_STATE', payload: { issueExplanation: 'Issue explanation unavailable.', issueStatus: 'error' } });
    }
  };

  const queue = useMemo(() => {
    return (orders || []).filter(o =>
      [
        OrderStatus.PENDING,
        OrderStatus.PAID,
        OrderStatus.AUTHORIZED,
        OrderStatus.ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.ARRIVING
      ].includes(o.status)
    );
  }, [orders]);

  useEffect(() => {
    verifiedReturnUpcsRef.current = verifiedReturnUpcs;
  }, [verifiedReturnUpcs]);

  useEffect(() => {
    if (!activeOrder) {
      dispatch({ type: 'SET_STATE', payload: { scannerOpen: false } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder]);

  useEffect(() => {
    if (!activeOrder) {
      stopCamera();
    }
  }, [activeOrder, stopCamera]);

  useEffect(() => {
    if (cameraError && activeOrder) {
      setDriverNotice({
        tone: 'error',
        message: 'Camera access is required for delivery and return photos.'
      });
    }
  }, [activeOrder, cameraError]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    dispatch({ type: 'RESET_FULFILLMENT' });
  }, [activeOrder?.id]);

  useEffect(() => {
    setScannerError(null);
    setLastBlockedUpc(null);
    setLastBlockedReason(null);
  }, [scannerMode]);

  useEffect(() => {
    if (scannerMode === ScannerMode.DRIVER_FULFILL_ORDER && driverMode !== 'PICK_PACK') {
      dispatch({ type: 'SET_STATE', payload: { driverMode: 'PICK_PACK' } });
    }
    if (scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS && driverMode !== 'RETURNS_INTAKE') {
      dispatch({ type: 'SET_STATE', payload: { driverMode: 'RETURNS_INTAKE' } });
    }
  }, [driverMode, scannerMode]);

  const driverScannerTitle =
    scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS
      ? 'Verify Return Containers'
      : scannerMode === ScannerMode.DRIVER_FULFILL_ORDER
        ? 'Fulfillment Scan'
        : 'Scan UPCs';
  const driverScannerSubtitle =
    scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS
      ? 'Scan each container to verify returns.'
      : scannerMode === ScannerMode.DRIVER_FULFILL_ORDER
        ? 'Scan items to confirm the order is packed correctly.'
        : 'Scan UPCs to add to the return list.';

  const handleCapturePaymentClick = () => {
    if (showScanSummary) {
      dispatch({ type: 'SET_STATE', payload: { scanSummaryOpen: true } });
      return;
    }
    capturePayment();
  };

  const cashAvailable = Boolean((activeOrder as any)?.cashAvailable);

  const payoutChoiceModal =
    showPayoutChoice && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => dispatch({ type: 'SET_STATE', payload: { showPayoutChoice: false } })}
            />
            <div className="relative w-full max-w-xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-sm">
                    Choose How to Use Your Return Value
                  </p>
                </div>
                <button
                  onClick={() => dispatch({ type: 'SET_STATE', payload: { showPayoutChoice: false } })}
                  className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-5 space-y-3 text-[11px] uppercase tracking-widest text-slate-300">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Apply to This Order</p>
                  <p>Use your verified return value to reduce today’s total.</p>
                  <p>
                    Silver+ can apply credits to route and distance fees; Common/Bronze apply to
                    products.
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Save as Credits</p>
                  <p>Store your return value for future orders.</p>
                  <p>Credits never expire and post after eligibility is confirmed.</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Cash</p>
                  <p>Receive cash for your verified returns.</p>
                  <p>Gold+ only; available when cash settlement is selected.</p>
                  {!cashAvailable && (
                    <p className="text-ninpo-red">
                      Cash payout isn’t available for this return. You can apply value to your
                      order or save it as credits.
                    </p>
                  )}
                </div>
              </div>

              <p className="mt-4 text-[10px] uppercase tracking-widest text-slate-500">
                All options require verified eligible containers.
              </p>
            </div>
          </div>,
          document.body
        )
      : null;

  const scanSummaryModal =
    scanSummaryOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center p-6">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => dispatch({ type: 'SET_STATE', payload: { scanSummaryOpen: false } })}
            />
            <div className="relative w-full max-w-2xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-sm">
                    Scan Session Summary
                  </p>
                </div>
                <button
                  onClick={() => dispatch({ type: 'SET_STATE', payload: { scanSummaryOpen: false } })}
                  className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-6 text-[11px] uppercase tracking-widest text-slate-300">
                <div>
                  <h4 className="text-white font-black mb-2">Scan Events ({scanEvents.length})</h4>
                  <div className="space-y-2 h-64 overflow-y-auto pr-2">
                    {scanEvents.map(event => (
                      <div key={event.id} className="bg-white/5 p-2 rounded-lg">
                        <p>UPC: {event.upc}</p>
                        <p>Status: {event.status}</p>
                        <p>Source: {event.source}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-white font-black mb-2">Quantity Changes ({quantityEvents.length})</h4>
                  <div className="space-y-2 h-64 overflow-y-auto pr-2">
                    {quantityEvents.map(event => (
                      <div key={event.id} className="bg-white/5 p-2 rounded-lg">
                        <p>UPC: {event.upc}</p>
                        <p>Delta: {event.delta}</p>
                        <p>Reason: {event.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
               <div className="mt-4 flex justify-end">
                <button
                  onClick={capturePayment}
                  className="px-6 py-3 bg-ninpo-lime text-ninpo-black rounded-xl text-sm font-black uppercase tracking-widest"
                >
                  Confirm and Capture Payment
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="space-y-10 animate-in fade-in">
      <div className="bg-ninpo-midnight p-8 rounded-[3rem] border border-white/5 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl">
        <h2 className="text-2xl font-black uppercase tracking-tighter">Driver Hub</h2>
        <div className="flex gap-4">
          <div className="px-6 py-3 bg-ninpo-lime/10 rounded-2xl border border-ninpo-lime/20 flex items-center gap-3">
            <Zap className="w-4 h-4 text-ninpo-lime" />
            <p className="text-sm font-black text-ninpo-lime uppercase">UNIT STATUS: ACTIVE</p>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => {
            dispatch({ type: 'SET_STATE', payload: { driverMode: 'RETURNS_INTAKE', scannerMode: ScannerMode.DRIVER_VERIFY_CONTAINERS } });
          }}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            driverMode === 'RETURNS_INTAKE' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Returns Intake
        </button>
        <button
          onClick={() => {
            dispatch({ type: 'SET_STATE', payload: { driverMode: 'PICK_PACK', scannerMode: ScannerMode.DRIVER_FULFILL_ORDER } });
          }}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            driverMode === 'PICK_PACK' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Pick/Pack Orders
        </button>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => dispatch({ type: 'SET_STATE', payload: { workflowMode: 'delivery' } })}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            workflowMode === 'delivery' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Delivery Workflow
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_STATE', payload: { workflowMode: 'verification' } })}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            workflowMode === 'verification' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Container Verification
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h3 className="text-white font-black uppercase text-xs tracking-widest flex items-center gap-3">
            <Clock className="w-4 h-4 text-ninpo-lime" /> Dispatch Queue
          </h3>

          {queue.map(o => (
            <div key={o.id} className="bg-ninpo-card border border-white/5 rounded-[2.5rem] p-8 space-y-6">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-600 uppercase">ORDER: {o.id}</p>
                  <p className="text-white font-black text-lg uppercase mt-1 truncate">
                    {o.address ? o.address : 'No address provided'}
                  </p>
                  <p className="text-[9px] font-black text-ninpo-lime uppercase mt-2 tracking-widest">
                    STATUS: {String(o.status).replace('_', ' ')}
                  </p>

                  <div className="mt-4 space-y-1">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                      Total (pre-credit): <span className="text-white">{money(o.total)}</span>
                    </p>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                      Route fee: <span className="text-white">{money(o.routeFee || 0)}</span>
                    </p>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                      Est. return credit:{' '}
                      <span className="text-ninpo-lime">{money(o.estimatedReturnCredit || 0)}</span>
                    </p>
                  </div>
                </div>

                {(o.status === OrderStatus.PENDING || o.status === OrderStatus.ASSIGNED) &&
                  currentUser?.role === UserRole.OWNER && (
                    <button
                      onClick={() => handleCancel(o.id)}
                      className="px-4 py-3 rounded-xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-ninpo-red/20 transition"
                      title="Cancel (restocks inventory immediately)"
                    >
                      <XCircle className="w-4 h-4" /> Cancel
                    </button>
                  )}
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                {(o.status === OrderStatus.PENDING ||
                  o.status === OrderStatus.AUTHORIZED ||
                  o.status === OrderStatus.PAID) && (
                  <button
                    onClick={() => handleAccept(o.id)}
                    className="flex-1 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-all"
                  >
                    <UserCheck className="w-4 h-4" /> Accept / Assign to Me
                  </button>
                )}

                {o.status === OrderStatus.ASSIGNED && (
                  <button
                    onClick={() => handlePickUp(o.id)}
                    className="flex-1 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-all"
                  >
                    <PackageCheck className="w-4 h-4" /> Mark Picked Up
                  </button>
                )}

                {(o.status === OrderStatus.PICKED_UP || o.status === OrderStatus.ARRIVING) && (
                  <button
                    onClick={() => handleStartNavigation(o.id)}
                    disabled={isNavigating && o.status === OrderStatus.ARRIVING}
                    className="flex-1 py-4 bg-white/10 text-white rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/20 transition-all disabled:opacity-50"
                  >
                    <Navigation2 className="w-4 h-4" /> {isNavigating ? 'Navigating...' : 'Start Navigation'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="bg-ninpo-card border border-white/5 rounded-[2.5rem] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Scanner Mode
                </p>
                <p className="text-white font-black text-lg uppercase">Driver Scan Panel</p>
              </div>
              <button
                onClick={() => setScannerOpen(true)}
                className="px-4 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
              >
                <ScanLine className="w-4 h-4" /> Open Scanner
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  dispatch({ type: 'SET_STATE', payload: { scannerMode: ScannerMode.DRIVER_VERIFY_CONTAINERS, driverMode: 'RETURNS_INTAKE' } });
                }}
                className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                  scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS
                    ? 'bg-ninpo-lime text-ninpo-black'
                    : 'bg-white/5 text-white'
                }`}
              >
                Returns Verification
              </button>
              <button
                onClick={() => {
                  dispatch({ type: 'SET_STATE', payload: { scannerMode: ScannerMode.DRIVER_FULFILL_ORDER, driverMode: 'PICK_PACK' } });
                }}
                className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                  scannerMode === ScannerMode.DRIVER_FULFILL_ORDER
                    ? 'bg-ninpo-lime text-ninpo-black'
                    : 'bg-white/5 text-white'
                }`}
              >
                Fulfillment Scan
              </button>
            </div>

            {scannerError && (
              <div className="rounded-2xl bg-ninpo-red/10 border border-ninpo-red/30 px-4 py-3 text-[10px] uppercase tracking-widest text-ninpo-red">
                {scannerError}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={manualUpc}
                onChange={(e) => setManualUpc(e.target.value)}
                placeholder="Enter UPC manually"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ninpo-lime"
              />
              <button
                onClick={() => addUpc(manualUpc, 'manual')}
                className="px-4 py-2 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                Add
              </button>
            </div>

            {!activeOrder && (
              <p className="text-[11px] text-slate-400">
                Select an order from the queue to scan returns or fulfill items.
              </p>
            )}

            {activeOrder && scannerMode === ScannerMode.DRIVER_FULFILL_ORDER && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-400">
                  <span>Fulfillment Progress</span>
                  <span>
                    {fulfillmentScans.reduce((sum, entry) => sum + entry.quantity, 0)}/
                    {fulfillmentTargets.reduce((sum, entry) => sum + entry.quantity, 0)} scanned
                  </span>
                </div>
                {fulfillmentMissingUpcs > 0 && (
                  <p className="text-[10px] uppercase tracking-widest text-ninpo-red">
                    {fulfillmentMissingUpcs} items missing UPC mapping.
                  </p>
                )}
                <div className="space-y-2">
                  {fulfillmentProgress.map(entry => (
                    <div
                      key={entry.key}
                      className="flex items-center justify-between rounded-2xl bg-white/5 border border-white/10 px-4 py-3"
                    >
                      <div>
                        <p className="text-[11px] font-black text-white uppercase">{entry.label}</p>
                        <p className="text-[9px] uppercase tracking-widest text-slate-500">
                          {entry.upcCandidates.length > 0
                            ? `UPC(s): ${entry.upcCandidates.join(', ')}`
                            : 'UPC missing'}
                        </p>
                      </div>
                      <div className="text-[11px] font-black text-ninpo-lime uppercase">
                        {entry.scanned}/{entry.quantity}
                      </div>
                    </div>
                  ))}
                  {fulfillmentProgress.length === 0 && (
                    <p className="text-[11px] text-slate-400">
                      No fulfillment items found for this order.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <ScannerModal
          mode={scannerMode}
          onScan={handleScannerScan}
          onClose={() => dispatch({ type: 'SET_STATE', payload: { scannerOpen: false } })}
          onModeChange={handleScannerModeChange}
          onCooldown={(upc, reason) => {
            addToast('Same UPC — tap to add again', 'info');
            setLastBlockedUpc(upc);
            setLastBlockedReason(reason);
          }}
          title={driverScannerTitle}
          subtitle={driverScannerSubtitle}
          beepEnabled
          cooldownMs={1200}
          isOpen={scannerOpen}
          closeOnScan={false}
        />

        {activeOrder && workflowMode === 'delivery' && (
          <DriverOrderFlow
            order={activeOrder} onComplete={completeDelivery}
            onBack={() => {
              setActiveOrder(null);
            }}
            onRefresh={() => {
              // Refresh the active order with updated status
            }}
          />
        )}

        {activeOrder && workflowMode === 'verification' && (
          <DriverVerificationDelivery
            activeOrder={activeOrder}
            driverNotice={driverNotice}
            workflowMode={workflowMode}
            setScannerMode={(mode) => dispatch({ type: 'SET_STATE', payload: { scannerMode: mode } })}
            setScannerOpen={(open) => dispatch({ type: 'SET_STATE', payload: { scannerOpen: open } })}
            scannerError={scannerError}
            isCapturing={isCapturing}
            captureError={captureError}
            issueStatus={issueStatus}
            issueExplanation={issueExplanation}
            explainCaptureIssue={explainCaptureIssue}
            onCapturePayment={handleCapturePaymentClick}
          />
        )}

        {detailOrderId && (
          <DriverOrderDetail
            order={orders.find(o => o.id === detailOrderId || o.orderId === detailOrderId) as Order | { orderId: string }}
            onBack={() => setDetailOrderId(null)}
          />
        )}
      </div>    </div>
  );
};

export default DriverView;
