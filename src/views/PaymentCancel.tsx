import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

function PaymentCancel() {
  const [params] = useSearchParams();
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    const sessionId = String(params.get('session_id') || '').trim();

    // If we don't have a session id, we cannot release inventory immediately.
    if (!sessionId) {
      setNote('No session id found. Inventory may restore when the session expires.');
      return;
    }

    // Best-effort: release reservation immediately (Option A).
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/orders/release-reservation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId })
        });

        if (!res.ok) throw new Error(`release failed (${res.status})`);
        setNote('Reservation released. Inventory restored.');
      } catch {
        // Do not hard-fail the cancel page; keep it calm.
        setNote('Unable to release reservation immediately. Inventory may restore when the session expires.');
      }
    })();
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ninpo-black text-white">
      <div className="text-center space-y-4 max-w-[520px] px-6">
        <h1 className="text-3xl font-black uppercase text-ninpo-red">
          Payment Cancelled
        </h1>

        <p className="text-xs uppercase tracking-widest opacity-70">
          No credits were deducted.
        </p>

        {note && (
          <p className="text-[10px] uppercase tracking-widest opacity-60">
            {note}
          </p>
        )}

        <a
          href="/"
          className="inline-block mt-6 px-6 py-3 bg-white/10 text-white rounded-xl font-black text-xs uppercase"
        >
          Return to Market
        </a>
      </div>
    </div>
  );
}

export default PaymentCancel;
