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
  Upload
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
  // Store context
  selectedStoreId?: string;
  selectedStoreName?: string;
  selectedStoreBrand?: string;
  selectedStoreLocation?: string;
  selectedStoreIsPrimary?: boolean;
  onTogglePrimarySupplier?: () => void;
}

// Allow UPC/EAN lengths commonly encountered.
// - UPC-A: 12
// - UPC-E: 8
// - EAN-13: 13
// - Some systems store leading/trailing zeros (14)
const MIN_LEN = 8;
const MAX_LEN = 14;

// Image handling constants
const MAX_UPLOAD_MB = 6; // Reject overly large uploads to avoid memory spikes
const MAX_IMAGE_DIMENSION = 1920; // Max width/height
const IMAGE_COMPRESSION_QUALITY = 0.85; // JPEG quality

const normalizeUpc = (raw: string) => raw.replace(/\D/g, '');

/**
 * Resizes and compresses an image from a given source.
 * @param imageSource The source of the image (e.g., HTMLImageElement, HTMLVideoElement).
 * @param maxWidth The maximum width of the output image.
 * @param maxHeight The maximum height of the output image.
 * @param quality The quality of the output JPEG image (0.0 to 1.0).
 * @returns A Promise that resolves with the data URL of the resized and compressed image.
 */
