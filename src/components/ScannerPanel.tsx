import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  ScanLine,
  Camera,
  Volume2,
  RefreshCw,
  Flashlight,
  FlashlightOff
} from 'lucide-react';
// See GLOSSARY.md for authoritative definitions of all scanner modes.
import { ScannerMode } from '../types';

interface ScannerPanelProps {
  mode?: ScannerMode;
  onScan: (upc: string) => void;
  onCooldown?: (upc: string, reason: 'cooldown' | 'duplicate') => void;
  title: string;
  subtitle: string;
  beepEnabled?: boolean;
  cooldownMs?: number;
  onPhotoCaptured?: (photoDataUrl: string, mime: string) => void;
  closeOnScan?: boolean;
  manualStart?: boolean;
  onClose?: () => void;
  showClose?: boolean;
  className?: string;
}

// Allow UPC/EAN lengths commonly encountered.
// - UPC-A: 12
// - UPC-E: 8
// - EAN-13: 13
// - Some systems store leading/trailing zeros (14)
const MIN_LEN = 8;
const MAX_LEN = 14;

const normalizeUpc = (raw: string) => raw.replace(/\D/g, '');

const MODE_LABELS: Record<ScannerMode, string> = {
  [ScannerMode.INVENTORY_CREATE]: 'Inventory Create',
  [ScannerMode.UPC_LOOKUP]: 'UPC Lookup',
  [ScannerMode.DRIVER_VERIFY_CONTAINERS]: 'Driver Verify Containers',
  [ScannerMode.CUSTOMER_RETURN_SCAN]: 'Customer Return Scan'
};

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
  closeOnScan = false,
  manualStart = false,
  className = ''
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);

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

  const [isScanning, setIsScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [manualUpc, setManualUpc] = useState('');
  const [lastDetectedUpc, setLastDetectedUpc] = useState<string | null>(null);

  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);

  useEffect(() => {
    torchOnRef.current = torchOn;
  }, [torchOn]);

  const modeLabel = useMemo(() => {
    if (!mode) return null;
    return MODE_LABELS[mode] ?? String(mode);
  }, [mode]);

  const canCapturePhoto = Boolean(onPhotoCaptured);

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

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

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

  const panelClassName = `bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl flex flex-col h-full ${className}`.trim();

  return (
    <div className={panelClassName}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-white font-black uppercase tracking-widest text-sm">{title}</p>
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">{subtitle}</p>
          {modeLabel && (
            <p className="text-[10px] text-slate-700 font-bold uppercase tracking-widest mt-1">Mode: {modeLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Torch button next to X */}
          <button
            onClick={() => void toggleTorch()}
            disabled={!torchSupported}
            className={`p-3 rounded-2xl border border-white/10 transition flex items-center justify-center ${
              torchSupported
                ? torchOn
                  ? 'bg-yellow-400 text-black' // yellow when on
                  : 'bg-white/10 text-white' // default when off
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
            title={torchSupported ? (torchOn ? 'Turn off torch' : 'Turn on torch') : 'Torch not supported'}
          >
            {torchOn ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
          </button>
          {showClose && onClose ? (
            <button
              onClick={onClose}
              className="p-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex-1 min-h-0 rounded-3xl overflow-hidden border border-white/10 bg-black/40 flex items-center justify-center relative">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />

        {!isScanning && (
          <div className="absolute text-center px-8 flex flex-col items-center gap-3">
            <Camera className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              {scannerError ?? (manualStart ? 'Press Start to begin scanning' : 'Initializing camera...')}
            </p>

            <button
              onClick={() => void startScanner()}
              className="px-4 py-2 rounded-xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" /> {manualStart ? 'Start' : 'Retry'}
            </button>
            {scannerError && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Enable camera permissions, then retry.
              </p>
            )}
            {scannerHint && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{scannerHint}</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex gap-2">
          {canCapturePhoto ? (
            <button
              onClick={takePhoto}
              disabled={!isScanning}
              className="px-4 py-4 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Capture photo"
            >
              <Camera className="w-4 h-4" /> Photo
            </button>
          ) : null}
        </div>

        <div className="flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Latest: <span className="text-white">{lastDetectedUpc || '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            {beepEnabled ? (
              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <Volume2 className="w-3 h-3" /> Beep
              </div>
            ) : null}
          </div>
        </div>

        {scannerError && (
          <div className="text-[11px] text-ninpo-red bg-ninpo-red/10 border border-ninpo-red/20 rounded-2xl p-4">
            {scannerError}
          </div>
        )}
      </div>
    </div>
  );
};

export type { ScannerPanelProps };
export default ScannerPanel;
