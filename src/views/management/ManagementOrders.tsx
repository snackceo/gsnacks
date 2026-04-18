import React, { useState, useEffect, useMemo } from 'react';
import { Order, OrderStatus, ReturnUpcCount, User } from '../../types';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  List,
  Loader2,
  Navigation2,
  PackageCheck,
  PackageX,
  RefreshCw,
  Signature,
  UserCheck,
  XCircle,
  ScanLine
} from 'lucide-react';
import { apiFetch } from '../../utils/apiFetch';

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

// Inlined detail panel component
const OrderDetailPanel: React.FC<{ order: Order }> = ({ order }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFoundItems, setNotFoundItems] = useState<NotFoundItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiFetch<{ itemsNotFound?: NotFoundItem[] }>(
          `/api/driver/order/${order.id}/items-not-found`
        );
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

interface ManagementOrdersProps {
  orders: Order[];
  users: User[];
  isRefreshingOrders: boolean;
  ordersError: string | null;
  apiRefreshOrders: () => void;
  handleLogisticsUpdate: (orderId: string, status: OrderStatus, metadata?: any) => void;
  canCancel: (o: Order) => boolean;
  fmtTime: (iso?: string) => string;
  countTotalUpcs: (entries: ReturnUpcCount[]) => number;
  openReturnProcessingScanner: () => void;
}

