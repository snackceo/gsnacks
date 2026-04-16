import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef, useContext } from 'react';
// Toast context (assume addToast is provided at app root)
const ToastContext = React.createContext<{ addToast: (msg: string, opts?: { type?: 'success' | 'error' | 'info' }) => void } | null>(null);
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
import useCameraStream from '../hooks/useCameraStream';

export interface ParsedReceiptItem {
  receiptName: string;
  quantity: number;
  totalPrice: number;
}

export interface ScannerPanelProps {
  mode?: ScannerMode;
  onScan?: (upc: string) => void;
  onCooldown?: (upc: string, reason: 'cooldown' | 'duplicate') => void;
  title?: string;
  subtitle?: string;
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
  selectedStoreId?: string;
  selectedStoreName?: string;
  selectedStoreBrand?: string;
  selectedStoreLocation?: string;
  selectedStoreIsPrimary?: boolean;
  onTogglePrimarySupplier?: () => void;
}

const getCooldownForMode = (mode?: ScannerMode): number => {
  switch (mode) {
    case ScannerMode.INVENTORY_CREATE:
    case ScannerMode.UPC_LOOKUP:
      return 500; // Faster for admin tasks
    case ScannerMode.CUSTOMER_RETURN_SCAN:
      return 1500; // Slower for customer returns to prevent accidental duplicates
    default:
      return 1200; // Default cooldown
  }
};
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
const ENABLE_PLUGGABLE_DECODER_FALLBACK = false;

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
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas context unavailable'));
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


