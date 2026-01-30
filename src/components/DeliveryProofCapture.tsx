import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { updateVideoReadyState } from '../utils/videoReady';

interface DeliveryProofCaptureProps {
  orderId: string;
  onCapture: (photoBase64: string) => void;
  onClose: () => void;
}

const DeliveryProofCapture: React.FC<DeliveryProofCaptureProps> = ({
  orderId,
  onCapture,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoReadyHandlerRef = useRef<(() => void) | null>(null);
  const videoDataHandlerRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [mode, setMode] = useState<'camera' | 'capture' | 'preview'>('camera');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [streamActive, setStreamActive] = useState(false);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        const videoEl = videoRef.current;
        videoEl.srcObject = stream;
        setStreamActive(false);
        updateVideoReadyState({
          videoEl,
          onReady: () => setStreamActive(true),
          metadataHandlerRef: videoReadyHandlerRef,
          dataHandlerRef: videoDataHandlerRef
        });
      }
    } catch (err) {
      setError('Camera access denied. Please enable camera permissions.');
    }
  };

  const stopCamera = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      if (videoReadyHandlerRef.current) {
        videoRef.current.removeEventListener('loadedmetadata', videoReadyHandlerRef.current);
        videoReadyHandlerRef.current = null;
      }
      if (videoDataHandlerRef.current) {
        videoRef.current.removeEventListener('loadeddata', videoDataHandlerRef.current);
        videoDataHandlerRef.current = null;
      }
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const photoData = canvas.toDataURL('image/jpeg', 0.9);
        setPhoto(photoData);
        setMode('preview');
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const photoData = event.target?.result as string;
        setPhoto(photoData);
        setMode('preview');
      };
      reader.readAsDataURL(file);
    }
  };

  const confirmCapture = async () => {
    if (photo) {
      setUploading(true);
      try {
        onCapture(photo);
      } catch (err) {
        setError('Failed to upload photo');
      } finally {
        setUploading(false);
      }
    }
  };

  const retakePhoto = () => {
    setPhoto(null);
    setMode('camera');
  };

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white/5 border-b border-white/10 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Camera className="w-5 h-5 text-ninpo-lime" />
          <div>
            <h1 className="font-black text-ninpo-lime">Delivery Proof</h1>
            <p className="text-sm text-white/60">Order {orderId.slice(0, 12)}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-all"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Camera or Preview */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {mode === 'camera' && streamActive ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full max-w-2xl rounded-2xl aspect-video object-cover bg-black"
            />
            <canvas ref={canvasRef} className="hidden" />
          </>
        ) : mode === 'preview' && photo ? (
          <img
            src={photo}
            alt="Delivery Proof"
            className="w-full max-w-2xl rounded-2xl aspect-video object-cover"
          />
        ) : (
          <div className="text-center">
            <Camera className="w-16 h-16 text-white/30 mx-auto mb-4" />
            <p className="text-white/60">Preparing camera...</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white/5 border-t border-white/10 p-6 space-y-4">
        {mode === 'camera' && streamActive && (
          <button
            onClick={capturePhoto}
            className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" />
            Capture Photo
          </button>
        )}

        {mode === 'preview' && photo && (
          <div className="space-y-3">
            <button
              onClick={confirmCapture}
              disabled={uploading}
              className="w-full py-4 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Confirm & Submit
                </>
              )}
            </button>
            <button
              onClick={retakePhoto}
              className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
            >
              Retake Photo
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm uppercase transition-all"
          >
            Upload from Gallery
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm uppercase transition-all"
          >
            Close
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
};

export default DeliveryProofCapture;
