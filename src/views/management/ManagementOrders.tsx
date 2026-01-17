import React from 'react';
import { Order, OrderStatus, ReturnUpcCount, User } from '../../types';
import {
  CheckCircle2,
  Loader2,
  Navigation2,
  PackageCheck,
  PackageX,
  RefreshCw,
  UserCheck,
  XCircle
} from 'lucide-react';

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
  countTotalUpcs
}) => {
  return (
    <div className="space-y-6">
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
                      <span className="text-slate-300 font-bold">{o.customerId}</span>
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
                          Route Fee: ${Number(o.routeFee || o.deliveryFee || 0).toFixed(2)}
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
                    o.status === OrderStatus.PAID) && (
                    <button
                      onClick={() =>
                        handleLogisticsUpdate(o.id, OrderStatus.ASSIGNED, {
                          driverId: users?.username || users?.id || 'OWNER'
                        })
                      }
                      className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                    >
                      <UserCheck className="w-5 h-5" /> Assign to Me
                    </button>
                  )}

                  {o.status === OrderStatus.ASSIGNED && (
                    <button
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.PICKED_UP)}
                      className="flex-1 py-5 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all"
                    >
                      <PackageCheck className="w-5 h-5" /> Mark Picked Up
                    </button>
                  )}

                  {o.status === OrderStatus.PICKED_UP && (
                    <button
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.ARRIVING)}
                      className="flex-1 py-5 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all"
                    >
                      <Navigation2 className="w-5 h-5" /> Mark Arriving
                    </button>
                  )}

                  {o.status === OrderStatus.ARRIVING && (
                    <button
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.DELIVERED)}
                      className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                    >
                      <CheckCircle2 className="w-5 h-5" /> Mark Delivered
                    </button>
                  )}

                  {canCancel(o) && (
                    <button
                      onClick={() => handleLogisticsUpdate(o.id, OrderStatus.CLOSED)}
                      className="md:w-[240px] py-5 bg-ninpo-red/10 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                    >
                      <XCircle className="w-5 h-5" /> Cancel (Restock)
                    </button>
                  )}
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
