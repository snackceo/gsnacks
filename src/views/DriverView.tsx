/// <reference types="vite/client" />
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Order, OrderStatus, ReturnUpcCount, User, UserRole, ScannerMode } from '../types';
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
import ScannerModal from '../components/ScannerModal';
import DriverVerificationDelivery from './DriverVerificationDelivery';

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

const UPC_ELIGIBILITY_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

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

  // Return verification state
  const [verificationScans, setVerificationScans] = useState<{ upc: string; timestamp: string }[]>([]);
  const [recognizedCount, setRecognizedCount] = useState(0);
  const [unrecognizedCount, setUnrecognizedCount] = useState(0);
  const [duplicatesCount, setDuplicatesCount] = useState(0);
  const [conditionFlags, setConditionFlags] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const eligibilityCacheRef = useRef<Record<string, { isEligible: boolean; checkedAt: string }>>({});
  const lastScanRef = useRef<{ upc: string; at: number } | null>(null);
  const verifiedReturnUpcsRef = useRef<ReturnUpcCount[]>([]);
  const scanSessionIdRef = useRef<string>('');
  const scanSessionStartedAtRef = useRef<string>('');

  const [driverMode, setDriverMode] = useState<'RETURNS_INTAKE' | 'PICK_PACK'>('RETURNS_INTAKE');
  const [scannerMode, setScannerMode] = useState<ScannerMode>(ScannerMode.DRIVER_VERIFY_CONTAINERS);
  const [workflowMode, setWorkflowMode] = useState<'verification' | 'delivery'>('delivery');

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

  const countUpcs = (entries: ReturnUpcCount[]) => entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

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

  const getInitialVerifiedCounts = (order: Order) => {
    const verified = Array.isArray(order.verifiedReturnUpcCounts)
      ? order.verifiedReturnUpcCounts
      : [];
    if (verified.length > 0) return verified;
    return Array.isArray(order.returnUpcCounts) ? order.returnUpcCounts : [];
  };

  const startVerification = async (order: Order) => {
    setActiveOrder(order);
    resetPhotoState();
    resetReturnPhotoState();
    const initialEntries = getInitialVerifiedCounts(order);
    setVerifiedReturnUpcs(initialEntries);
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
    eligibilityCacheRef.current = { ...eligibilityCacheRef.current, [upc]: { isEligible, checkedAt: new Date().toISOString() } };
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
    if (cached && isEligibilityCacheFresh(cached.checkedAt)) {
      if (!cached.isEligible) {
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

  const addVerificationScan = async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    // Check for duplicates
    const isDuplicate = verificationScans.some(scan => scan.upc === upc);
    if (isDuplicate) {
      setDuplicatesCount(prev => prev + 1);
      playScannerTone(440, 120, 0.2);
      setScannerError('Duplicate scan detected');
      return;
    }

    // Check if UPC is recognized
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(upc)}`
      );
      const isRecognized = response.ok;

      if (isRecognized) {
        setRecognizedCount(prev => prev + 1);
        setScannerError('Recognized container');
        playScannerTone(980, 120, 0.2);
      } else {
        setUnrecognizedCount(prev => prev + 1);
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
      setUnrecognizedCount(prev => prev + 1);
      setScannerError('Unable to verify container');
      playScannerTone(220, 240, 0.25);

      setVerificationScans(prev => [...prev, {
        upc,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleScannerScan = async (upc: string, qty = 1) => {
    if (scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS) {
      await addVerificationScan(upc, 'scanner');
    } else {
      // Original logic for other modes
      for (let i = 0; i < qty; i++) {
        await addUpc(upc, 'scanner');
      }
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

  const submitVerification = async () => {
    if (!activeOrder) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/returns/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: activeOrder.id,
          driverId: currentUser?.username || currentUser?.id || 'DRIVER',
          customerId: activeOrder.customerId,
          scans: verificationScans,
          recognizedCount,
          unrecognizedCount,
          duplicatesCount,
          conditionFlags
        })
      });

      if (!response.ok) {
        throw new Error('Failed to submit verification');
      }

      // Reset verification state
      setVerificationScans([]);
      setRecognizedCount(0);
      setUnrecognizedCount(0);
      setDuplicatesCount(0);
      setConditionFlags([]);
      setScannerError(null);

      setDriverNotice({ tone: 'success', message: 'Verification submitted for review' });
    } catch (error) {
      setDriverNotice({ tone: 'error', message: 'Failed to submit verification' });
    }
  };

  const clearVerification = () => {
    setVerificationScans([]);
    setRecognizedCount(0);
    setUnrecognizedCount(0);
    setDuplicatesCount(0);
    setConditionFlags([]);
    setScannerError(null);
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
          clearUpcs();
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

  useEffect(() => {
    verifiedReturnUpcsRef.current = verifiedReturnUpcs;
  }, [verifiedReturnUpcs]);

  useEffect(() => {
    if (!activeOrder) {
      setScannerOpen(false);
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
          onClick={() => setDriverMode('RETURNS_INTAKE')}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            driverMode === 'RETURNS_INTAKE' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Returns Intake
        </button>
        <button
          onClick={() => setDriverMode('PICK_PACK')}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            driverMode === 'PICK_PACK' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Pick/Pack Orders
        </button>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => setWorkflowMode('delivery')}
          className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
            workflowMode === 'delivery' ? 'bg-ninpo-lime text-ninpo-black' : 'bg-white/5 text-white'
          }`}
        >
          Delivery Workflow
        </button>
        <button
          onClick={() => setWorkflowMode('verification')}
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
              </div>
            </div>
          ))}
        </div>

        {activeOrder && (
          <DriverVerificationDelivery
            activeOrder={activeOrder}
            driverNotice={driverNotice}
            setDriverNotice={setDriverNotice}
            workflowMode={workflowMode}
            setScannerMode={setScannerMode}
            setScannerOpen={setScannerOpen}
            scannerError={scannerError}
            // ...pass all other required props...
          />
        )}
      </div>
    </div>
  );
};

export default DriverView;
