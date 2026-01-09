import React, { useState, useRef } from 'react';
import { Order, OrderStatus } from '../types';
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  Zap,
  PackageCheck,
  Navigation2,
  UserCheck
} from 'lucide-react';

interface DriverViewProps {
  orders: Order[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
}

const DriverView: React.FC<DriverViewProps> = ({ orders, updateOrder }) => {
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleAccept = (orderId: string) => {
    // Owner is the driver for now
    updateOrder(orderId, OrderStatus.ASSIGNED, { driverId: 'OWNER' });
  };

  const handlePickUp = (orderId: string) => {
    updateOrder(orderId, OrderStatus.PICKED_UP);
  };

  const handleStartNavigation = (orderId: string) => {
    setIsNavigating(true);
    updateOrder(orderId, OrderStatus.ARRIVING);
    setTimeout(() => {
      setIsNavigating(false);
      alert('Navigation: You have arrived at the delivery address.');
    }, 5000);
  };

  const startVerification = async (order: Order) => {
    setActiveOrder(order);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch (e) {
      alert('Camera access is required for delivery proof.');
    }
  };

  const completeDelivery = () => {
    setIsVerifying(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const metadata = {
          deliveredAt: new Date().toISOString(),
          gpsCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          verificationPhoto: capturedPhoto || 'SIMULATED_PHOTO_HASH'
        };
        updateOrder(activeOrder!.id, OrderStatus.DELIVERED, metadata);
        setIsVerifying(false);
        setActiveOrder(null);
        setCapturedPhoto(null);
      },
      () => {
        alert('GPS is required to complete delivery.');
        setIsVerifying(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    setCapturedPhoto(canvas.toDataURL('image/jpeg'));
  };

  const queue = (orders || []).filter(o =>
    [OrderStatus.PENDING, OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.PICKED_UP, OrderStatus.ARRIVING].includes(
      o.status
    )
  );

  return (
    <div className="space-y-10 animate-in fade-in">
      <div className="bg-ninpo-midnight p-8 rounded-[3rem] border border-white/5 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl">
        <h2 className="text-2xl font-black uppercase tracking-tighter">Driver Dashboard</h2>
        <div className="flex gap-4">
          <div className="px-6 py-3 bg-ninpo-lime/10 rounded-2xl border border-ninpo-lime/20 flex items-center gap-3">
            <Zap className="w-4 h-4 text-ninpo-lime" />
            <p className="text-sm font-black text-ninpo-lime uppercase">STATUS: ON DUTY</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h3 className="text-white font-black uppercase text-xs tracking-widest flex items-center gap-3">
            <Clock className="w-4 h-4 text-ninpo-lime" /> Today&apos;s Deliveries
          </h3>

          {queue.map(o => (
            <div key={o.id} className="bg-ninpo-card border border-white/5 rounded-[2.5rem] p-8 space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black text-slate-600 uppercase">ORDER: {o.id}</p>
                  <p className="text-white font-black text-lg uppercase mt-1">
                    {o.address ? o.address : 'No address provided'}
                  </p>
                  <p className="text-[9px] font-black text-ninpo-lime uppercase mt-2 tracking-widest">
                    STATUS: {String(o.status).replace('_', ' ')}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                {(o.status === OrderStatus.PENDING || o.status === OrderStatus.PAID) && (
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

                {(o.status === OrderStatus.ARRIVING || o.status === OrderStatus.PICKED_UP) && (
                  <button
                    onClick={() => startVerification(o)}
                    className="flex-1 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> Proof of Delivery
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {activeOrder && (
          <div className="bg-ninpo-midnight p-10 rounded-[3rem] border border-ninpo-lime/20 shadow-neon space-y-8 animate-in slide-in-bottom">
            <h3 className="text-xl font-black uppercase tracking-tighter text-ninpo-lime">Delivery Confirmation</h3>

            <div className="relative aspect-video rounded-3xl overflow-hidden bg-ninpo-black">
              {capturedPhoto ? (
                <img src={capturedPhoto} className="w-full h-full object-cover" alt="Delivery proof" />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover grayscale opacity-50"
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex gap-4">
              <button
                onClick={takePhoto}
                className="flex-1 py-4 bg-white/5 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Capture Photo
              </button>

              {capturedPhoto && (
                <button
                  onClick={() => setCapturedPhoto(null)}
                  className="px-6 py-4 bg-ninpo-red/10 text-ninpo-red rounded-xl text-[10px] font-black uppercase"
                >
                  Retake
                </button>
              )}
            </div>

            <button
              disabled={!capturedPhoto || isVerifying}
              onClick={completeDelivery}
              className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-neon flex items-center justify-center gap-4 transition-all disabled:opacity-50"
            >
              {isVerifying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Complete Delivery <CheckCircle2 className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverView;
