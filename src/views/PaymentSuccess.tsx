import { useEffect, useState } from 'react';
import { useNinpoCore } from '../hooks/useNinpoCore';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

function PaymentSuccess() {
  const { clearCart } = useNinpoCore();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Clear cart ONCE
    clearCart();

    const fetchLatestOrder = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/orders`, {
          credentials: 'include'
        });

        const data = await res.json();
        if (data?.orders?.length) {
          setOrder(data.orders[0]); // newest order (sorted desc in backend)
        }
      } catch {
        // silent fail; UI still works
      } finally {
        setLoading(false);
      }
    };

    fetchLatestOrder();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ninpo-black text-white px-6">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-3xl font-black uppercase text-ninpo-lime">
          Payment Complete
        </h1>

        <p className="text-xs uppercase tracking-widest opacity-70">
          Order confirmed. Preparing for delivery.
        </p>

        {loading && (
          <p className="text-xs uppercase tracking-widest opacity-50">
            Retrieving order details…
          </p>
        )}

        {order && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3 text-xs">
            <p className="uppercase tracking-widest opacity-60">
              Order ID
            </p>
            <p className="font-black">{order.id}</p>

            <p className="uppercase tracking-widest opacity-60 mt-4">
              Total
            </p>
            <p className="font-black text-ninpo-lime">
              ${Number(order.total).toFixed(2)}
            </p>

            <p className="uppercase tracking-widest opacity-60 mt-4">
              Status
            </p>
            <p className="font-black">{order.status}</p>
          </div>
        )}

        <a
          href="/"
          className="inline-block mt-6 px-8 py-4 bg-ninpo-lime text-black rounded-xl font-black text-xs uppercase tracking-widest"
        >
          Return to Market
        </a>
      </div>
    </div>
  );
}

export default PaymentSuccess;
