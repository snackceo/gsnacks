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

type ScanEventStatus =
  | 'detected'
  | 'cooldown_blocked'
  | 'invalid_format'
  | 'ineligible'
  | 'eligible'
  | 'duplicate_prompt'
  | 'added_existing';

type QuantityChangeReason =
  | 'scan_add'
  | 'manual_add'
  | 'scan_confirm'
  | 'manual_increment'
  | 'manual_decrement'
  | 'scan_increment'
  | 'scan_decrement';

interface ScanEventLogEntry {
  id: string;
  upc: string;
  source: 'scanner' | 'manual';
  status: ScanEventStatus;
  recordedAt: string;
}

interface QuantityChangeLogEntry {
  id: string;
  upc: string;
  delta: number;
  reason: QuantityChangeReason;
  recordedAt: string;
}

interface DuplicateScanPrompt {
  upc: string;
  recordedAt: number;
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
  const [returnCapturedPhoto, setReturnCapturedPhoto] = useState<string | null>(null);
  const [contaminationConfirmed, setContaminationConfirmed] = useState(false);
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
  const [pendingDuplicateScan, setPendingDuplicateScan] = useState<DuplicateScanPrompt | null>(null);
  const [scanEvents, setScanEvents] = useState<ScanEventLogEntry[]>([]);
  const [quantityEvents, setQuantityEvents] = useState<QuantityChangeLogEntry[]>([]);
  const [showScanSummary, setShowScanSummary] = useState(false);
  const [scanSummaryOpen, setScanSummaryOpen] = useState(false);
  const [returnConditionConfirmed, setReturnConditionConfirmed] = useState(false);
  const [showPayoutChoice, setShowPayoutChoice] = useState(false);

  const [isCapturing, setIsCapturing] = useState(false);
  const [paymentCaptured, setPaymentCaptured] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [issueExplanation, setIssueExplanation] = useState<string | null>(null);
  const [issueStatus, setIssueStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [driverNotice, setDriverNotice] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const eligibilityCacheRef = useRef<Record<string, boolean>>({});
  const lastScanRef = useRef<{ upc: string; at: number } | null>(null);
  const verifiedReturnUpcsRef = useRef<ReturnUpcCount[]>([]);
  const scanSessionIdRef = useRef<string>('');
  const scanSessionStartedAtRef = useRef<string>('');

  const countUpcs = (entries: ReturnUpcCount[]) =>
    entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

  const handleAccept = (orderId: string) => {
    if (!orderId) return;
    const driverId = currentUser?.username || currentUser?.id || 'DRIVER';
    updateOrder(orderId, OrderStatus.ASSIGNED, { driverId });
  };

  const handlePickUp = (orderId: string) => {
    if (!orderId) return;
    updateOrder(orderId, OrderStatus.PICKED_UP);
  };

  const handleStartNavigation = (orderId: string) => {
    if (!orderId) return;
    setIsNavigating(true);
    updateOrder(orderId, OrderStatus.ARRIVING);
    setTimeout(() => {
      setIsNavigating(false);
      alert('Navigation: You have arrived at the delivery address.');
    }, 5000);
  };

  const handleCancel = (orderId: string) => {
    if (!orderId) return;
    updateOrder(orderId, OrderStatus.CLOSED);
  };

  const resetPhotoState = () => {
    setCapturedPhoto(null);
    setAiCondition(null);
    setAiConditionStatus('idle');
  };

  const resetReturnPhotoState = () => {
    setReturnCapturedPhoto(null);
    setContaminationConfirmed(false);
  };

  const isReturnOnlyOrder = (order?: Order | null) => {
    if (!order) return false;
    const count = countUpcs(order.returnUpcCounts ?? []);
    return (order.items?.length ?? 0) === 0 && count > 0;
  };

  const getExpectedReturnCount = (order?: Order | null) => {
    if (!order) return 0;
    const counted = countUpcs(order.returnUpcCounts ?? []);
    if (counted > 0) return counted;
    if (Array.isArray(order.returnUpcs)) return order.returnUpcs.length;
    return 0;
  };

  const formatConfidence = (value?: number) => {
    if (value === undefined || value === null) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const percent = numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric);
    return `${percent}%`;
  };

