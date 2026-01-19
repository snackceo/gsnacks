import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../constants';
import { useSearchParams } from 'react-router-dom';
import { analytics } from '../services/analyticsService';


export default function PaymentCancel() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<
    'idle' | 'missing' | 'releasing' | 'released' | 'failed'
  >('idle');

  useEffect(() => {
    // Track payment cancellation
    analytics.trackPayment('stripe', 'failed', undefined, 'User cancelled payment');
    
    const sessionId = String(params.get('session_id') || '').trim();
    if (!sessionId) {
      setStatus('missing');
      return;
    }

    setStatus('releasing');

    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/orders/release-reservation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus('released');
      } catch {
        setStatus('failed');
      }
    })();
  }, [params]);

  const message =
    status === 'missing'
      ? 'Missing session id. Inventory will restore when the session expires.'
      : status === 'releasing'
      ? 'Releasing reservation…'
      : status === 'released'
      ? 'Reservation released. Inventory restored.'
      : status === 'failed'
      ? 'Could not release reservation immediately. Inventory will restore when the session expires.'
      : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-ninpo-black text-white">
      <div className="text-center space-y-4 max-w-[520px] px-6">
        <h1 className="text-3xl font-black uppercase text-ninpo-red">
          Payment Cancelled
        </h1>

        <p className="text-xs uppercase tracking-widest opacity-70">
          No credits were deducted.
        </p>

        {message && (
          <p className="text-[10px] uppercase tracking-widest opacity-60">
            {message}
          </p>
        )}

        <a
          href="/"
          className="inline-block mt-6 px-6 py-3 bg-white/10 text-white rounded-xl font-black text-xs uppercase rounded-xl"
        >
          Return to Market
        </a>
      </div>
    </div>
  );
}