const ManagementOrders: React.FC<ManagementOrdersProps> = ({
  orders,
  users,
  isRefreshingOrders,
  ordersError,
  apiRefreshOrders,
  handleLogisticsUpdate,
  canCancel,
  fmtTime,
  countTotalUpcs,
  openReturnProcessingScanner
}) => {
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    for (const user of users) {
      map.set(user.id, user);
    }
    return map;
  }, [users]);
  const toggleDetail = (id: string) =>
    setOpenDetail(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
              <ScanLine className="w-5 h-5" />
              Return Processing
            </h3>
            <p className="text-sm text-emerald-100 mt-2">Scan containers for return verification</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={openReturnProcessingScanner}
              className="px-6 py-3 bg-white/20 hover:bg-white/30 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all"
              title="Scan return containers"
            >
              <ScanLine className="w-5 h-5" />
              Scan Returns
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Orders Feed
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            orderId • status • total • items • createdAt
          </p>
        </div>

        <button
          onClick={apiRefreshOrders}
          disabled={isRefreshingOrders}
          className="px-7 py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
        >
          {isRefreshingOrders ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <RefreshCw className="w-5 h-5" />
          )}
          Refresh Orders
        </button>
      </div>

      {ordersError && (
        <div className="bg-ninpo-card p-6 rounded-[2rem] border border-ninpo-red/20 text-[11px] text-ninpo-red">
          {ordersError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {orders.length === 0 ? (
          <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
            <PackageX className="w-12 h-12 text-slate-800 mb-4" />
            <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
              No Orders Found
            </p>
          </div>
        ) : (
          orders.map(o => {
            const estimatedGross = Number(
              o.estimatedReturnCreditGross ?? o.estimatedReturnCredit ?? 0
            );
            const estimatedNet = Number(o.estimatedReturnCredit || 0);
            const verifiedGross =
              o.verifiedReturnCreditGross !== undefined
                ? Number(o.verifiedReturnCreditGross || 0)
                : undefined;
            const verifiedNet =
              o.verifiedReturnCredit !== undefined
                ? Number(o.verifiedReturnCredit || 0)
                : undefined;
            const returnCounts = Array.isArray(o.returnUpcCounts) ? o.returnUpcCounts : [];
            const verifiedCounts = Array.isArray(o.verifiedReturnUpcCounts)
              ? o.verifiedReturnUpcCounts
              : [];
            const returnCountTotal = countTotalUpcs(returnCounts);
            const verifiedCountTotal = countTotalUpcs(verifiedCounts);
            const customer = o.customerId ? userMap.get(o.customerId) : undefined;

            return (
              <div
                key={o.id}
                className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                  <div>
                    <p className="text-[10px] font-black text-slate-600 uppercase">
                      ORDER: {o.id}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mt-4">
                      <span className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                        {fmtTime(o.createdAt)}
                      </span>

                      <span
                        className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest ${
                          o.status === OrderStatus.PAID
                            ? 'text-blue-400 border-blue-400/20 bg-blue-400/5'
                            : o.status === OrderStatus.AUTHORIZED
                            ? 'text-cyan-300 border-cyan-300/20 bg-cyan-300/5'
                            : o.status === OrderStatus.CLOSED
                            ? 'text-slate-400 border-slate-400/20 bg-slate-400/5'
                            : 'text-ninpo-lime border-ninpo-lime/20 bg-ninpo-lime/5'
                        }`}
                      >
                        {String(o.status).replace('_', ' ')}
                      </span>

                      {o.driverId && (
                        <span className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/70 border-white/10 bg-white/5">
                          DRIVER: {o.driverId}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 mt-4">
                      CustomerId:{' '}
                      <span className="text-slate-300 font-bold">
                        {o.customerId}
                        {customer && <span className="text-slate-400 ml-2">({customer.username})</span>}
                      </span>
                    </p>

                    {o.address && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Address: <span className="text-slate-300 font-bold">{o.address}</span>
                      </p>
                    )}
                  </div>

                  <div className="md:text-right space-y-2">
                    <p className="text-white font-black text-2xl tracking-tighter">
                      ${Number(o.total || 0).toFixed(2)}
                    </p>

                    <p className="text-[10px] font-bold text-slate-700 uppercase">
                      {o.items.length} LINE ITEMS
                    </p>

                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 space-y-1">
                      <div className="flex items-center justify-between md:justify-end md:gap-3">
                        <span className="md:hidden">Route Fee:</span>
                        <span className="text-slate-300">
                          Route Fee: ${Number(o.routeFee || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between md:justify-end md:gap-3">
                        <span className="md:hidden">Est Credit:</span>
                        <span className="text-slate-300">
                          Est Credit: ${estimatedNet.toFixed(2)}
                          {estimatedGross !== estimatedNet
                            ? ` (gross $${estimatedGross.toFixed(2)})`
                            : ''}
                        </span>
                      </div>

                      <div className="flex items-center justify-between md:justify-end md:gap-3">
                        <span className="md:hidden">Verified:</span>
                        <span className="text-slate-300">
                          Verified:{' '}
                          {verifiedNet === undefined
                            ? '—'
                            : `$${verifiedNet.toFixed(2)}`}
                          {verifiedNet !== undefined &&
                          verifiedGross !== undefined &&
                          verifiedGross !== verifiedNet
                            ? ` (gross $${verifiedGross.toFixed(2)})`
                            : ''}
                        </span>
                      </div>

                      <div className="flex items-center justify-between md:justify-end md:gap-3">
                        <span className="md:hidden">Final Charged:</span>
                        <span className="text-slate-300">
                          Final Charged:{' '}
                          {o.capturedAmount === undefined
                            ? 'Not captured'
                            : o.capturedAmount === 0
                            ? '$0.00 (voided)'
                            : `$${Number(o.capturedAmount || 0).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Items
                  </p>

                  <div className="space-y-2">
                    {o.items.map((it, idx) => (
                      <div
                        key={`${o.id}-${idx}`}
                        className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-5 py-4"
                      >
                        <span className="text-[11px] text-slate-200 font-bold">
                          {it.productId}
                        </span>
                        <span className="text-[11px] text-slate-500 font-black">
                          x{it.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-6 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    Return UPCs
                  </p>
                  <div className="flex flex-col md:flex-row gap-6">
                    <div className="flex-1 space-y-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Submitted: <span className="text-slate-200">{returnCountTotal}</span>
                      </div>
                      {returnCounts.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {returnCounts.map(entry => (
                            <span
                              key={`return-${o.id}-${entry.upc}`}
                              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold text-slate-200"
                            >
                              {entry.upc} × {entry.quantity}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">
                          No return UPCs.
                        </p>
                      )}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Verified: <span className="text-slate-200">{verifiedCountTotal}</span>
                      </div>
                      {verifiedCounts.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {verifiedCounts.map(entry => (
                            <span
                              key={`verified-${o.id}-${entry.upc}`}
                              className="px-3 py-2 rounded-xl bg-ninpo-lime/10 border border-ninpo-lime/20 text-[10px] font-bold text-ninpo-lime"
                            >
                              {entry.upc} × {entry.quantity}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">
                          No verified UPCs.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4 border-t border-white/5 pt-6">
                  {(o.status === OrderStatus.PENDING ||
                    o.status === OrderStatus.AUTHORIZED ||
                    o.status === OrderStatus.ASSIGNED) && (
                    <button
                      className="flex-1 px-6 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3"
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.PAID)}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Mark Paid
                    </button>
                  )}

                  {(o.status === OrderStatus.PAID || o.status === OrderStatus.ASSIGNED) && (
                    <button
                      className="flex-1 px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3"
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.ARRIVING)}
                    >
                      <Navigation2 className="w-4 h-4" />
                      Out for Delivery
                    </button>
                  )}

                  {o.status === OrderStatus.ARRIVING && (
                    <button
                      className="flex-1 px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3"
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.DELIVERED)}
                    >
                      <UserCheck className="w-4 h-4" />
                      Mark Delivered
                    </button>
                  )}

                  {o.status === OrderStatus.DELIVERED && (
                    <button
                      className="flex-1 px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3"
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.CLOSED)}
                    >
                      <PackageCheck className="w-4 h-4" />
                      Close Order
                    </button>
                  )}

                  {canCancel(o) && (
                    <button
                      className="flex-1 px-6 py-4 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20"
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.REFUND_REQUESTED)}
                    >
                      <XCircle className="w-4 h-4" />
                      Cancel
                    </button>
                  )}
                </div>

                <div className="pt-6 border-t border-white/5">
                  <button
                    className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition"
                    onClick={() => o.id && toggleDetail(o.id)}
                  >
                    {openDetail[o.id] ? 'Hide Details' : 'View Details'}
                  </button>

                  {openDetail[o.id] && <OrderDetailPanel order={o} />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ManagementOrders;
