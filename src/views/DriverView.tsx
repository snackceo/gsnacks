import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Order, OrderStatus, ReturnUpcCount, User, UserRole } from '../types';
import { analyzeBottleScan, explainDriverIssue } from '../services/geminiService';
import {
  Camera,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  ScanLine,
  Trash2,
  X,
  Zap,
  PackageCheck,
  Navigation2,
  UserCheck,
  XCircle
} from 'lucide-react';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

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

const DriverView: React.FC<DriverViewProps> = ({ currentUser, orders, updateOrder }) => {
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [aiCondition, setAiCondition] = useState<{
    valid: boolean;
    material: string;
    message: string;
  } | null>(null);
  const [aiConditionStatus, setAiConditionStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const [verifiedReturnUpcs, setVerifiedReturnUpcs] = useState<ReturnUpcCount[]>([]);
  const [manualUpc, setManualUpc] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const [isCapturing, setIsCapturing] = useState(false);
  const [paymentCaptured, setPaymentCaptured] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [issueExplanation, setIssueExplanation] = useState<string | null>(null);
  const [issueStatus, setIssueStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const eligibilityCacheRef = useRef<Record<string, boolean>>({});
  const lastScanAtRef = useRef<number>(0);

  const normalizeUpcCounts = (entries: ReturnUpcCount[] | undefined, fallback: string[]) => {
    if (Array.isArray(entries)) return entries;
    const counts = new Map<string, number>();
    fallback.forEach(upc => {
      const clean = String(upc || '').trim();
      if (!clean) return;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([upc, quantity]) => ({ upc, quantity }));
  };

  const countUpcs = (entries: ReturnUpcCount[]) =>
    entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

  const handleAccept = (orderId: string) => {
    const driverId = currentUser?.username || currentUser?.id || 'DRIVER';
    updateOrder(orderId, OrderStatus.ASSIGNED, { driverId });
  };

  const handlePickUp = (orderId: string) => {
    updateOrder(orderId, OrderStatus.PICKED_UP);
  };

  const handleStartNavigation = (orderId: string) => {
    setIsNavigating(true);
    updateOrder(orderId, OrderStatus.ARRIVING);
    setTimeout(() => {
      setIsNavigating(false);
      alert('Navigation: You have arrived at the delivery address.');
    }, 5000);
  };

  const handleCancel = (orderId: string) => {
    updateOrder(orderId, OrderStatus.CLOSED);
  };

  const resetPhotoState = () => {
    setCapturedPhoto(null);
    setAiCondition(null);
    setAiConditionStatus('idle');
  };

  const isReturnOnlyOrder = (order?: Order | null) => {
    if (!order) return false;
    const count =
      order.returnUpcCounts !== undefined
        ? countUpcs(order.returnUpcCounts)
        : order.returnUpcs?.length ?? 0;
    return (order.items?.length ?? 0) === 0 && count > 0;
  };

  const startVerification = async (order: Order) => {
    setActiveOrder(order);
    resetPhotoState();
    const initialEntries = order.verifiedReturnUpcCounts ?? order.returnUpcCounts;
    const fallbackUpcs = order.verifiedReturnUpcs?.length
      ? order.verifiedReturnUpcs
      : order.returnUpcs || [];
    setVerifiedReturnUpcs(normalizeUpcCounts(initialEntries, fallbackUpcs));
    setManualUpc('');
    setScannerOpen(false);
    setScannerError(null);
    setCaptureError(null);
    setIssueExplanation(null);
    setIssueStatus('idle');

    setPaymentCaptured(order.status === OrderStatus.PAID || isReturnOnlyOrder(order));

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch {
      alert('Camera access is required for delivery proof.');
    }
  };

  const takePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg');
    setCapturedPhoto(dataUrl);
    setAiCondition(null);
    setAiConditionStatus('loading');

    try {
      const base64Data = dataUrl.split(',')[1] || dataUrl;
      const result = await analyzeBottleScan(base64Data);
      setAiCondition(result);
      setAiConditionStatus('idle');
    } catch {
      setAiConditionStatus('error');
    }
  };

  const updateEligibilityCache = (upc: string, isEligible: boolean) => {
    eligibilityCacheRef.current = { ...eligibilityCacheRef.current, [upc]: isEligible };
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
    setVerifiedReturnUpcs(prev => {
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
      setScannerError('UPC already scanned. Use + to add another of the same item.');
    }
  };

  const incrementUpc = (upc: string) => {
    setVerifiedReturnUpcs(prev =>
      prev.map(entry =>
        entry.upc === upc ? { ...entry, quantity: entry.quantity + 1 } : entry
      )
    );
  };

  const decrementUpc = (upc: string) => {
    setVerifiedReturnUpcs(prev =>
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

    if (!/^\d{8,14}$/.test(upc)) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      return;
    }

    const cached = eligibilityCacheRef.current[upc];
    if (cached !== undefined) {
      if (!cached) {
        playScannerTone(220, 240, 0.25);
        setScannerError('Not eligible for Michigan 10¢ deposit returns');
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
        updateEligibilityCache(upc, isEligible);
        if (!isEligible) {
          playScannerTone(220, 240, 0.25);
          setScannerError('Not eligible for Michigan 10¢ deposit returns');
          return;
        }
        addEligibleUpc(upc);
        return;
      }

      if (response.status === 404) {
        updateEligibilityCache(upc, false);
        playScannerTone(220, 240, 0.25);
        setScannerError('Not eligible for Michigan 10¢ deposit returns');
        return;
      }

      throw new Error(`Eligibility check failed: ${response.status}`);
    } catch {
      playScannerTone(220, 240, 0.25);
      setScannerError('Unable to validate UPC eligibility. Please try again.');
    }
  };

  const removeUpc = (upc: string) => {
    setVerifiedReturnUpcs(prev => prev.filter(entry => entry.upc !== upc));
  };

  const clearUpcs = () => {
    setVerifiedReturnUpcs([]);
    setScannerError(null);
  };

  const capturePayment = async () => {
    if (!activeOrder) return;

    setIsCapturing(true);
    setCaptureError(null);
    setIssueExplanation(null);
    setIssueStatus('idle');
    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/capture`, {
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

      setPaymentCaptured(true);

      const capturedOrder = data?.order;
      const verifiedReturnCredit = Number(capturedOrder?.verifiedReturnCredit || 0);

      updateOrder(activeOrder.id, OrderStatus.PAID, {
        verifiedReturnCredit,
        verifiedReturnUpcs: capturedOrder?.verifiedReturnUpcs || [],
        verifiedReturnUpcCounts: capturedOrder?.verifiedReturnUpcCounts || verifiedReturnUpcs,
        paidAt: new Date().toISOString()
      });

      alert('Payment captured successfully.');
    } catch (e: any) {
      const message = e?.message || 'Payment capture failed.';
      setCaptureError(message);
      alert(message);
    } finally {
      setIsCapturing(false);
    }
  };

  const explainCaptureIssue = async () => {
    if (!activeOrder || !captureError) return;
    setIssueStatus('loading');
    try {
      const explanation = await explainDriverIssue(activeOrder, captureError);
      setIssueExplanation(explanation || 'No explanation returned.');
      setIssueStatus('idle');
    } catch {
      setIssueExplanation('Issue explanation unavailable.');
      setIssueStatus('error');
    }
  };

  const completeDelivery = () => {
    if (!activeOrder) return;

    if (!paymentCaptured && !isReturnOnlyOrder(activeOrder)) {
      alert('Capture payment first (verify returns), then complete delivery.');
      return;
    }

    if (!capturedPhoto) {
      alert('Capture a delivery proof photo before completing delivery.');
      return;
    }

    setIsVerifying(true);

    const uploadProof = async () => {
      if (!capturedPhoto) return null;

      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

      if (cloudName && uploadPreset) {
        const imageBlob = await fetch(capturedPhoto).then(res => res.blob());
        const formData = new FormData();
        formData.append('file', imageBlob, `proof-${activeOrder.id}.jpg`);
        formData.append('upload_preset', uploadPreset);
        formData.append('folder', 'delivery-proofs');
        formData.append('context', `orderId=${activeOrder.id}`);

        const uploadRes = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          {
            method: 'POST',
            body: formData
          }
        );
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          throw new Error(uploadData?.error?.message || 'Proof upload failed.');
        }
        return uploadData?.secure_url || uploadData?.url || null;
      }

      const res = await fetch(`${BACKEND_URL}/api/uploads/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: activeOrder.id,
          imageData: capturedPhoto
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Proof upload failed.');
      }
      return data?.url || null;
    };

    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const proofUrl = await uploadProof();
          const metadata = {
            deliveredAt: new Date().toISOString(),
            gpsCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            verificationPhoto: proofUrl || undefined,
            ...(isReturnOnlyOrder(activeOrder)
              ? { verifiedReturnUpcCounts: verifiedReturnUpcs }
              : {})
          };

          updateOrder(activeOrder.id, OrderStatus.DELIVERED, metadata);

          setIsVerifying(false);
          setActiveOrder(null);
          resetPhotoState();
          setVerifiedReturnUpcs([]);
          setManualUpc('');
          setScannerOpen(false);
          setScannerError(null);
          setPaymentCaptured(false);
        } catch (e: any) {
          alert(e?.message || 'Delivery proof upload failed.');
          setIsVerifying(false);
        }
      },
      () => {
        alert('GPS is required to complete delivery.');
        setIsVerifying(false);
      },
      { enableHighAccuracy: true }
    );
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

  const stopScanner = async () => {
    setIsScanning(false);

    if (scanLoopRef.current) {
      window.clearTimeout(scanLoopRef.current);
      scanLoopRef.current = null;
    }

    if (scannerStreamRef.current) {
      try {
        scannerStreamRef.current.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      scannerStreamRef.current = null;
    }

    if (scannerVideoRef.current) {
      try {
        (scannerVideoRef.current as any).srcObject = null;
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

        scannerStreamRef.current = stream;
        if (scannerVideoRef.current) {
          (scannerVideoRef.current as any).srcObject = stream;
          await scannerVideoRef.current.play();
        }

        if (cancelled) return;

        const detector = new (window as any).BarcodeDetector({
          formats: ['upc_a', 'ean_13', 'ean_8', 'upc_e']
        });

        setIsScanning(true);

        const scanTick = async () => {
          if (!scannerOpen || cancelled) return;
          if (!scannerVideoRef.current || scannerVideoRef.current.readyState < 2) {
            scanLoopRef.current = window.setTimeout(scanTick, 250);
            return;
          }

          try {
            const barcodes = await detector.detect(scannerVideoRef.current);
            if (Array.isArray(barcodes) && barcodes.length > 0) {
              const rawValue = barcodes[0]?.rawValue;
              if (rawValue) {
                addUpc(rawValue, 'scanner');
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

  useEffect(() => {
    if (!activeOrder) {
      closeScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder]);

  const isReturnOnly = isReturnOnlyOrder(activeOrder);
  const verifiedReturnCount = useMemo(
    () => verifiedReturnUpcs.reduce((sum, entry) => sum + entry.quantity, 0),
    [verifiedReturnUpcs]
  );

  const scannerModal =
    scannerOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[12000] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={closeScanner} />
            <div className="relative w-full max-w-lg bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-sm">
                    Driver UPC Scanner
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
                <video ref={scannerVideoRef} className="w-full h-full object-cover" playsInline muted />
                {isScanning && <span className="scanning-line" />}
                {!isScanning && (
                  <div className="absolute text-center px-8">
                    <Camera className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                      {scannerError ? 'Scanner unavailable' : 'Initializing camera...'}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Scanned: <span className="text-white">{verifiedReturnCount}</span>
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
                Tip: If scanning fails, close this and use manual UPC entry below.
              </p>
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
                      Delivery fee: <span className="text-white">{money(o.deliveryFee || 0)}</span>
                    </p>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                      Est. bottle credit:{' '}
                      <span className="text-ninpo-lime">{money(o.estimatedReturnCredit || 0)}</span>
                    </p>
                  </div>
                </div>

              {(o.status === OrderStatus.PENDING || o.status === OrderStatus.ASSIGNED) &&
                currentUser?.role === UserRole.OWNER && (
                  <button
                    onClick={() => handleCancel(o.id)}
                    className="px-4 py-3 rounded-xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-2"
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

                {(o.status === OrderStatus.ARRIVING || o.status === OrderStatus.PICKED_UP) && (
                  <button
                    onClick={() => startVerification(o)}
                    className="flex-1 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> Verify & Deliver
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {activeOrder && (
          <div className="bg-ninpo-midnight p-10 rounded-[3rem] border border-ninpo-lime/20 shadow-neon space-y-8 animate-in slide-in-bottom">
            <h3 className="text-xl font-black uppercase tracking-tighter text-ninpo-lime">
              Verification & Delivery
            </h3>

            <div className="bg-black/30 border border-white/10 rounded-2xl p-6 space-y-5 text-xs">
              <p className="uppercase tracking-widest opacity-60">Order</p>
              <p className="font-black">{activeOrder.id}</p>

              <p className="uppercase tracking-widest opacity-60 mt-4">Estimated bottle credit (preview)</p>
              <p className="font-black text-ninpo-lime">{money(activeOrder.estimatedReturnCredit || 0)}</p>

              <p className="uppercase tracking-widest opacity-60 mt-4">Delivery fee</p>
              <p className="font-black">{money(activeOrder.deliveryFee || 0)}</p>

              <div>
                <p className="uppercase tracking-widest opacity-60">Verified return UPCs (driver)</p>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                      <input
                        value={manualUpc}
                        onChange={e => setManualUpc(e.target.value)}
                        inputMode="numeric"
                        className="w-full bg-transparent outline-none text-white font-black text-sm"
                        placeholder="Enter UPC (8–14 digits)"
                      />
                    </div>
                    <button
                      onClick={() => addUpc(manualUpc, 'manual')}
                      className="px-4 py-3 bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Add
                    </button>
                    <button
                      onClick={openScanner}
                      className="px-4 py-3 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      <ScanLine className="w-4 h-4" /> Scan
                    </button>
                  </div>

                  {scannerError && (
                    <div className="text-[11px] text-ninpo-red bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl px-4 py-3">
                      {scannerError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                      Verified UPCs: <span className="text-white">{verifiedReturnCount}</span>
                    </div>
                    <button
                      onClick={clearUpcs}
                      disabled={verifiedReturnCount === 0}
                      className="px-4 py-2 bg-ninpo-red/10 text-ninpo-red rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </div>

                  {verifiedReturnUpcs.length > 0 ? (
                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                      {verifiedReturnUpcs.map(entry => (
                        <div
                          key={entry.upc}
                          className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] font-black tracking-widest text-white">
                              {entry.upc}
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                              × {entry.quantity}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => decrementUpc(entry.upc)}
                              className="text-white text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 border border-white/10"
                            >
                              -
                            </button>
                            <button
                              onClick={() => incrementUpc(entry.upc)}
                              className="text-white text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 border border-white/10"
                            >
                              +
                            </button>
                            <button
                              onClick={() => removeUpc(entry.upc)}
                              className="text-ninpo-red text-[10px] font-black uppercase tracking-widest"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                      No UPCs verified yet.
                    </div>
                  )}
                </div>
              </div>

              {!isReturnOnly && (
                <>
                  <button
                    onClick={capturePayment}
                    disabled={isCapturing || paymentCaptured}
                    className="w-full px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                    title="Captures (charges) the final amount after verified bottle credit"
                  >
                    {isCapturing ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Capturing
                      </span>
                    ) : paymentCaptured ? (
                      'Captured'
                    ) : (
                      'Capture'
                    )}
                  </button>

                  <p className="mt-2 text-[10px] uppercase tracking-widest opacity-60">
                    Note: final charge = total - verified credit (computed from eligible UPCs).
                  </p>

                  {captureError && (
                    <div className="mt-4 bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4 space-y-3">
                      <p className="text-[11px] text-ninpo-red font-bold uppercase tracking-widest">
                        Capture blocked
                      </p>
                      <p className="text-[11px] text-slate-300">{captureError}</p>
                      <button
                        onClick={explainCaptureIssue}
                        disabled={issueStatus === 'loading'}
                        className="px-4 py-3 rounded-xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-60"
                      >
                        {issueStatus === 'loading' ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Explaining
                          </>
                        ) : (
                          <>
                            <BrainCircuit className="w-4 h-4" /> Explain Issue
                          </>
                        )}
                      </button>
                      {issueExplanation && (
                        <div className="text-[11px] text-slate-200 whitespace-pre-wrap">
                          {issueExplanation}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {isReturnOnly && (
                <p className="mt-2 text-[10px] uppercase tracking-widest opacity-60">
                  Return-only pickup: no payment capture required.
                </p>
              )}
            </div>

            <div className="relative aspect-video rounded-3xl overflow-hidden bg-ninpo-black">
              {capturedPhoto ? (
                <img src={capturedPhoto} className="w-full h-full object-cover" alt="Delivery proof" />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover grayscale opacity-50"
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {capturedPhoto && (
              <div className="bg-black/30 border border-white/10 rounded-2xl p-5 text-xs space-y-2">
                <p className="uppercase tracking-widest opacity-60">AI condition check (advisory)</p>
                {aiConditionStatus === 'loading' && (
                  <p className="text-[11px] text-slate-400">Analyzing container condition...</p>
                )}
                {aiConditionStatus === 'error' && (
                  <p className="text-[11px] text-ninpo-red">
                    Condition scan unavailable. Proceed with manual inspection.
                  </p>
                )}
                {aiCondition && (
                  <div className="space-y-1 text-[11px]">
                    <p className={aiCondition.valid ? 'text-ninpo-lime' : 'text-ninpo-red'}>
                      {aiCondition.message || (aiCondition.valid ? 'Condition acceptable.' : 'Condition concern.')}
                    </p>
                    <p className="text-slate-500 uppercase tracking-widest">
                      Material: <span className="text-white">{aiCondition.material || 'unknown'}</span>
                    </p>
                  </div>
                )}
                <p className="text-[10px] uppercase tracking-widest text-slate-600">
                  Eligibility is determined by the UPC whitelist, not AI.
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={takePhoto}
                className="flex-1 py-4 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Capture Photo
              </button>

              {capturedPhoto && (
                <button
                  onClick={resetPhotoState}
                  className="px-6 py-4 bg-ninpo-red/10 text-ninpo-red rounded-xl text-[10px] font-black uppercase"
                >
                  Retake
                </button>
              )}
            </div>

            <button
              disabled={!capturedPhoto || isVerifying}
              onClick={completeDelivery}
              className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-neon flex items-center justify-center gap-4 transition-all disabled:opacity-50"
              title={!paymentCaptured && !isReturnOnly ? 'Capture payment first' : 'Complete delivery'}
            >
              {isVerifying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Complete Delivery <CheckCircle2 className="w-5 h-5" />
                </>
              )}
            </button>

            {!paymentCaptured && !isReturnOnly && (
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Capture payment after verifying bottle returns, then complete delivery.
              </p>
            )}
            {isReturnOnly && (
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Return-only pickup: verify UPCs, capture proof, then complete delivery.
              </p>
            )}
          </div>
        )}
        {scannerModal}
      </div>
    </div>
  );
};

export default DriverView;
