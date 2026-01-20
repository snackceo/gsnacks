import React, { useRef, useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2, Trash2 } from 'lucide-react';

interface SignaturePadProps {
  orderId: string;
  onSign: (signatureBase64: string, name: string) => void;
  onClose: () => void;
}

const SignaturePad: React.FC<SignaturePadProps> = ({ orderId, onSign, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    initializeCanvas();
  }, []);

  const initializeCanvas = () => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#CCFF00'; // ninpo-lime
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const x = ((e as any).touches?.[0]?.clientX || (e as React.MouseEvent).clientX) - rect.left;
    const y = ((e as any).touches?.[0]?.clientY || (e as React.MouseEvent).clientY) - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const x = ((e as any).touches?.[0]?.clientX || (e as React.MouseEvent).clientX) - rect.left;
    const y = ((e as any).touches?.[0]?.clientY || (e as React.MouseEvent).clientY) - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.closePath();
    }
  };

  const clearSignature = () => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
    }
    setHasSignature(false);
  };

  const submitSignature = async () => {
    if (!canvasRef.current || !customerName.trim() || !hasSignature) {
      return;
    }

    setUploading(true);
    try {
      const signatureData = canvasRef.current.toDataURL('image/png');
      onSign(signatureData, customerName.trim());
    } catch (err) {
      console.error('Failed to submit signature', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white/5 border-b border-white/10 p-4 flex items-center justify-between">
        <div>
          <h1 className="font-black text-ninpo-lime">Customer Signature</h1>
          <p className="text-sm text-white/60">Order {orderId.slice(0, 12)}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-all"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Signature Canvas */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <label className="text-sm font-bold text-white/70 block mb-3">
            Draw your signature below
          </label>
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="w-full border-2 border-ninpo-lime/30 rounded-2xl bg-black/30 cursor-crosshair touch-none"
            style={{ height: '300px' }}
          />
        </div>
      </div>

      {/* Name Input and Controls */}
      <div className="bg-white/5 border-t border-white/10 p-6 space-y-4">
        <div>
          <label className="text-xs text-white/60 uppercase font-bold block mb-2">
            Customer Name
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Enter customer name"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-ninpo-lime"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={clearSignature}
            className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold uppercase text-sm transition-all flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
          <button
            onClick={submitSignature}
            disabled={uploading || !hasSignature || !customerName.trim()}
            className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirm Signature
              </>
            )}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl font-bold text-sm uppercase transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;
