import { useEffect, useState } from 'react';
import { Order, OrderStatus } from '../types';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

function money(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return `$${v.toFixed(2)}`;
}

function PaymentSuccess({ clearCart }: { clearCart: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const isDelivered = order?.status === OrderStatus.DELIVERED;

  useEffect(() => {
    clearCart();
    try {
      localStorage.removeItem('ninpo_return_upcs_v1');
    } catch {
      // ignore
    }

    const fetchLatestOrder = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/orders`, {
          credentials: 'include'
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data?.orders) && data.orders.length) {
          setOrder(data.orders[0]);
        }
      } catch {
        // silent fail
      } finally {
        setLoading(false);
      }
    };

    fetchLatestOrder();
  }, [clearCart]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ninpo-black text-white px-6">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-3xl font-black uppercase text-ninpo-lime">
          {isDelivered ? 'Delivery Complete' : 'Order Authorized'}
        </h1>

        {isDelivered ? (
          <div className="text-xs uppercase tracking-widest opacity-70 space-y-2">
            <p>Your return value has been verified.</p>
            <p>Credits were applied to eligible charges and any remaining value posts to your account.</p>
            <p>Gold+ cash payouts are handled by the driver (up to $25/day when selected).</p>
          </div>
        ) : (
          <p className="text-xs uppercase tracking-widest opacity-70">
            Your payment is authorized. The driver will verify container returns at pickup, then
            the final amount is captured.
          </p>
        )}

        {loading && (
          <p className="text-xs uppercase tracking-widest opacity-50">Retrieving order details…</p>
        )}

        {order && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-3 text-xs">
            <p className="uppercase tracking-widest opacity-60">Order ID</p>
            <p className="font-black">{order.id}</p>

            <p className="uppercase tracking-widest opacity-60 mt-4">Estimated return credit (preview)</p>
            <p className="font-black text-ninpo-lime">{money(order.estimatedReturnCredit || 0)}</p>

            <p className="uppercase tracking-widest opacity-60 mt-4">Delivery fee</p>
            <p className="font-black">{money(order.deliveryFee || 0)}</p>

            <p className="uppercase tracking-widest opacity-60 mt-4">Order total (pre-credit)</p>
            <p className="font-black">{money(order.total)}</p>

            <p className="uppercase tracking-widest opacity-60 mt-4">Status</p>
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
