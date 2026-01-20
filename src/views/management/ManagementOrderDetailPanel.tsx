import React, { useEffect, useState } from 'react';
import { AlertCircle, Eye, Image as ImageIcon, List, Signature } from 'lucide-react';
import { Order } from '../../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

interface NotFoundItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  originalStore: string;
  attemptedStores: string[];
  foundAt?: string;
  removedAt?: string;
}

interface Props {
  order: Order;
}

const ManagementOrderDetailPanel: React.FC<Props> = ({ order }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFoundItems, setNotFoundItems] = useState<NotFoundItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = localStorage.getItem('token');
        const res = await fetch(`${BACKEND_URL}/api/driver/order/${order.id}/items-not-found`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch items not found');
        const data = await res.json();
        if (!cancelled) setNotFoundItems(Array.isArray(data.itemsNotFound) ? data.itemsNotFound : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const hasProof = Boolean((order as any).deliveryProofPhoto || order.verificationPhoto || order.returnPhoto);
  const signature = (order as any).customerSignature as string | undefined;

  return (
    <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <List className="w-4 h-4 text-ninpo-lime" />
            <p className="text-[10px] font-black uppercase tracking-widest text-white/70">
              Items Not Found
            </p>
          </div>
          {loading ? (
            <p className="text-[11px] text-white/60">Loading…</p>
          ) : error ? (
            <div className="text-[11px] text-yellow-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          ) : notFoundItems.length === 0 ? (
            <p className="text-[11px] text-white/50">No tracked items.</p>
          ) : (
            <div className="space-y-2">
              {notFoundItems.map((n) => (
                <div key={n.sku} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-[12px] font-bold text-white">{n.name}</p>
                    <p className="text-[10px] text-white/60">SKU: {n.sku} • x{n.quantity} • {n.originalStore}</p>
                    {n.attemptedStores?.length > 0 && (
                      <p className="text-[10px] text-white/40 mt-1">Attempted: {n.attemptedStores.join(', ')}</p>
                    )}
                    {n.foundAt && (
                      <p className="text-[10px] text-ninpo-lime mt-1">Found at: {n.foundAt}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-white/60">${(n.price * n.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-ninpo-lime" />
            <p className="text-[10px] font-black uppercase tracking-widest text-white/70">
              Driver Proof
            </p>
          </div>
          {!hasProof && !signature ? (
            <p className="text-[11px] text-white/50">No proof or signature captured.</p>
          ) : (
            <div className="space-y-3">
              {(order as any).deliveryProofPhoto && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={(order as any).deliveryProofPhoto} alt="Delivery Proof" className="w-full h-auto" />
                </div>
              )}
              {order.verificationPhoto && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={order.verificationPhoto} alt="Verification Photo" className="w-full h-auto" />
                </div>
              )}
              {order.returnPhoto && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={order.returnPhoto} alt="Return Photo" className="w-full h-auto" />
                </div>
              )}
              {signature && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white/70 text-[10px] uppercase font-black tracking-widest">
                    <Signature className="w-4 h-4" /> Customer Signature
                  </div>
                  <div className="rounded-xl overflow-hidden border border-white/10 bg-white">
                    <img src={signature} alt="Customer Signature" className="w-full h-auto" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagementOrderDetailPanel;
