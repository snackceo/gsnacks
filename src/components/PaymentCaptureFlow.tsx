import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, DollarSign, Shield } from 'lucide-react';

interface PaymentCaptureFlowProps {
  orderId: string;
  amountDue: number;
  customerName?: string;
  currency?: string;
  onSubmit?: (payload: {
    orderId: string;
    tip: number;
    paymentMethod: 'card' | 'cash';
    totalCollected: number;
    notes?: string;
  }) => Promise<void> | void;
  onClose?: () => void;
}

const presetTips = [0, 2, 5, 7, 10];

const PaymentCaptureFlow: React.FC<PaymentCaptureFlowProps> = ({
  orderId,
  amountDue,
  customerName,
  currency = 'USD',
  onSubmit,
  onClose
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');
  const [tip, setTip] = useState<number>(0);
  const [customTip, setCustomTip] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const displayCurrency = currency.toUpperCase();
  const total = useMemo(() => amountDue + tip, [amountDue, tip]);

  const handleCustomTip = (val: string) => {
    setCustomTip(val);
    const parsed = parseFloat(val);
    setTip(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError(null);
      if (onSubmit) {
        await onSubmit({ orderId, tip, paymentMethod, totalCollected: total, notes: notes || undefined });
      }
      setConfirmed(true);
      setTimeout(() => onClose?.(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to capture payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-white">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs uppercase text-white/60 font-bold mb-1">Collect Payment</p>
          <h3 className="text-xl font-black">Order {orderId.slice(0, 8)}</h3>
          {customerName && <p className="text-white/60 text-sm">{customerName}</p>}
        </div>
        <div className="flex items-center gap-2 text-ninpo-lime">
          <Shield className="w-5 h-5" />
          <span className="text-xs font-bold uppercase">Secure</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="bg-black/40 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-white/60 uppercase font-bold mb-1">Amount Due</p>
          <p className="text-2xl font-black text-ninpo-lime">{displayCurrency} {amountDue.toFixed(2)}</p>
          <p className="text-xs text-white/60 mt-1">Includes taxes and fees</p>
        </div>
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-ninpo-lime" />
            <span className="text-sm font-bold">Tip</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {presetTips.map((p) => (
              <button
                key={p}
                onClick={() => { setTip(p); setCustomTip(''); }}
                className={`py-2 rounded-lg text-sm font-bold border transition-all ${tip === p && customTip === '' ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
              >
                +{displayCurrency} {p}
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0"
            step="0.5"
            value={customTip}
            placeholder="Custom tip"
            onChange={(e) => handleCustomTip(e.target.value)}
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="bg-black/40 border border-white/10 rounded-lg p-4">
          <p className="text-xs uppercase text-white/60 font-bold mb-1">Payment Method</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod('card')}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg border transition-all ${paymentMethod === 'card' ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
            >
              <CreditCard className="w-4 h-4" /> Card
            </button>
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg border transition-all ${paymentMethod === 'cash' ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
            >
              <DollarSign className="w-4 h-4" /> Cash
            </button>
          </div>
          <p className="text-xs text-white/60 mt-2">
            For cash, confirm funds received. For card, proceed in your POS or companion app, then confirm here.
          </p>
        </div>
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">Amount</span>
            <span className="font-bold">{displayCurrency} {amountDue.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">Tip</span>
            <span className="font-bold">{displayCurrency} {tip.toFixed(2)}</span>
          </div>
          <div className="border-t border-white/10 pt-2 flex items-center justify-between text-base font-black">
            <span>Total to Collect</span>
            <span className="text-ninpo-lime">{displayCurrency} {total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs uppercase text-white/60 font-bold mb-1 block">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any payment details or customer instructions..."
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40"
        />
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-900/30 border border-red-600 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}

      {confirmed ? (
        <div className="flex items-center gap-2 text-ninpo-lime font-bold">
          <CheckCircle2 className="w-5 h-5" /> Payment recorded
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest disabled:opacity-50 transition-all"
          >
            {submitting ? 'Recording...' : 'Confirm Collection'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest"
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentCaptureFlow;
