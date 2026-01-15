import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ScanLine, Camera, Volume2, RefreshCw, Flashlight } from 'lucide-react';

interface ScannerModalProps {
  mode: 'A' | 'B' | 'C' | 'D' | 'PRODUCT_CREATION' | 'UPC_REGISTRY' | string;
  onScan: (upc: string, quantityOrPhoto?: number | string) => void;
  onClose: () => void;
  title: string;
  subtitle: string;
  beepEnabled?: boolean;
  cooldownMs?: number;
}

const ScannerModal: React.FC<ScannerModalProps> = ({
  mode,
  onScan,
  onClose,
  title,
  subtitle,
  beepEnabled = true,
  cooldownMs = 1200,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualUpc, setManualUpc] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [lastScanTime, setLastScanTime] = useState(0);
  const [lastDetectedUpc, setLastDetectedUpc] = useState<string | null>(null);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(mode === 'PRODUCT_CREATION');

  const toggleFlashlight = useCallback(async () => {
    if (!streamRef.current) return;
    
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      const capabilities = videoTrack.getCapabilities();
      if (capabilities.torch) {
        await videoTrack.applyConstraints({
          advanced: [{ torch: !flashlightOn } as any]
        });
        setFlashlightOn(!flashlightOn);
      }
    } catch (error) {
      console.warn('Flashlight not supported:', error);
    }
  }, [flashlightOn]);

  const capturePhoto = useCallback(async (): Promise<string | null> => {
    if (!videoRef.current) return null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    
    ctx.drawImage(videoRef.current, 0, 0);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  const handleScan = async (upc: string) => {
    const now = Date.now();
    if (now - lastScanTime < cooldownMs) return;
    setLastScanTime(now);
    setLastDetectedUpc(upc);
    if (beepEnabled) playBeep();

    // Auto-capture photo for PRODUCT_CREATION mode
    if (mode === 'PRODUCT_CREATION' && autoCaptureEnabled) {
      try {
        const photoDataUrl = await capturePhoto();
        if (photoDataUrl) {
          // Pass the photo data along with the UPC
          onScan(upc, photoDataUrl);
          return;
        }
      } catch (error) {
        console.warn('Auto-capture failed:', error);
      }
    }

    onScan(upc, mode === 'A' || mode === 'B' ? quantity : 1);
  };

  const playBeep = () => {
    if (typeof window === 'undefined') return;
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const context = audioContextRef.current;
    if (context.state === 'suspended') context.resume();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.frequency.value = 980;
    gainNode.gain.value = 0.1;
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  };

  const handleManualScan = () => {
    if (manualUpc.trim()) {
      handleScan(manualUpc.trim());
      setManualUpc('');
    }
  };

  const stopScanner = useCallback(async () => {
    setIsScanning(false);
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async () => {
    let cancelled = false;
    await stopScanner();
    setScannerError(null);
      if (!('BarcodeDetector' in window)) {
        setScannerError('Barcode detection not supported on this device/browser.');
        return;
      }
      try {
        // Try different camera constraints for better scanning
        let constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          }
        };

        // Try to get macro lens if available (experimental)
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === 'videoinput');
          
          // Look for macro or wide-angle camera
          const macroDevice = videoDevices.find(device => 
            device.label.toLowerCase().includes('macro') || 
            device.label.toLowerCase().includes('wide')
          );
          
          if (macroDevice) {
            constraints.video = {
              deviceId: { exact: macroDevice.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 }
            };
          }
        } catch (deviceError) {
          // Fall back to default constraints - device enumeration may fail due to permissions
          console.warn('Could not enumerate devices:', deviceError);
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsScanning(true);
        const detector = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        const detect = async () => {
          if (!videoRef.current || cancelled) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) handleScan(barcodes[0].rawValue);
          } catch (err) { /* ignore detection errors */ }
          if (!cancelled) scanLoopRef.current = requestAnimationFrame(detect);
        };
        detect();
      } catch (err) {
        setScannerError('Camera access denied or unavailable.');
      }
  }, [stopScanner, handleScan]);

  useEffect(() => {
    setAutoCaptureEnabled(mode === 'PRODUCT_CREATION');
  }, [mode]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  useEffect(() => {
    startScanner();
  }, [startScanner]);

  return createPortal(
    <div className="fixed inset-0 z-[14000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-ninpo-black border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-white font-black uppercase tracking-widest text-sm">{title}</p>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
              {subtitle}
            </p>
          </div>
          <button onClick={onClose} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-5 rounded-3xl overflow-hidden border border-white/10 bg-black/40 aspect-video flex items-center justify-center relative">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {isScanning && <span className="scanning-line" />}
          {!isScanning && (
            <div className="absolute text-center px-8 flex flex-col items-center gap-3">
              <Camera className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                {scannerError ? 'Scanner unavailable' : 'Initializing camera...'}
              </p>
              {scannerError && (
                <button
                  onClick={startScanner}
                  className="px-4 py-2 rounded-xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mt-5 space-y-4">
          <div className="flex gap-2">
            <input
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white flex-1"
              placeholder="Manual UPC entry"
              value={manualUpc}
              onChange={e => setManualUpc(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleManualScan()}
            />
            <button
              onClick={handleManualScan}
              className="px-4 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
            >
              <ScanLine className="w-4 h-4" /> Scan
            </button>
          </div>
          {(mode === 'A' || mode === 'B') && ( // Only show quantity for Add Stock and Audit modes
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Quantity:
              </label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                className="bg-black/40 border border-white/10 rounded-2xl p-2 text-sm text-white w-16"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              Latest: <span className="text-white">{lastDetectedUpc || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'PRODUCT_CREATION' && (
                <>
                  <button
                    onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)}
                    className={`p-2 rounded-xl transition ${
                      autoCaptureEnabled 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                    title="Auto-capture photo on scan"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      const photo = await capturePhoto();
                      if (photo && lastDetectedUpc) {
                        onScan(lastDetectedUpc, photo);
                      }
                    }}
                    className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition"
                    title="Capture photo manually"
                  >
                    <ScanLine className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={toggleFlashlight}
                className={`p-2 rounded-xl transition ${
                  flashlightOn 
                    ? 'bg-yellow-500/20 text-yellow-400' 
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
                title="Toggle flashlight"
              >
                <Flashlight className="w-4 h-4" />
              </button>
              {beepEnabled && (
                <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  <Volume2 className="w-3 h-3" /> Beep
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ScannerModal;