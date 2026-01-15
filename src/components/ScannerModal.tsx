import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ScanLine, Camera, Volume2, RefreshCw } from 'lucide-react';

interface ScannerModalProps {
  mode: 'A' | 'B' | 'C' | 'D' | 'UPC_REGISTRY' | string; // Allow custom modes like 'upcWhitelist'
  onScan: (upc: string, quantity?: number) => void;
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

  const stopScanner = useCallback(async () => {
    setIsScanning(false);
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleScan = (upc: string) => {
    const now = Date.now();
    if (now - lastScanTime < cooldownMs) return;
    setLastScanTime(now);
    setLastDetectedUpc(upc);
    if (beepEnabled) playBeep();
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

  const startScanner = useCallback(async () => {
    let cancelled = false;
    await stopScanner();
    setScannerError(null);
      if (!('BarcodeDetector' in window)) {
        setScannerError('Barcode detection not supported on this device/browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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
    startScanner();
    return () => {
      stopScanner();
    };
  }, [startScanner, stopScanner]);

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
            {beepEnabled && (
              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                <Volume2 className="w-3 h-3" /> Beep
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ScannerModal;