import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, Check, AlertCircle, Loader2 } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

interface ParsedItem {
  receiptName: string;
  quantity: number;
  totalPrice: number;
  parsedAt: Date;
}

interface LiveReceiptScannerProps {
  storeId?: string;
  storeName?: string;
  onClose: () => void;
  onSaveReceipt?: (captureId: string) => void;
}

export default function LiveReceiptScanner({
  storeId,
  storeName = 'Live Receipt',
  onClose,
  onSaveReceipt
}: LiveReceiptScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastParseTimeRef = useRef<number>(0);
  const PARSE_INTERVAL_MS = 3000; // Parse every 3 seconds

  // Initialize camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraReady(true);
        }
      } catch (err: any) {
        setError(`Camera access denied: ${err.message}`);
      }
    };

    initCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  // Capture frame from video and send to Gemini
  const captureAndParse = async () => {
    if (!videoRef.current || !canvasRef.current || parsing) return;

    const now = Date.now();
    if (now - lastParseTimeRef.current < PARSE_INTERVAL_MS) return; // Rate limit

    // Ensure video has dimensions
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) {
      console.warn('Video not ready yet (dimensions 0)');
      return;
    }

    setParsing(true);
    try {
      // Capture frame
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) {
        console.error('Failed to get canvas context');
        return;
      }

      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);

      // Convert to base64 - ensure it's a valid JPEG
      const base64 = canvasRef.current.toDataURL('image/jpeg', 0.85);
      
      if (!base64 || base64.length < 100) {
        console.warn('Canvas toDataURL returned very short result:', base64.length);
        return;
      }

      // Send to backend for Gemini parsing
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image: base64 })
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(`Failed to parse frame: ${resp.status} - ${errorData.error || 'unknown error'}`);
      }

      const data = await resp.json();
      if (data.items && Array.isArray(data.items)) {
        // Merge new items, avoiding duplicates based on receipt name
        setItems(prev => {
          const existing = new Set(prev.map(i => i.receiptName));
          const newItems = data.items.filter((item: any) => !existing.has(item.receiptName));
          return [
            ...prev,
            ...newItems.map((item: any) => ({
              receiptName: item.receiptName,
              quantity: item.quantity,
              totalPrice: item.totalPrice,
              parsedAt: new Date()
            }))
          ];
        });
        lastParseTimeRef.current = now;
      }
    } catch (err: any) {
      console.error('Parse error:', err.message || err);
      setError(`Parse failed: ${err.message || 'unknown error'}`);
    } finally {
      setParsing(false);
    }
  };

  // Auto-parse on interval
  useEffect(() => {
    if (!cameraReady) return;

    const interval = setInterval(captureAndParse, PARSE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [cameraReady, parsing]);

  // Save parsed items as receipt
  const handleSave = async () => {
    if (items.length === 0) {
      setError('No items parsed yet');
      return;
    }

    setSaving(true);
    try {
      // Convert parsed items to image capture format (use canvas as "receipt")
      const imageBase64 = canvasRef.current?.toDataURL('image/jpeg', 0.8) || '';

      // Create receipt capture with these items
      const captureRequestId = `live_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureRequestId,
          storeId,
          storeName,
          orderId: undefined,
          images: [{ url: imageBase64, thumbnailUrl: imageBase64 }]
        })
      });

      if (!resp.ok) throw new Error('Failed to create receipt');

      const data = await resp.json();
      
      // Now create a "parsed" receipt directly with items
      const parseResp = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          captureId: data.captureId,
          items: items.map(i => ({
            receiptName: i.receiptName,
            quantity: i.quantity,
            totalPrice: i.totalPrice
          }))
        })
      });

      if (!parseResp.ok) throw new Error('Failed to save items');

      if (onSaveReceipt) onSaveReceipt(data.captureId);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-6 h-6" />
              <div>
                <h2 className="text-xl font-bold">Live Receipt Scanner</h2>
                <p className="text-sm text-blue-100">{storeName}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white/20 rounded p-2">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex gap-4 p-4">
          {/* Camera feed */}
          <div className="flex-1 flex flex-col">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}

            <div className="flex-1 bg-black rounded-lg overflow-hidden relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                onLoadedMetadata={() => {
                  console.log('Video ready, dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
                }}
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {parsing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}

              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 text-white animate-spin mx-auto mb-2" />
                    <p className="text-white text-sm">Initializing camera...</p>
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-2 text-center">
              Point camera at receipt • Auto-parsing every 3 seconds
            </p>
          </div>

          {/* Parsed items */}
          <div className="w-80 bg-gray-50 rounded-lg p-4 flex flex-col border border-gray-200">
            <h3 className="font-bold text-sm text-gray-900 mb-3">Parsed Items ({items.length})</h3>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {items.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">
                  Aim camera at receipt...
                </p>
              ) : (
                items.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white p-3 rounded border border-gray-200 flex items-start justify-between gap-2 group hover:border-red-300"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{item.receiptName}</p>
                      <p className="text-xs text-gray-600">
                        {item.quantity}x @ ${(item.totalPrice / item.quantity).toFixed(2)} = ${item.totalPrice.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {item.parsedAt.toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(idx)}
                      className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 px-4 text-sm font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || items.length === 0}
                className="flex-1 py-2 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Receipt'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
