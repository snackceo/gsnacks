import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  ScanLine,
  Camera,
  RefreshCw,
  Flashlight,
  FlashlightOff,
  ChevronUp,
  ChevronDown,
  Zap,
  Receipt
} from 'lucide-react';
// See GLOSSARY.md for authoritative definitions of all scanner modes.
import { ScannerMode } from '../types';

interface ParsedReceiptItem {
  receiptName: string;
  quantity: number;
  totalPrice: number;
}

interface ScannerPanelProps {
  mode?: ScannerMode;
  onScan: (upc: string) => void;
  onCooldown?: (upc: string, reason: 'cooldown' | 'duplicate') => void;
  title: string;
  subtitle: string;
  beepEnabled?: boolean;
  cooldownMs?: number;
  onPhotoCaptured?: (photoDataUrl: string, mime: string) => void;
  onReceiptParsed?: (items: ParsedReceiptItem[], frame?: string) => void;
  onModeChange?: (mode: ScannerMode) => void;
  receiptHeaderContent?: React.ReactNode;
  receiptSaveDisabled?: boolean;
  receiptSaveDisabledReason?: string;
  closeOnScan?: boolean;
  manualStart?: boolean;
  onClose?: () => void;
  showClose?: boolean;
  className?: string;
  bottomSheetContent?: React.ReactNode;
}

// Allow UPC/EAN lengths commonly encountered.
// - UPC-A: 12
// - UPC-E: 8
// - EAN-13: 13
// - Some systems store leading/trailing zeros (14)
const MIN_LEN = 8;
const MAX_LEN = 14;