const compressAndResizeImage = (
  imageSource: HTMLImageElement | HTMLVideoElement,
  maxWidth: number,
  maxHeight: number,
  quality: number
): Promise<string> => {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // Fallback to returning a placeholder or handling error
      resolve('');
      return;
    }

    const sourceWidth = 'videoWidth' in imageSource ? imageSource.videoWidth : imageSource.width;
    const sourceHeight = 'videoHeight' in imageSource ? imageSource.videoHeight : imageSource.height;

    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    if (targetWidth > maxWidth || targetHeight > maxHeight) {
      if (targetWidth / targetHeight > maxWidth / maxHeight) {
        targetWidth = maxWidth;
        targetHeight = Math.round((targetWidth / sourceWidth) * sourceHeight);
      } else {
        targetHeight = maxHeight;
        targetWidth = Math.round((targetHeight / sourceHeight) * sourceWidth);
      }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

    resolve(canvas.toDataURL('image/jpeg', quality));
  });
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
  onReceiptParsed,
  onModeChange,
  receiptHeaderContent,
  receiptSaveDisabled = false,
  receiptSaveDisabledReason,
  closeOnScan = false,
  manualStart = false,
  className = '',
  bottomSheetContent,
  selectedStoreId,
  selectedStoreName,
  selectedStoreBrand,
  selectedStoreLocation,
  selectedStoreIsPrimary = false,
  onTogglePrimarySupplier
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
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [manualUpc, setManualUpc] = useState('');
  const [lastDetectedUpc, setLastDetectedUpc] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('image/jpeg');
  const [isDragActive, setIsDragActive] = useState(false);

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

    // In receipt mode, we just need the camera stream. No barcode detection.
    if (isReceiptMode) {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
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
          await videoRef.current.play();
          setIsScanning(true);
        }
      } catch (err) {
        setScannerError('Camera blocked. Enable permissions and retry.');
        setIsScanning(false);
        setBlocked(true);
      }
      return;
    }

    // For all other modes, use BarcodeDetector
    if (!('BarcodeDetector' in window)) {
      setScannerError('Scanner not supported on this device.');
      // Do not set blocked, so user can retry if it was a transient error
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
  }, [acceptScan, stopScanner, validateUpc, isReceiptMode]);


  const captureReceiptAndParse = useCallback(async () => {
    if (!videoRef.current) return;

    // Pause camera/detect loop while preview is displayed to reduce device load
    void stopScanner();

    try {
      const dataUrl = await compressAndResizeImage(
        videoRef.current,
        MAX_IMAGE_DIMENSION,
        MAX_IMAGE_DIMENSION,
        IMAGE_COMPRESSION_QUALITY
      );
      setPreviewImage(dataUrl);
      setPreviewMime('image/jpeg');
    } catch (error) {
      setScannerError('Failed to capture image.');
      void startScanner(); // Retry if capture failed
    }
  }, [stopScanner, startScanner]);

  const handleUsePhoto = useCallback(() => {
    if (!previewImage || !onPhotoCaptured) return;
    onPhotoCaptured(previewImage, previewMime);
    setPreviewImage(null);
  }, [previewImage, previewMime, onPhotoCaptured]);

  const handleRetakePhoto = useCallback(() => {
    setPreviewImage(null);
    void startScanner();
  }, [startScanner]);

  const handleReceiptFile = useCallback(
    (file: File) => {
      if (!file) return;

      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setScannerError(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
        return;
      }

      if (file.type === 'application/pdf') {
        setScannerError('PDF uploads are coming soon.');
        return;
      }

      if (!file.type.startsWith('image/')) {
        setScannerError('Unsupported file type. Please upload an image.');
        return;
      }

      // Stop the camera while we process the upload to avoid extra device load
      void stopScanner();

      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = async () => {
          try {
            const dataUrl = await compressAndResizeImage(
              img,
              MAX_IMAGE_DIMENSION,
              MAX_IMAGE_DIMENSION,
              IMAGE_COMPRESSION_QUALITY
            );
            setPreviewImage(dataUrl);
            setPreviewMime('image/jpeg');
          } catch (error) {
            setScannerError('Failed to process image.');
            // If processing failed, restart the scanner so the user can retry
            void startScanner();
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [startScanner]
  );

  const handleReceiptFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleReceiptFile(file);
      }
      event.target.value = '';
    },
    [handleReceiptFile]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleReceiptFile(file);
      }
    },
    [handleReceiptFile]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  }, []);

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
    <div className={`fixed inset-0 z-50 flex flex-col bg-black ${className || ''}`}>
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

      {/* Top bar with back, torch, and store display */}
      <div className="relative z-10 flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
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

        {/* Store context header */}
        {selectedStoreName && (
          <div className="rounded-xl bg-black/70 border border-white/10 px-3 py-2 text-center">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Current Store</p>
            <p className="text-sm text-white font-bold truncate">{selectedStoreName}</p>
            <div className="mt-2 space-y-1 text-[11px]">
              {selectedStoreBrand && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">Brand</span>
                  <span className="text-slate-200 font-semibold truncate">{selectedStoreBrand}</span>
                </div>
              )}
              {selectedStoreLocation && (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">Location</span>
                  <span className="text-slate-500 truncate">{selectedStoreLocation}</span>
                </div>
              )}
            </div>
            {onTogglePrimarySupplier && selectedStoreId && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Primary supplier</span>
                <button
                  type="button"
                  onClick={onTogglePrimarySupplier}
                  aria-pressed={selectedStoreIsPrimary}
                  aria-label={`Primary supplier ${selectedStoreIsPrimary ? 'on' : 'off'}`}
                  className={`h-5 w-10 rounded-full border border-white/10 transition relative ${
                    selectedStoreIsPrimary ? 'bg-ninpo-lime/80' : 'bg-white/10'
                  }`}
                >
                  <span
                    className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white shadow-sm transition ${
                      selectedStoreIsPrimary ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isReceiptMode && receiptHeaderContent && (
        <div className="relative z-10 px-4">
          <div className="mt-2 rounded-2xl bg-black/70 border border-white/10 p-3 shadow-lg">
            {receiptHeaderContent}
          </div>
        </div>
      )}

      {/* Preview overlay */}
      {previewImage && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-ninpo-black/95 backdrop-blur-md p-4">
          <div className="flex flex-col items-center gap-4 w-full max-w-sm">
            <h2 className="text-lg font-bold text-white">Review Photo</h2>

            {/* Thumbnail preview */}
            <img
              src={previewImage}
              alt="Receipt preview"
              className="w-full rounded-xl border border-white/20 shadow-lg max-h-[50vh] object-contain"
            />

            {/* Action buttons */}
            <div className="flex gap-3 w-full">
              <button
                onClick={handleRetakePhoto}
                className="flex-1 px-4 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold transition flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retake
              </button>
              <button
                onClick={handleUsePhoto}
                className="flex-1 px-4 py-3 rounded-lg bg-ninpo-lime text-ninpo-black font-semibold transition hover:bg-ninpo-lime/90 flex items-center justify-center gap-2"
              >
                <span>✓</span>
                Use Photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom capture button (receipt mode) */}
      {canCapturePhoto && isReceiptMode && (
        <div className="relative z-10 mt-auto px-4 pb-4 space-y-3">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`rounded-2xl border-2 border-dashed p-4 text-center transition ${
              isDragActive
                ? 'border-ninpo-lime bg-ninpo-lime/10 text-ninpo-lime'
                : 'border-white/20 bg-black/60 text-white/70'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-widest">
              Drag & drop a receipt image
            </p>
            <p className="text-[10px] text-white/50 mt-2">
              Use the camera below, or upload an image file.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2">
              <label
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer transition ${
                  receiptUploadBlocked
                    ? 'bg-gray-600/70 text-gray-300 cursor-not-allowed'
                    : 'bg-ninpo-lime text-ninpo-black hover:bg-ninpo-lime/90'
                }`}
              >
                <Upload className="w-3 h-3" />
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptFileInput}
                  disabled={receiptUploadBlocked}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 text-white/40 border border-white/10 cursor-not-allowed"
                title="PDF upload coming soon"
              >
                PDF (coming soon)
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={receiptUploadBlocked ? undefined : captureReceiptAndParse}
              disabled={receiptUploadBlocked}
              className={`p-4 rounded-full backdrop-blur-sm transition flex items-center justify-center shadow-lg ${
                receiptUploadBlocked
                  ? 'bg-gray-600/70 text-gray-300 cursor-not-allowed'
                  : 'bg-cyan-500/90 text-white hover:bg-cyan-600'
              }`}
              title={receiptUploadBlocked ? 'Select a store before uploading' : 'Capture receipt manually'}
            >
              <Camera className="w-6 h-6" />
            </button>
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
