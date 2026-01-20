import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  MapPin,
  Navigation2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Package,
  Camera,
  Signature,
  DollarSign
} from 'lucide-react';
import DriverRealTimeNavigation from './DriverRealTimeNavigation';
import PaymentCaptureFlow from './PaymentCaptureFlow';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

interface DriverOrderFlowProps {
  order: any;
  onBack: () => void;
  onRefresh: () => void;
}

const DriverOrderFlow: React.FC<DriverOrderFlowProps> = ({ order, onBack, onRefresh }) => {
  const [shoppingList, setShoppingList] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'accept' | 'pickup' | 'navigate' | 'deliver'>('accept');
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [customerSignature, setCustomerSignature] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState<string>('');
  const [showNavigation, setShowNavigation] = useState(false);
  const [paymentCaptured, setPaymentCaptured] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    if (order?.status === 'ASSIGNED') setStep('pickup');
    else if (order?.status === 'PICKED_UP') setStep('navigate');
    else if (order?.status === 'ARRIVING') setStep('deliver');
  }, [order?.status]);

  const fetchShoppingList = async () => {
    try {
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      const res = await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/shopping-list`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setShoppingList(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch shopping list', err);
    }
  };

  useEffect(() => {
    fetchShoppingList();
  }, [order?.orderId, order?.id]);

  const handleAccept = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      const res = await fetch(`${BACKEND_URL}/api/driver/accept-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ orderId })
      });
      if (res.ok) {
        setStep('pickup');
        onRefresh();
      } else {
        setError((await res.json()).error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept order');
    } finally {
      setLoading(false);
    }
  };

  const handlePickup = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      const res = await fetch(`${BACKEND_URL}/api/driver/pickup-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ orderId })
      });
      if (res.ok) {
        setStep('navigate');
        onRefresh();
      } else {
        setError((await res.json()).error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pickup order');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDelivery = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      const res = await fetch(`${BACKEND_URL}/api/driver/start-delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ orderId })
      });
      if (res.ok) {
        setStep('deliver');
        onRefresh();
        setShowNavigation(true);
      } else {
        setError((await res.json()).error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start delivery');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoFile = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setDeliveryPhoto(result);
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoFile(file);
  };

  const handleSignatureStart = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawingRef.current = true;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSignatureMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPos(e, canvas);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#b7ff2c';
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const handleSignatureEnd = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    setCustomerSignature(data);
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCustomerSignature(null);
  };

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handlePaymentCapture = async (_payload: {
    orderId: string;
    tip: number;
    paymentMethod: 'card' | 'cash';
    totalCollected: number;
    notes?: string;
  }) => {
    setPaymentCaptured(true);
  };

  const handleCompleteDelivery = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      const res = await fetch(`${BACKEND_URL}/api/driver/complete-delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId,
          deliveryPhoto,
          customerSignature: customerSignature || signatureName
        })
      });
      if (res.ok) {
        alert('Delivery completed! Thank you!');
        onRefresh();
        onBack();
      } else {
        setError((await res.json()).error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete delivery');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white overflow-y-auto z-50">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8 pt-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/10 rounded-lg transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-ninpo-lime">Order {(order?.orderId || order?.id)?.slice(0, 8)}</h1>
            <p className="text-white/60">{order?.status}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Order Info */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs text-white/60 uppercase font-bold mb-1">Total</p>
              <p className="text-2xl font-black text-ninpo-lime">${order?.total?.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-white/60 uppercase font-bold mb-1">Items</p>
              <p className="text-2xl font-black text-white">{order?.items?.length || 0}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-white/60 uppercase font-bold mb-1">Delivery Address</p>
            <p className="text-sm flex items-start gap-2">
              <MapPin className="w-4 h-4 text-ninpo-lime mt-0.5 flex-shrink-0" />
              {order?.address}
            </p>
          </div>
        </div>

        {/* Shopping List */}
        {shoppingList?.shoppingList && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-black text-ninpo-lime mb-4 flex items-center gap-2">
              <Package className="w-5 h-5" />
              Shopping List ({shoppingList.itemCount} items)
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {shoppingList.shoppingList.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="flex-1">{item.name} x{item.quantity}</span>
                  <span className="text-ninpo-lime font-bold">${(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workflow Steps */}
        <div className="space-y-4 mb-6">
          {/* Step 1: Accept */}
          {step === 'accept' && (
            <div className="bg-gradient-to-br from-blue-500/20 to-blue-500/5 border border-blue-500/30 rounded-xl p-6">
              <h3 className="text-lg font-black text-blue-300 mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                Accept Order
              </h3>
              <p className="text-white/70 mb-4">
                Accept this order to add it to your queue. You'll pick it up from the store and deliver to the customer.
              </p>
              <button
                onClick={handleAccept}
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-black uppercase tracking-widest disabled:opacity-50 transition-all"
              >
                {loading ? 'Accepting...' : 'Accept Order'}
              </button>
            </div>
          )}

          {/* Step 2: Pickup */}
          {(step === 'pickup' || step === 'navigate' || step === 'deliver') && (
            <div className={`border rounded-xl p-6 ${step === 'pickup' ? 'bg-purple-500/20 border-purple-500/30' : 'bg-white/5 border-white/10'}`}>
              <h3 className={`text-lg font-black mb-4 flex items-center gap-2 ${step === 'pickup' ? 'text-purple-300' : 'text-white/60'}`}>
                <Package className="w-5 h-5" />
                Pick Up Items
              </h3>
              {step === 'pickup' && (
                <>
                  <p className="text-white/70 mb-4">
                    Go to the store(s) and collect all items listed above. Check quantities carefully!
                  </p>
                  <button
                    onClick={handlePickup}
                    disabled={loading}
                    className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                  >
                    {loading ? 'Marking...' : 'Mark as Picked Up'}
                  </button>
                </>
              )}
              {step !== 'pickup' && (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  Completed
                </div>
              )}
            </div>
          )}

          {/* Step 3: Navigate */}
          {(step === 'navigate' || step === 'deliver') && (
            <div className={`border rounded-xl p-6 ${step === 'navigate' ? 'bg-green-500/20 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
              <h3 className={`text-lg font-black mb-4 flex items-center gap-2 ${step === 'navigate' ? 'text-green-300' : 'text-white/60'}`}>
                <Navigation2 className="w-5 h-5" />
                Navigate to Customer
              </h3>
              {step === 'navigate' && (
                <>
                  <p className="text-white/70 mb-4">
                    Drive to the delivery address. You can use your preferred navigation app (Google Maps, Waze, etc.)
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={() => setShowNavigation(true)}
                      className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
                    >
                      Open Live Navigation
                    </button>
                    <button
                      onClick={handleStartDelivery}
                      disabled={loading}
                      className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                    >
                      {loading ? 'Starting...' : 'I\'ve Arrived!'}
                    </button>
                  </div>
                </>
              )}
              {step !== 'navigate' && (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  Completed
                </div>
              )}
            </div>
          )}

          {/* Step 4: Complete Delivery */}
          {step === 'deliver' && (
            <div className="bg-ninpo-lime/20 border border-ninpo-lime/30 rounded-xl p-6">
              <h3 className="text-lg font-black text-ninpo-lime mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Complete Delivery
              </h3>

              <div className="space-y-4 mb-4">
                {/* Photo */}
                <div className="bg-white/5 rounded-lg p-4">
                  <label className="text-sm font-bold text-white/80 flex items-center gap-2 mb-2">
                    <Camera className="w-4 h-4" />
                    Delivery Photo (Optional)
                  </label>
                  {deliveryPhoto ? (
                    <div className="relative">
                      <img src={deliveryPhoto} alt="Delivery proof" className="w-full rounded-lg" />
                      <button
                        onClick={() => setDeliveryPhoto(null)}
                        className="absolute top-2 right-2 bg-red-600 text-white p-2 rounded-lg"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => photoInputRef.current?.click()}
                        className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-bold transition-all"
                      >
                        Upload / Take Photo
                      </button>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handlePhotoChange}
                      />
                    </div>
                  )}
                </div>

                {/* Signature */}
                <div className="bg-white/5 rounded-lg p-4">
                  <label className="text-sm font-bold text-white/80 flex items-center gap-2 mb-2">
                    <Signature className="w-4 h-4" />
                    Customer Signature (Optional)
                  </label>
                  <div className="space-y-2">
                    <canvas
                      ref={signatureCanvasRef}
                      width={600}
                      height={180}
                      className="w-full bg-black/40 border border-white/10 rounded-lg"
                      onMouseDown={handleSignatureStart}
                      onMouseMove={handleSignatureMove}
                      onMouseUp={handleSignatureEnd}
                      onMouseLeave={handleSignatureEnd}
                      onTouchStart={handleSignatureStart}
                      onTouchMove={handleSignatureMove}
                      onTouchEnd={handleSignatureEnd}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={clearSignature}
                        className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-bold"
                      >
                        Clear
                      </button>
                      <input
                        type="text"
                        placeholder="Name (optional)"
                        value={signatureName}
                        onChange={(e) => setSignatureName(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-white/80 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Payment Capture
                  </span>
                  {paymentCaptured && (
                    <span className="text-xs bg-ninpo-lime/20 text-ninpo-lime px-2 py-1 rounded-full font-bold">Recorded</span>
                  )}
                </div>
                <PaymentCaptureFlow
                  orderId={order?.orderId || order?.id || ''}
                  amountDue={order?.total || 0}
                  customerName={order?.customerName || ''}
                  onSubmit={handlePaymentCapture}
                />
              </div>

              <button
                onClick={handleCompleteDelivery}
                disabled={loading}
                className="w-full py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest disabled:opacity-50 transition-all"
              >
                {loading ? 'Completing...' : 'Complete Delivery'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showNavigation && (
        <DriverRealTimeNavigation
          address={order?.address || ''}
          onClose={() => setShowNavigation(false)}
        />
      )}
    </div>
  );
};

export default DriverOrderFlow;