const normalizeUpc = (raw: string) => raw.replace(/\D/g, '');

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const ScannerPanel: React.FC<ScannerPanelProps> = ({
  mode,
  onScan,
  onCooldown,
  onClose,
  showClose = false,
  title,
  subtitle,
  beepEnabled = true,
  cooldownMs = 1200,
  onPhotoCaptured,
  onReceiptParsed,
  onModeChange,
  receiptHeaderContent,
  receiptSaveDisabled = false,
  receiptSaveDisabledReason,
  closeOnScan = false,
  manualStart = false,
  className = '',
  bottomSheetContent
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const lastAutoOpenUpcRef = useRef<string | null>(null);

  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const inFlightRef = useRef<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const onScanRef = useRef<ScannerPanelProps['onScan']>(onScan);
  const onCloseRef = useRef<ScannerPanelProps['onClose']>(onClose);
  const onCooldownRef = useRef<ScannerPanelProps['onCooldown']>(undefined);
  const closeOnScanRef = useRef<boolean>(closeOnScan);
  const beepEnabledRef = useRef<boolean>(beepEnabled);
  const cooldownMsRef = useRef<number>(cooldownMs);

  // Cooldown + stability guards
  const lastAcceptAtRef = useRef<number>(0);
  const lastAcceptedCodeRef = useRef<string | null>(null);
  const lastSeenCodeRef = useRef<string | null>(null);
  const stableFramesRef = useRef<number>(0);

  // Throttle detector calls
  const lastDetectAtRef = useRef<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [manualUpc, setManualUpc] = useState('');
  const [lastDetectedUpc, setLastDetectedUpc] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedReceiptItem[]>([]);
  const [lastParsedFrame, setLastParsedFrame] = useState<string | null>(null);

  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);

  const isReceiptMode = mode === ScannerMode.RECEIPT_PARSE_LIVE;

  useEffect(() => {
    torchOnRef.current = torchOn;
  }, [torchOn]);

  const canCapturePhoto = Boolean(onPhotoCaptured);
  const receiptUploadBlocked = isReceiptMode && receiptSaveDisabled;

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
    onCooldownRef.current = onCooldown;
    closeOnScanRef.current = closeOnScan;
    beepEnabledRef.current = beepEnabled;
    cooldownMsRef.current = cooldownMs;
  }, [beepEnabled, closeOnScan, cooldownMs, onClose, onCooldown, onScan]);

  const playBeep = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const context = audioContextRef.current;
      if (context.state === 'suspended') void context.resume();

      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.frequency.value = 980;
      gainNode.gain.value = 0.12;

      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    } catch {
      // ignore audio failures
    }
  }, []);

  const acceptScan = useCallback(
    (upc: string) => {
      const now = Date.now();
      const cooldownMsValue = cooldownMsRef.current;

      // Global cooldown
      if (now - lastAcceptAtRef.current < cooldownMsValue) {
        onCooldownRef.current?.(upc, 'cooldown');
        return;
      }

      // Prevent immediately re-accepting the exact same code even if timing jitter occurs
      if (lastAcceptedCodeRef.current === upc && now - lastAcceptAtRef.current < Math.max(600, cooldownMsValue)) {
        onCooldownRef.current?.(upc, 'duplicate');
        return;
      }

      lastAcceptAtRef.current = now;
      lastAcceptedCodeRef.current = upc;

      setLastDetectedUpc(upc);
      lastAutoOpenUpcRef.current = upc;
      setIsSheetOpen(true);
      if (beepEnabledRef.current) playBeep();
      onScanRef.current(upc);

      if (closeOnScanRef.current && onCloseRef.current) {
        onCloseRef.current();
      }
    },
    [playBeep]
  );

  const stopScanner = useCallback(async () => {
    cancelledRef.current = true;
    setIsScanning(false);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Reset stability state
    lastSeenCodeRef.current = null;
    stableFramesRef.current = 0;
    inFlightRef.current = false;

    // Turn off torch if it was on
    try {
      if (videoTrackRef.current && torchOnRef.current) {
        await videoTrackRef.current.applyConstraints({ advanced: [{ torch: false } as any] });
      }
    } catch {
      // ignore torch failures
    }
    setTorchOn(false); // Always reset torch state

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => t.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }

    videoTrackRef.current = null;
    setTorchSupported(false);

    if (videoRef.current) {
      try {
        (videoRef.current as any).srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!torchSupported) {
      setScannerError('Torch not supported on this device.');
      return;
    }
    if (!videoTrackRef.current) return;

    const next = !torchOnRef.current;
    try {
      await videoTrackRef.current.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch (err) {
      setScannerError('Failed to toggle torch. Your device or browser may not support this feature.');
      // Do not restart or stop the camera, just show error
    }
  }, [torchSupported]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !onPhotoCaptured) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = videoRef.current.videoWidth;
    const h = videoRef.current.videoHeight;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(videoRef.current, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onPhotoCaptured(dataUrl, 'image/jpeg');
  }, [onPhotoCaptured]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const canvas = canvasRef.current || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const w = videoRef.current.videoWidth;
    const h = videoRef.current.videoHeight;
    if (!w || !h) return null;

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(videoRef.current, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const handleParseOnce = useCallback(async () => {
    const frame = captureFrame();
    if (!frame) {
      setScannerHint('Point camera at the receipt then tap Analyze again.');
      return;
    }
    setIsParsing(true);
    setScannerHint('Analyzing...');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image: frame })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setScannerHint(err.error || 'Analysis failed');
        return;
      }

      const data = await resp.json();
      const items: ParsedReceiptItem[] = Array.isArray(data.items) ? data.items : [];
      setParsedItems(items);
      setLastParsedFrame(frame);
      if (items.length > 0) {
        setScannerHint(`Captured ${items.length} items`);
      } else {
        setScannerHint('No items detected');
      }
    } catch (err: any) {
      setScannerHint(err.message || 'Analysis error');
    } finally {
      setIsParsing(false);
    }
  }, [captureFrame, onReceiptParsed]);

  const validateUpc = useCallback((raw: string) => {
    const normalized = normalizeUpc(String(raw || '').trim());
    if (!normalized) return { ok: false as const, upc: '' };
    if (normalized.length < MIN_LEN || normalized.length > MAX_LEN) return { ok: false as const, upc: '' };
    return { ok: true as const, upc: normalized };
  }, []);

  const startScanner = useCallback(async () => {
    await stopScanner();
    setTorchOn(false); // Always reset torch state on start
    cancelledRef.current = false;
    setBlocked(false);
    setScannerError(null);
    setScannerHint(null);

    if (typeof window === 'undefined') {
      setScannerError('Scanner unavailable.');
      return;
    }

    if (!('BarcodeDetector' in window)) {
      setScannerError('Scanner not supported.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (cancelledRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      videoTrackRef.current = track;

      const caps = track.getCapabilities?.();
      setTorchSupported(Boolean((caps as any)?.torch));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
          setIsScanning(true);
        } catch {
          setScannerError('Camera failed to start. Tap Retry.');
          setScannerHint('On mobile Chrome, tap once to grant permission or retry after allowing camera access.');
          setIsScanning(false);
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          videoTrackRef.current = null;
          return;
        }
      } else {
        setScannerError('Camera failed to start. Tap Retry.');
        setScannerHint('On mobile Chrome, tap once to grant permission or retry after allowing camera access.');
        setIsScanning(false);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        videoTrackRef.current = null;
        return;
      }

      // Barcode detection mode
      const detector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
      });

      // Tuning knobs
      const DETECT_MIN_INTERVAL_MS = 90; // throttle detector calls
      const REQUIRED_STABLE_FRAMES = 3; // stability requirement

      const loop = async () => {
        if (cancelledRef.current) return;
        if (!videoRef.current) return;

        const now = performance.now();

        // throttle detector calls
        if (now - lastDetectAtRef.current < DETECT_MIN_INTERVAL_MS) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        lastDetectAtRef.current = now;

        // prevent overlapping detector.detect calls
        if (inFlightRef.current) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        // don’t detect until video is actually ready
        if (videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        inFlightRef.current = true;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (cancelledRef.current) return;

          if (!barcodes || barcodes.length === 0) {
            lastSeenCodeRef.current = null;
            stableFramesRef.current = 0;
            return;
          }

          const rawValue = String(barcodes[0]?.rawValue || '');
          const { ok, upc } = validateUpc(rawValue);
          if (!ok) return;

          // stability confirm (same code across frames)
          if (lastSeenCodeRef.current === upc) {
            stableFramesRef.current += 1;
          } else {
            lastSeenCodeRef.current = upc;
            stableFramesRef.current = 1;
          }

          if (stableFramesRef.current >= REQUIRED_STABLE_FRAMES) {
            // reset stability so it doesn't keep re-firing
            lastSeenCodeRef.current = null;
            stableFramesRef.current = 0;

            acceptScan(upc);
          }
        } catch {
          // ignore detection errors
        } finally {
          inFlightRef.current = false;
          if (!cancelledRef.current) {
            rafRef.current = requestAnimationFrame(loop);
          }
        }
      };

      rafRef.current = requestAnimationFrame(loop);
    } catch {
      setScannerError('Camera blocked. Enable permissions.');
      setIsScanning(false);
      setBlocked(true);
    }
  }, [acceptScan, stopScanner, validateUpc]);

  const handleManualScan = useCallback(() => {
    const { ok, upc } = validateUpc(manualUpc);
    if (!ok) return;

    acceptScan(upc);
    setManualUpc('');
  }, [acceptScan, manualUpc, validateUpc]);

  const handleToggleSheet = useCallback(() => {
    setIsSheetOpen(prev => !prev);
  }, []);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  useEffect(() => {
    if (!lastDetectedUpc) return;
    if (lastAutoOpenUpcRef.current === lastDetectedUpc) return;
    lastAutoOpenUpcRef.current = lastDetectedUpc;
    setIsSheetOpen(true); // auto-expand on new scan to keep autofill behavior
  }, [lastDetectedUpc]);

  useEffect(() => {
    if (manualStart || blocked) {
      void stopScanner();
      if (manualStart) {
        setScannerError(null);
        setScannerHint(null);
      }
      setIsScanning(false);
      return;
    }

    void startScanner();
  }, [blocked, manualStart, startScanner, stopScanner]);

  return (
    <div className="relative w-full h-full flex flex-col bg-black">
      {/* Full-screen video */}
      <div className="absolute inset-0 flex items-center justify-center">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        
        {!isScanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center px-8 flex flex-col items-center gap-3">
              <Camera className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-black uppercase tracking-widest text-slate-400">
                {scannerError ?? (manualStart ? 'Press Start to begin scanning' : 'Initializing camera...')}
              </p>
              <button
                onClick={() => void startScanner()}
                className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-xs font-black uppercase tracking-widest flex items-center gap-2 mt-4"
              >
                <RefreshCw className="w-4 h-4" /> {manualStart ? 'Start' : 'Retry'}
              </button>
              {scannerError && (
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-2">
                  Enable camera permissions, then retry.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top bar with back and torch */}
      <div className="relative z-10 flex items-center justify-between p-4">
        {showClose && onClose ? (
          <button
            onClick={onClose}
            className="p-3 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-11" />
        )}
        
        {canCapturePhoto && (
          <button
            onClick={receiptUploadBlocked ? undefined : takePhoto}
            disabled={receiptUploadBlocked}
            className={`p-3 rounded-full backdrop-blur-sm transition flex items-center justify-center ${
              receiptUploadBlocked
                ? 'bg-gray-600/70 text-gray-300 cursor-not-allowed'
                : 'bg-cyan-500/90 text-white hover:bg-cyan-600'
            }`}
            title={receiptUploadBlocked ? 'Select a store before uploading' : 'Take photo (backup)'}
          >
            <Zap className="w-5 h-5" />
          </button>
        )}
        
        <button
          onClick={() => void toggleTorch()}
          disabled={!torchSupported}
          className={`p-3 rounded-full backdrop-blur-sm transition flex items-center justify-center ${
            torchSupported
              ? torchOn
                ? 'bg-yellow-400/90 text-black'
                : 'bg-black/60 text-white hover:bg-black/80'
              : 'bg-gray-600/60 text-gray-400 cursor-not-allowed'
          }`}
          title={torchSupported ? (torchOn ? 'Turn off torch' : 'Turn on torch') : 'Torch not supported'}
        >
          {torchOn ? <FlashlightOff className="w-5 h-5" /> : <Flashlight className="w-5 h-5" />}
        </button>
      </div>

      {isReceiptMode && receiptHeaderContent && (
        <div className="relative z-10 px-4">
          <div className="mt-2 rounded-2xl bg-black/70 border border-white/10 p-3 shadow-lg">
            {receiptHeaderContent}
          </div>
        </div>
      )}

      {/* Bottom sheet card with manual expand/collapse handle */}
      {isReceiptMode && parsedItems.length > 0 && (
        <div className="relative z-10 mt-auto mb-24 w-full bg-ninpo-black/95 backdrop-blur-xl border-t border-white/10 shadow-2xl max-h-[50vh] flex flex-col">
          <div className="p-4 border-b border-white/10">
            <div>
              <p className="text-sm font-black uppercase tracking-widest text-white">Receipt Detected</p>
              <p className="text-xs text-slate-400">{parsedItems.length} items found</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {parsedItems.map((item, idx) => (
              <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-sm font-medium text-white">{item.receiptName}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Qty: {item.quantity} × ${(item.totalPrice / item.quantity).toFixed(2)} = ${item.totalPrice.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isReceiptMode && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-4">
          <div className="rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl p-3">
            <div className="flex items-center gap-3">
              <button
                onClick={handleParseOnce}
                disabled={isParsing}
                className={`flex-1 px-4 py-3 rounded-2xl text-white text-xs font-black uppercase tracking-widest transition-all bg-emerald-500/90 hover:bg-emerald-600 ${
                  isParsing ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Receipt className="w-4 h-4" />
                  {isParsing ? 'Analyzing...' : 'Capture/Upload Receipt'}
                </span>
              </button>

              {parsedItems.length > 0 && onReceiptParsed && (
                <button
                  onClick={() => onReceiptParsed(parsedItems, lastParsedFrame ?? undefined)}
                  disabled={receiptSaveDisabled}
                  className={`flex-1 px-4 py-3 rounded-2xl text-white text-xs font-black uppercase tracking-widest transition-all ${
                    receiptSaveDisabled
                      ? 'bg-gray-500/70 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700'
                  }`}
                >
                  Save Items
                </button>
              )}
            </div>
            {parsedItems.length > 0 && receiptSaveDisabled && receiptSaveDisabledReason && (
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                {receiptSaveDisabledReason}
              </p>
            )}
          </div>
        </div>
      )}

      {bottomSheetContent && !isReceiptMode && (
        <div
          className={`relative z-10 mt-auto w-full overflow-hidden rounded-t-[2rem] bg-ninpo-black/95 backdrop-blur-xl border-t border-white/10 shadow-2xl transition-all duration-300 ease-out ${
            isSheetOpen ? 'max-h-[70vh]' : 'max-h-[96px]'
          }`}
        >
          <div className="sticky top-0 bg-ninpo-black/95 backdrop-blur-xl z-10 px-6 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={handleToggleSheet}
                className="flex items-center gap-2 rounded-full px-3 py-2 bg-white/5 border border-white/10 text-white/80 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition"
                aria-expanded={isSheetOpen}
              >
                <span className="h-1 w-10 rounded-full bg-white/30" />
                {isSheetOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                <span>{isSheetOpen ? 'Close' : 'Expand'}</span>
              </button>

              <div className="flex flex-col items-end">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{title}</p>
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">{subtitle}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                <ScanLine className="w-4 h-4 text-ninpo-lime" />
                <span>{lastDetectedUpc ? 'Latest scan' : 'Waiting for scan'}</span>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Scanned</p>
                <p className="text-sm text-ninpo-lime font-black">{lastDetectedUpc ?? '—'}</p>
              </div>
            </div>
          </div>

          {isSheetOpen && (
            <div className="px-6 pb-6 space-y-4 overflow-y-auto max-h-[60vh]">
              {lastDetectedUpc ? (
                bottomSheetContent
              ) : (
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">
                  Waiting for a scan to auto-fill.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Minimal error overlay */}
      {scannerError && (
        <div className="absolute bottom-4 left-4 right-4 z-20 text-xs text-white bg-ninpo-red/90 backdrop-blur-sm rounded-2xl p-4 shadow-lg">
          {scannerError}
        </div>
      )}
    </div>
  );
};

export type { ScannerPanelProps, ParsedReceiptItem };
export default ScannerPanel;