  const startVerification = async (order: Order) => {
    setActiveOrder(order);
    resetPhotoState();
    resetReturnPhotoState();
    const initialEntries = order.verifiedReturnUpcCounts ?? order.returnUpcCounts ?? [];
    setVerifiedReturnUpcs(Array.isArray(initialEntries) ? initialEntries : []);
    setScanEvents([]);
    setQuantityEvents([]);
    setPendingDuplicateScan(null);
    setShowScanSummary(false);
    setScanSummaryOpen(false);
    setReturnConditionConfirmed(false);
    setShowPayoutChoice(false);
    scanSessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    scanSessionStartedAtRef.current = new Date().toISOString();
    setManualUpc('');
    setScannerOpen(false);
    setScannerError(null);
    setCaptureError(null);
    setIssueExplanation(null);
    setIssueStatus('idle');
    setDriverNotice(null);

    setPaymentCaptured(order.status === OrderStatus.PAID || isReturnOnlyOrder(order));

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch {
      setDriverNotice({
        tone: 'error',
        message: 'Camera access is required for delivery and return photos.'
      });
    }
  };

  const captureFromVideo = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg');
  };

  const takeDeliveryPhoto = async () => {
    const dataUrl = captureFromVideo();
    if (!dataUrl) return;
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

  const takeReturnPhoto = () => {
    const dataUrl = captureFromVideo();
    if (!dataUrl) return;
    setReturnCapturedPhoto(dataUrl);
    setContaminationConfirmed(false);
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

  const logScanEvent = (entry: Omit<ScanEventLogEntry, 'id' | 'recordedAt'>) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setScanEvents(prev => [
      ...prev,
      { id, recordedAt: new Date().toISOString(), ...entry }
    ]);
  };

  const logQuantityChange = (
    entry: Omit<QuantityChangeLogEntry, 'id' | 'recordedAt'>
  ) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `qty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setQuantityEvents(prev => [
      ...prev,
      { id, recordedAt: new Date().toISOString(), ...entry }
    ]);
  };

  const addEligibleUpc = (upc: string, reason: QuantityChangeReason = 'scan_add') => {
    let didAdd = false;
    setVerifiedReturnUpcs(prev => {
      if (prev.some(entry => entry.upc === upc)) return prev;
      didAdd = true;
      return [{ upc, quantity: 1 }, ...prev];
    });

    if (didAdd) {
      setScannerError(null);
      setManualUpc('');
      logQuantityChange({ upc, delta: 1, reason });
      playScannerTone(980, 120, 0.2);
    } else {
      playScannerTone(220, 240, 0.25);
      setScannerError('This container may already be counted.');
    }
  };

  const incrementUpc = (upc: string, reason: QuantityChangeReason = 'manual_increment') => {
    let didIncrement = false;
    setVerifiedReturnUpcs(prev =>
      prev.map(entry => {
        if (entry.upc !== upc) return entry;
        didIncrement = true;
        return { ...entry, quantity: entry.quantity + 1 };
      })
    );
    if (didIncrement) {
      logQuantityChange({ upc, delta: 1, reason });
    }
  };

  const decrementUpc = (upc: string, reason: QuantityChangeReason = 'manual_decrement') => {
    let didDecrement = false;
    setVerifiedReturnUpcs(prev =>
      prev
        .map(entry => {
          if (entry.upc !== upc) return entry;
          const nextQuantity = Math.max(0, entry.quantity - 1);
          if (nextQuantity !== entry.quantity) {
            didDecrement = true;
          }
          return { ...entry, quantity: nextQuantity };
        })
        .filter(entry => entry.quantity > 0)
    );
    if (didDecrement) {
      logQuantityChange({ upc, delta: -1, reason });
    }
  };

  const addUpc = async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    if (pendingDuplicateScan && pendingDuplicateScan.upc !== upc) {
      setPendingDuplicateScan(null);
    }

    if (source === 'scanner') {
      const now = Date.now();
      const lastScan = lastScanRef.current;
      const alreadyVerified = verifiedReturnUpcsRef.current.some(entry => entry.upc === upc);
      if (
        alreadyVerified &&
        lastScan?.upc === upc &&
        now - lastScan.at < 4000
      ) {
        setPendingDuplicateScan({ upc, recordedAt: now });
        setScannerError(null);
        playScannerTone(440, 120, 0.2);
        logScanEvent({ upc, source, status: 'duplicate_prompt' });
        lastScanRef.current = { upc, at: now };
        return;
      }

      if (lastScan && now - lastScan.at < 1200) {
        playScannerTone(220, 240, 0.25);
        setScannerError('Scan paused. Wait a moment or tap + to increment.');
        logScanEvent({ upc, source, status: 'cooldown_blocked' });
        return;
      }
      lastScanRef.current = { upc, at: now };
      logScanEvent({ upc, source, status: 'detected' });
    }

    if (!/^\d{8,14}$/.test(upc)) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      if (source === 'scanner') {
        logScanEvent({ upc, source, status: 'invalid_format' });
      }
      return;
    }

    const cached = eligibilityCacheRef.current[upc];
    if (cached !== undefined) {
      if (!cached) {
        playScannerTone(220, 240, 0.25);
        setScannerError("This container isn't eligible for return value.");
        if (source === 'scanner') {
          logScanEvent({ upc, source, status: 'ineligible' });
        }
        return;
      }

      addEligibleUpc(upc, source === 'manual' ? 'manual_add' : 'scan_add');
      if (source === 'scanner') {
        logScanEvent({ upc, source, status: 'eligible' });
      }
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
          setScannerError("This container isn't eligible for return value.");
          if (source === 'scanner') {
            logScanEvent({ upc, source, status: 'ineligible' });
          }
          return;
        }
        addEligibleUpc(upc, source === 'manual' ? 'manual_add' : 'scan_add');
        if (source === 'scanner') {
          logScanEvent({ upc, source, status: 'eligible' });
        }
        return;
      }

      if (response.status === 404) {
        updateEligibilityCache(upc, false);
        playScannerTone(220, 240, 0.25);
        setScannerError("This container isn't eligible for return value.");
        if (source === 'scanner') {
          logScanEvent({ upc, source, status: 'ineligible' });
        }
        return;
      }

      throw new Error(`Eligibility check failed: ${response.status}`);
    } catch {
      playScannerTone(220, 240, 0.25);
      setScannerError('Unable to validate UPC eligibility. Please try again.');
    }
  };

  const confirmDuplicateScan = () => {
    if (!pendingDuplicateScan) return;
    incrementUpc(pendingDuplicateScan.upc, 'scan_confirm');
    playScannerTone(980, 120, 0.2);
    logScanEvent({
      upc: pendingDuplicateScan.upc,
      source: 'scanner',
      status: 'added_existing'
    });
    setPendingDuplicateScan(null);
  };

  const removeUpc = (upc: string) => {
    setVerifiedReturnUpcs(prev => prev.filter(entry => entry.upc !== upc));
  };

  const clearUpcs = () => {
    setVerifiedReturnUpcs([]);
    setScannerError(null);
    setPendingDuplicateScan(null);
  };

  const sendScanSessionMetadata = async (stage: 'pre_capture' | 'post_capture') => {
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

    setIsCapturing(true);
    setCaptureError(null);
    setIssueExplanation(null);
    setIssueStatus('idle');
    setDriverNotice(null);
    await sendScanSessionMetadata('pre_capture');
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
      await sendScanSessionMetadata('post_capture');

      const capturedOrder = data?.order;
      const verifiedReturnCredit = Number(capturedOrder?.verifiedReturnCredit || 0);

      updateOrder(activeOrder.id, OrderStatus.PAID, {
        verifiedReturnCredit,
        verifiedReturnUpcs: capturedOrder?.verifiedReturnUpcs || [],
        verifiedReturnUpcCounts: capturedOrder?.verifiedReturnUpcCounts || verifiedReturnUpcs,
        paidAt: new Date().toISOString()
      });

      setDriverNotice({ tone: 'success', message: 'Payment captured successfully.' });
    } catch (e: any) {
      const message = e?.message || 'Payment capture failed.';
      setCaptureError(message);
      setDriverNotice({ tone: 'error', message });
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
      setDriverNotice({
        tone: 'error',
        message: 'Capture payment first (verify returns), then complete delivery.'
      });
      return;
    }

    const expectedReturnCount = getExpectedReturnCount(activeOrder);
    const requiresReturnPhoto = expectedReturnCount > 0 || verifiedReturnCount > 0;
    const returnAiAnalysis = activeOrder?.returnAiAnalysis;
    const contaminationFlagged =
      returnAiAnalysis?.flags?.some(flag => flag.toLowerCase().includes('contamin')) ?? false;

    if (requiresReturnPhoto && !returnCapturedPhoto) {
      setDriverNotice({
        tone: 'error',
        message: 'Capture a return photo before completing delivery.'
      });
      return;
    }

    if (contaminationFlagged && !contaminationConfirmed) {
      setDriverNotice({
        tone: 'error',
        message: 'Confirm contamination review before completing delivery.'
      });
      return;
    }

    if (!capturedPhoto) {
      setDriverNotice({
        tone: 'error',
        message: 'Capture a delivery proof photo before completing delivery.'
      });
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

    const uploadReturnPhoto = async () => {
      if (!returnCapturedPhoto) return null;

      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;

      if (cloudName && uploadPreset) {
        const imageBlob = await fetch(returnCapturedPhoto).then(res => res.blob());
        const formData = new FormData();
        formData.append('file', imageBlob, `return-${activeOrder.id}.jpg`);
        formData.append('upload_preset', uploadPreset);
        formData.append('folder', 'return-photos');
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
          throw new Error(uploadData?.error?.message || 'Return photo upload failed.');
        }
        return uploadData?.secure_url || uploadData?.url || null;
      }

      const res = await fetch(`${BACKEND_URL}/api/uploads/return-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: activeOrder.id,
          imageData: returnCapturedPhoto
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Return photo upload failed.');
      }
      return data?.url || null;
    };

    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const proofUrl = await uploadProof();
          const returnPhotoUrl = await uploadReturnPhoto();
          const metadata = {
            deliveredAt: new Date().toISOString(),
            gpsCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            verificationPhoto: proofUrl || undefined,
            returnPhoto: returnPhotoUrl || undefined,
            ...(isReturnOnlyOrder(activeOrder)
              ? { verifiedReturnUpcCounts: verifiedReturnUpcs }
              : {})
          };

          updateOrder(activeOrder.id, OrderStatus.DELIVERED, metadata);

          setIsVerifying(false);
          setActiveOrder(null);
          resetPhotoState();
          resetReturnPhotoState();
          setVerifiedReturnUpcs([]);
          setManualUpc('');
          setScannerOpen(false);
          setScannerError(null);
          setPendingDuplicateScan(null);
          setScanEvents([]);
          setQuantityEvents([]);
          setShowScanSummary(false);
          setScanSummaryOpen(false);
          setPaymentCaptured(false);
          setDriverNotice({ tone: 'success', message: 'Delivery completed and proof uploaded.' });
        } catch (e: any) {
          setDriverNotice({
            tone: 'error',
            message: e?.message || 'Delivery proof upload failed.'
          });
          setIsVerifying(false);
        }
      },
      () => {
        setDriverNotice({ tone: 'error', message: 'GPS is required to complete delivery.' });
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
    setPendingDuplicateScan(null);
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
    verifiedReturnUpcsRef.current = verifiedReturnUpcs;
  }, [verifiedReturnUpcs]);

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
  const expectedReturnCount = getExpectedReturnCount(activeOrder);
  const requiresReturnPhoto = expectedReturnCount > 0 || verifiedReturnCount > 0;
  const returnAiAnalysis = activeOrder?.returnAiAnalysis;
  const contaminationFlagged =
    returnAiAnalysis?.flags?.some(flag => flag.toLowerCase().includes('contamin')) ?? false;
  const isCompletionBlocked =
    !capturedPhoto ||
    isVerifying ||
    (requiresReturnPhoto && !returnCapturedPhoto) ||
    (contaminationFlagged && !contaminationConfirmed);
  const completionTitle = !paymentCaptured && !isReturnOnly
    ? 'Capture payment first'
    : contaminationFlagged && !contaminationConfirmed
      ? 'Confirm contamination review'
      : requiresReturnPhoto && !returnCapturedPhoto
        ? 'Capture return photo first'
        : !capturedPhoto
          ? 'Capture delivery proof first'
          : 'Complete delivery';

  const handleCapturePaymentClick = () => {
    if (showScanSummary) {
      setScanSummaryOpen(true);
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
              onClick={() => setShowPayoutChoice(false)}
            />
            <div className="relative w-full max-w-xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-black uppercase tracking-widest text-sm">
                    Choose How to Use Your Return Value
                  </p>
                </div>
                <button
                  onClick={() => setShowPayoutChoice(false)}
                  className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-5 space-y-3 text-[11px] uppercase tracking-widest text-slate-300">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Apply to This Order</p>
                  <p>Use your verified return value to reduce today’s total.</p>
                  <p>Silver+ can apply credits to delivery fees; Common/Bronze apply to products.</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Save as Credits</p>
                  <p>Store your return value for future orders.</p>
                  <p>Credits never expire and post after eligibility is confirmed.</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                  <p className="text-white font-black">Cash</p>
                  <p>Receive cash for your verified returns.</p>
                  <p>Gold+ only; capped at $25/day (250 containers).</p>
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

              {pendingDuplicateScan && (
                <div className="mt-4 text-[11px] text-white bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                  <span>Same UPC detected again. Add another?</span>
                  <button
                    onClick={confirmDuplicateScan}
                    className="px-4 py-2 rounded-xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                  >
                    Add another?
                  </button>
                </div>
              )}

              <p className="mt-4 text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                Tip: If scanning fails, close this and use manual UPC entry below.
              </p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-[10px] uppercase tracking-widest text-slate-400 space-y-2">
                <p className="text-slate-300">Valid returns</p>
                <p>Empty, clean containers with MI 10¢ deposit label and eligible UPCs.</p>
                <p className="text-slate-300">Proof requirements</p>
                <p>Return photo + delivery proof photo required before completion.</p>
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
                      Est. return credit:{' '}
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

              <p className="uppercase tracking-widest opacity-60 mt-4">Estimated return credit (preview)</p>
              <p className="font-black text-ninpo-lime">{money(activeOrder.estimatedReturnCredit || 0)}</p>

              <p className="uppercase tracking-widest opacity-60 mt-4">Delivery fee</p>
              <p className="font-black">{money(activeOrder.deliveryFee || 0)}</p>

              {driverNotice && (
                <div
                  className={`mt-4 rounded-2xl border px-4 py-3 text-[11px] uppercase tracking-widest flex items-start justify-between gap-3 ${
                    driverNotice.tone === 'success'
                      ? 'border-ninpo-lime/40 bg-ninpo-lime/10 text-ninpo-lime'
                      : driverNotice.tone === 'info'
                        ? 'border-white/10 bg-white/5 text-slate-200'
                        : 'border-ninpo-red/30 bg-ninpo-red/10 text-ninpo-red'
                  }`}
                >
                  <span>{driverNotice.message}</span>
                  <button
                    onClick={() => setDriverNotice(null)}
                    className="text-[10px] font-black uppercase tracking-widest opacity-70 hover:opacity-100"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div>
                <p className="uppercase tracking-widest opacity-60">Verify Container Returns</p>
                <p className="text-[10px] uppercase tracking-widest text-slate-600 mt-2">
                  Scan eligible Michigan 10¢ deposit containers. Containers must be empty and clean.
                </p>
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

                  {pendingDuplicateScan && (
                    <div className="text-[11px] text-white bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
                      <span>This container may already be counted. Add another?</span>
                      <button
                        onClick={confirmDuplicateScan}
                        className="px-4 py-2 rounded-xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                      >
                        Add another?
                      </button>
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[10px] uppercase tracking-widest text-slate-400 space-y-2">
                    <p className="text-slate-300">Quantity helper</p>
                    <p>Multiple of the same container are allowed.</p>
                    <p>Do not scan the same container more than once.</p>
                  </div>

                  <label className="flex items-start gap-3 text-[10px] uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      checked={returnConditionConfirmed}
                      onChange={event => setReturnConditionConfirmed(event.target.checked)}
                      className="mt-1 accent-ninpo-lime"
                    />
                    I confirm these containers are empty and clean.
                  </label>

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
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black tracking-widest text-white">
                                {entry.upc}
                              </span>
                              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                                Verified return UPC
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                              Qty × {entry.quantity}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => decrementUpc(entry.upc, 'manual_decrement')}
                              className="text-white text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-white/5 border border-white/10"
                            >
                              -
                            </button>
                            <button
                              onClick={() => incrementUpc(entry.upc, 'manual_increment')}
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

                  {verifiedReturnCount > 0 && (
                    <button
                      onClick={() => setShowPayoutChoice(true)}
                      className="mt-2 w-full px-4 py-3 rounded-xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Choose return value payout
                    </button>
                  )}
                </div>
              </div>

              {!isReturnOnly && (
                <>
                  <button
                    onClick={handleCapturePaymentClick}
                    disabled={isCapturing || paymentCaptured}
                    className="w-full px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                    title="Captures (charges) the final amount after verified return credit"
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

                  <label className="mt-3 flex items-center gap-3 text-[10px] uppercase tracking-widest text-slate-500">
                    <input
                      type="checkbox"
                      checked={showScanSummary}
                      onChange={event => setShowScanSummary(event.target.checked)}
                      className="accent-ninpo-lime"
                    />
                    Review scan session before capture
                  </label>

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

                  {scanSummaryOpen && typeof document !== 'undefined' &&
                    createPortal(
                      <div className="fixed inset-0 z-[12000] flex items-center justify-center p-6">
                        <div
                          className="absolute inset-0 bg-black/80 backdrop-blur-md"
                          onClick={() => setScanSummaryOpen(false)}
                        />
                        <div className="relative w-full max-w-2xl bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-white font-black uppercase tracking-widest text-sm">
                                Scan Session Summary
                              </p>
                              <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                                Review scanned UPCs and quantity adjustments before capture.
                              </p>
                            </div>
                            <button
                              onClick={() => setScanSummaryOpen(false)}
                              className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="mt-5 grid gap-4 text-[10px] uppercase tracking-widest text-slate-500">
                            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                              <span>Total scan events</span>
                              <span className="text-white">{scanEvents.length}</span>
                            </div>
                            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                              <span>Quantity adjustments</span>
                              <span className="text-white">{quantityEvents.length}</span>
                            </div>
                            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                              <span>Verified UPC total</span>
                              <span className="text-white">{verifiedReturnCount}</span>
                            </div>
                          </div>

                          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Scan events
                              </p>
                              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1">
                                {scanEvents.length > 0 ? (
                                  scanEvents.map(event => (
                                    <div
                                      key={event.id}
                                      className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-white"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-black">{event.upc}</span>
                                        <span className="text-[9px] text-slate-400 uppercase tracking-widest">
                                          {event.status.replace('_', ' ')}
                                        </span>
                                      </div>
                                      <p className="text-[9px] text-slate-500 uppercase tracking-widest mt-1">
                                        {event.source} • {new Date(event.recordedAt).toLocaleTimeString()}
                                      </p>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                    No scan events recorded.
                                  </p>
                                )}
                              </div>
                            </div>

                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Quantity adjustments
                              </p>
                              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto pr-1">
                                {quantityEvents.length > 0 ? (
                                  quantityEvents.map(event => (
                                    <div
                                      key={event.id}
                                      className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-white"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="font-black">{event.upc}</span>
                                        <span className="text-[9px] text-slate-400 uppercase tracking-widest">
                                          {event.delta > 0 ? '+' : ''}
                                          {event.delta}
                                        </span>
                                      </div>
                                      <p className="text-[9px] text-slate-500 uppercase tracking-widest mt-1">
                                        {event.reason.replace('_', ' ')} •{' '}
                                        {new Date(event.recordedAt).toLocaleTimeString()}
                                      </p>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                    No quantity adjustments recorded.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="mt-6 flex items-center justify-between gap-3">
                            <button
                              onClick={() => setScanSummaryOpen(false)}
                              className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                            >
                              Keep scanning
                            </button>
                            <button
                              onClick={() => {
                                setScanSummaryOpen(false);
                                capturePayment();
                              }}
                              className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                            >
                              Proceed to capture
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                </>
              )}
              {isReturnOnly && (
                <p className="mt-2 text-[10px] uppercase tracking-widest opacity-60">
                  Return-only pickup: no payment capture required.
                </p>
              )}
            </div>

            <div className="bg-black/30 border border-white/10 rounded-2xl p-5 text-xs space-y-2">
              <p className="uppercase tracking-widest opacity-60">Delivery & Return Proof Required</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-600">
                Take a clear photo showing the completed delivery. This helps confirm returns and
                complete payment.
              </p>
              <p className="text-[10px] uppercase tracking-widest text-slate-600">
                Location verification is required to complete delivery.
              </p>
            </div>

            {requiresReturnPhoto && (
              <div className="space-y-4">
                <div className="bg-black/30 border border-white/10 rounded-2xl p-5 text-xs space-y-2">
                  <p className="uppercase tracking-widest opacity-60">Return photo (required)</p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-600">
                    Use the live camera preview below to capture the return photo.
                  </p>
                  {returnAiAnalysis && (
                    <div className="mt-3 space-y-2 text-[11px] text-slate-200">
                      <p className="uppercase tracking-widest text-slate-400">
                        Return AI advisory (server)
                      </p>
                      {returnAiAnalysis.summary && (
                        <p className="text-slate-200">{returnAiAnalysis.summary}</p>
                      )}
                      {formatConfidence(returnAiAnalysis.confidence) && (
                        <p className="text-slate-400 uppercase tracking-widest">
                          Confidence:{' '}
                          <span className="text-white">
                            {formatConfidence(returnAiAnalysis.confidence)}
                          </span>
                        </p>
                      )}
                      {returnAiAnalysis.flags && returnAiAnalysis.flags.length > 0 && (
                        <div className="text-[11px] text-slate-300">
                          <p className="uppercase tracking-widest text-slate-400">Flags</p>
                          <ul className="list-disc list-inside">
                            {returnAiAnalysis.flags.map(flag => (
                              <li key={flag}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {contaminationFlagged && (
                    <div className="mt-3 bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4 space-y-2">
                      <p className="text-[11px] text-ninpo-red font-bold uppercase tracking-widest">
                        Contamination flagged
                      </p>
                      <label className="flex items-start gap-3 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={contaminationConfirmed}
                          onChange={e => setContaminationConfirmed(e.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          I inspected the returns and confirm they are safe to process.
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="relative aspect-video rounded-3xl overflow-hidden bg-ninpo-black">
                  {returnCapturedPhoto ? (
                    <img
                      src={returnCapturedPhoto}
                      className="w-full h-full object-cover"
                      alt="Return photo"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] uppercase tracking-widest text-slate-600">
                      No return photo captured yet.
                    </div>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={takeReturnPhoto}
                    className="flex-1 py-4 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> Capture Return Photo
                  </button>

                  {returnCapturedPhoto && (
                    <button
                      onClick={resetReturnPhotoState}
                      className="px-6 py-4 bg-ninpo-red/10 text-ninpo-red rounded-xl text-[10px] font-black uppercase"
                    >
                      Retake
                    </button>
                  )}
                </div>
              </div>
            )}

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
                onClick={takeDeliveryPhoto}
                className="flex-1 py-4 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Capture Delivery Proof
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
              disabled={isCompletionBlocked}
              onClick={completeDelivery}
              className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-neon flex items-center justify-center gap-4 transition-all disabled:opacity-50"
              title={completionTitle}
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
                Capture payment after verifying container returns, then complete delivery.
              </p>
            )}
            {isReturnOnly && (
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                Return-only pickup: verify UPCs, capture proof, then complete delivery.
              </p>
            )}
          </div>
        )}
        {payoutChoiceModal}
        {scannerModal}
      </div>
    </div>
  );
};

export default DriverView;