const ScannerPanel = forwardRef<any, ScannerPanelProps>(({
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
}, ref) => {
    // Expose capturePhoto method to parent via ref
    useImperativeHandle(ref, () => ({
      capturePhoto: () => {
        if (mode === ScannerMode.RECEIPT_PARSE_LIVE) {
          return captureReceiptAndParse();
        }
        return takePhoto();
      }
    }));

    // Toast context
    const toastCtx = useContext(ToastContext);
    const addToast = toastCtx?.addToast || (() => {});
  const { videoRef, streamRef, streamActive, error: cameraError, startCamera, stopCamera } = useCameraStream({ autoStart: false });
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
  const cooldownMsRef = useRef<number>(getCooldownForMode(mode));

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
  const [supportsBarcodeDetector, setSupportsBarcodeDetector] = useState(true);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('image/jpeg');
  const [isDragActive, setIsDragActive] = useState(false);

  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);

  const isReceiptMode = mode === ScannerMode.RECEIPT_PARSE_LIVE;
  const isManualOnlyFallback = !isReceiptMode && !supportsBarcodeDetector;

  const modeFallbackHint = useCallback((scannerMode?: ScannerMode) => {
    if (scannerMode === ScannerMode.INVENTORY_CREATE) {
      return 'Inventory mode: enter UPC manually to continue creating or updating product details.';
    }
    if (scannerMode === ScannerMode.UPC_LOOKUP) {
      return 'UPC lookup mode: enter UPC manually to find or edit registry mappings.';
    }
    if (
      scannerMode === ScannerMode.DRIVER_VERIFY_CONTAINERS ||
      scannerMode === ScannerMode.CUSTOMER_RETURN_SCAN ||
      scannerMode === ScannerMode.DRIVER_FULFILL_ORDER
    ) {
      return 'Returns/driver mode: enter UPC manually to continue verification and fulfillment flow.';
    }
    return 'Manual UPC entry is available for this scanner mode.';
  }, []);

  // Native camera only on mobile for receipt mode
  const isMobile =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer:coarse)').matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  const useNativeCameraOnly = isReceiptMode && isMobile;

  useEffect(() => {
    torchOnRef.current = torchOn;
  }, [torchOn]);

  const canCapturePhoto = Boolean(onPhotoCaptured);
  const receiptUploadBlocked = isReceiptMode && receiptSaveDisabled;
  const shouldWarnNoStore = isReceiptMode && !selectedStoreId && !receiptSaveDisabled;

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
    onCooldownRef.current = onCooldown;
    closeOnScanRef.current = !!closeOnScan;
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

    videoTrackRef.current = null;
    setTorchSupported(false);
    stopCamera();
  }, [stopCamera]);

  const handleClose = useCallback(() => {
    void stopScanner();
    onCloseRef.current?.();
  }, [stopScanner]);

  const acceptScan = useCallback(
    (upc: string) => {
      const now = Date.now();
      const cooldownMsValue = cooldownMsRef.current;

      // Global cooldown
      if (now - lastAcceptAtRef.current < cooldownMsValue) {
        addToast('Same UPC — tap to add again', { type: 'info' });
        onCooldownRef.current?.(upc, 'cooldown');
        return;
      }

      // Prevent immediately re-accepting the exact same code even if timing jitter occurs
      if (lastAcceptedCodeRef.current === upc && now - lastAcceptAtRef.current < Math.max(600, cooldownMsValue)) {
        addToast('Same UPC — tap to add again', { type: 'info' });
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
        handleClose();
      }
    },
    [handleClose, playBeep, addToast]
  );

  const toggleTorch = useCallback(async () => {
    if (!torchSupported) {
      setScannerError('Torch not supported on this device.');
      addToast('Torch not supported', { type: 'error' });
      return;
    }
    if (!videoTrackRef.current) return;
    const next = !torchOnRef.current;
    try {
      await videoTrackRef.current.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
      addToast(next ? 'Torch enabled' : 'Torch disabled', { type: 'info' });
    } catch (err) {
      setScannerError('Failed to toggle torch. Your device or browser may not support this feature.');
      addToast('Failed to toggle torch', { type: 'error' });
      // Do not restart or stop the camera, just show error
    }
  }, [torchSupported, addToast]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !onPhotoCaptured) {
      addToast('Camera not ready for photo', { type: 'error' });
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      addToast('Failed to access camera', { type: 'error' });
      return;
    }

    const w = videoRef.current.videoWidth;
    const h = videoRef.current.videoHeight;
    if (!w || !h) {
      addToast('Camera not ready for photo', { type: 'error' });
      return;
    }

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(videoRef.current, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    addToast('Photo captured', { type: 'success' });
    onPhotoCaptured(dataUrl, 'image/jpeg');
  }, [onPhotoCaptured, addToast]);

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

    // Prevent camera startup in receipt mode on mobile
    if (useNativeCameraOnly) {
      setIsScanning(false);
      setScannerError(null);
      setScannerHint(null);
      return;
    }

    // In receipt mode, we just need the camera stream. No barcode detection.
    if (isReceiptMode) {
      await startCamera({
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      });
      if (cancelledRef.current) {
        stopCamera();
        return;
      }
      if (!streamRef.current) {
        setScannerError('Camera blocked. Enable permissions and retry.');
        setIsScanning(false);
        setBlocked(true);
        return;
      }
      const track = streamRef.current.getVideoTracks()[0];
      videoTrackRef.current = track;
      const caps = track?.getCapabilities?.();
      setTorchSupported(Boolean((caps as any)?.torch));
      return;
    }
    const hasBarcodeDetector = 'BarcodeDetector' in window;
    setSupportsBarcodeDetector(hasBarcodeDetector);

    try {
      await startCamera({
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      });
      if (cancelledRef.current) {
        stopCamera();
        return;
      }
      if (!streamRef.current || !videoRef.current) {
        setScannerError('Camera failed to start. Tap Retry.');
        setScannerHint('On mobile Chrome, tap once to grant permission or retry after allowing camera access.');
        setIsScanning(false);
        videoTrackRef.current = null;
        return;
      }

      const track = streamRef.current.getVideoTracks()[0];
      videoTrackRef.current = track;

      const caps = track?.getCapabilities?.();
      setTorchSupported(Boolean((caps as any)?.torch));

      // Keep camera preview active and route users to manual entry.
      if (!hasBarcodeDetector) {
        setScannerError(null);
        setScannerHint(modeFallbackHint(mode));
        if (ENABLE_PLUGGABLE_DECODER_FALLBACK) {
          setScannerHint(`${modeFallbackHint(mode)} Experimental decoder fallback is enabled.`);
          // Pluggable decoder can be integrated here behind feature flags/settings.
        }
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
  }, [acceptScan, stopScanner, validateUpc, isReceiptMode, useNativeCameraOnly, startCamera, stopCamera, mode, modeFallbackHint]);

  useEffect(() => {
    setIsScanning(streamActive);
  }, [streamActive]);

  useEffect(() => {
    if (cameraError && !scannerError) {
      setScannerError('Camera blocked. Enable permissions.');
      setBlocked(true);
    }
  }, [cameraError, scannerError]);


  const captureReceiptAndParse = useCallback(async () => {
    if (!videoRef.current) {
      addToast('Camera not ready for capture', { type: 'error' });
      return;
    }

    // Pause camera/detect loop while preview is displayed to reduce device load
    void stopScanner();

    try {
      const dataUrl = await compressAndResizeImage(
        videoRef.current,
        MAX_IMAGE_DIMENSION,
        MAX_IMAGE_DIMENSION,
        IMAGE_COMPRESSION_QUALITY
      );
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        throw new Error('Invalid captured image');
      }
      setPreviewImage(dataUrl);
      setPreviewMime('image/jpeg');
      addToast('Receipt photo ready for review', { type: 'info' });
    } catch (error) {
      setScannerError('Failed to capture image.');
      addToast('Failed to capture image', { type: 'error' });
      void startScanner(); // Retry if capture failed
    }
  }, [stopScanner, startScanner, addToast]);

  const handleUsePhoto = useCallback(() => {
    if (!previewImage || !onPhotoCaptured) {
      addToast('No photo to use', { type: 'error' });
      return;
    }
    addToast('Photo submitted for parsing', { type: 'success' });
    onPhotoCaptured(previewImage, previewMime);
    setPreviewImage(null);
  }, [previewImage, previewMime, onPhotoCaptured, addToast]);

  const handleRetakePhoto = useCallback(() => {
    setPreviewImage(null);
    addToast('Retake photo', { type: 'info' });
    void startScanner();
  }, [startScanner, addToast]);

  const handleReceiptFile = useCallback(
    (file: File) => {
      if (!file) {
        addToast('No file selected', { type: 'error' });
        return;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setScannerError(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
        addToast('File too large', { type: 'error' });
        return;
      }
      if (file.type === 'application/pdf') {
        setScannerError('PDF uploads are coming soon.');
        addToast('PDF uploads not supported yet', { type: 'info' });
        return;
      }
      if (!file.type.startsWith('image/')) {
        setScannerError('Unsupported file type. Please upload an image.');
        addToast('Unsupported file type', { type: 'error' });
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
            if (!dataUrl || !dataUrl.startsWith('data:image/')) {
              throw new Error('Invalid captured image');
            }
            setPreviewImage(dataUrl);
            setPreviewMime('image/jpeg');
            addToast('Image ready for review', { type: 'info' });
          } catch (error) {
            setScannerError('Failed to process image.');
            addToast('Failed to process image', { type: 'error' });
            // If processing failed, restart the scanner so the user can retry
            void startScanner();
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [startScanner, addToast]
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
    if (!ok) {
      addToast('Invalid UPC', { type: 'error' });
      return;
    }
    addToast('Manual UPC submitted', { type: 'success' });
    acceptScan(upc);
    setManualUpc('');
  }, [acceptScan, manualUpc, validateUpc, addToast]);

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
    if (manualStart) {
      void stopScanner();
      setScannerError(null);
      setScannerHint(null);
      setIsScanning(false);
      return;
    }

    let active = true;
    const restartScannerForMode = async () => {
      await stopScanner();
      if (!active) return;
      await startScanner();
    };

    void restartScannerForMode();

    return () => {
      active = false;
    };
  }, [manualStart, mode, startScanner, stopScanner]);

  // Add toast for all scanner/camera errors
  useEffect(() => {
    if (scannerError) {
      addToast(scannerError, { type: 'error' });
    }
  }, [scannerError, addToast]);

  return (

    <div className={`fixed inset-0 z-50 flex flex-col bg-black ${className || ''}`}>
      {/* Full-screen video (hide on mobile receipt mode) */}
      {!useNativeCameraOnly && (
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
      )}

      {/* Top bar with back, torch, and store display */}
      <div className="relative z-10 flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          {showClose && onClose ? (
            <button
              onClick={handleClose}
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


      {/* Bottom capture/upload button (receipt mode) with upload/drag-drop UI */}
      {isReceiptMode && canCapturePhoto && !previewImage && (
        <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center justify-end pb-8 pointer-events-none">
          <div className="flex flex-col items-center gap-3 pointer-events-auto">
            {/* Hide camera shutter button on mobile receipt mode */}
            {!useNativeCameraOnly && (
              <button
                onClick={captureReceiptAndParse}
                className="w-20 h-20 rounded-full bg-ninpo-lime text-ninpo-black flex items-center justify-center shadow-neon text-3xl font-black focus:outline-none focus:ring-4 focus:ring-ninpo-lime/40 transition hover:bg-ninpo-lime/90"
                aria-label="Capture photo"
                type="button"
                disabled={receiptUploadBlocked}
              >
                <Camera className="w-10 h-10" />
              </button>
            )}
            <label className="flex flex-col items-center gap-2 cursor-pointer text-xs text-white/80 font-bold uppercase tracking-widest mt-2">
              <Upload className="w-5 h-5 mb-1" />
              Upload
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleReceiptFileInput}
                disabled={receiptUploadBlocked}
              />
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`mt-2 w-48 h-16 flex items-center justify-center border-2 border-dashed rounded-xl transition-colors ${isDragActive ? 'border-ninpo-lime bg-ninpo-lime/10' : 'border-white/20 bg-black/30'}`}
              style={{ pointerEvents: 'auto' }}
            >
              <span className="text-xs text-white/60">Drag & drop image</span>
            </div>
            {receiptSaveDisabledReason && (
              <div className="mt-2 text-xs text-ninpo-red font-bold">{receiptSaveDisabledReason}</div>
            )}
          </div>
        </div>
      )}

      {bottomSheetContent && (
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

      {!isReceiptMode && (isManualOnlyFallback || scannerHint) && (
        <div className="absolute bottom-4 left-4 right-4 z-20 rounded-2xl border border-white/20 bg-black/80 backdrop-blur-sm p-4 shadow-xl">
          <p className="text-[11px] font-black uppercase tracking-widest text-ninpo-lime">
            {isManualOnlyFallback ? 'Manual UPC entry' : 'Scanner hint'}
          </p>
          <p className="mt-1 text-xs text-slate-200 font-semibold">
            {scannerHint ?? modeFallbackHint(mode)}
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={manualUpc}
              onChange={e => setManualUpc(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleManualScan();
                }
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter UPC (8-14 digits)"
              className="w-full rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-ninpo-lime/50"
            />
            <button
              type="button"
              onClick={handleManualScan}
              className="rounded-xl bg-ninpo-lime px-4 py-2 text-xs font-black uppercase tracking-widest text-ninpo-black"
            >
              Submit UPC
            </button>
          </div>
        </div>
      )}

    </div>
  );
});

export default ScannerPanel;
