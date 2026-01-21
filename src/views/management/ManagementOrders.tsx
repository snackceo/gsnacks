import React, { useEffect, useState } from 'react';
import { Order, OrderStatus, ReturnUpcCount, User } from '../../types';
import ManagementOrderDetailPanel from './ManagementOrderDetailPanel';
import ManagementReceiptScanner from '../../components/ManagementReceiptScanner';
import {
  CheckCircle2,
  Loader2,
  Navigation2,
  PackageCheck,
  PackageX,
  RefreshCw,
  UserCheck,
  XCircle,
  Camera,
  Trash2
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

interface ReceiptCapture {
  _id: string;
  storeId: string;
  storeName: string;
  orderId?: string;
  status: string;
  imageCount: number;
  stats: {
    totalItems: number;
    itemsNeedingReview: number;
    itemsConfirmed: number;
    itemsCommitted: number;
  };
  createdAt: string;
  reviewExpiresAt?: string;
}

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
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});
  const [receiptCaptures, setReceiptCaptures] = useState<ReceiptCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);

  const toggleDetail = (id: string) =>
    setOpenDetail(prev => ({ ...prev, [id]: !prev[id] }));

  // Fetch receipt captures
  const fetchReceiptCaptures = async () => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-captures?status=pending_parse&status=parsed&status=review_complete&limit=20`, {
        credentials: 'include'
      });
      
      if (resp.ok) {
        const data = await resp.json();
        setReceiptCaptures(data.captures || []);
      }
    } catch (error) {
      console.error('Error fetching receipt captures:', error);
    }
  };

  // Delete a receipt capture
  const deleteReceiptCapture = async (captureId: string) => {
    if (!window.confirm('Delete this receipt? This cannot be undone.')) {
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/receipt-capture/${captureId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (resp.ok) {
        setReceiptCaptures(prev => prev.filter(c => c._id !== captureId));
        if (selectedCaptureId === captureId) {
          setSelectedCaptureId(null);
        }
      } else {
        alert('Failed to delete receipt');
      }
    } catch (error) {
      console.error('Error deleting receipt:', error);
      alert('Error deleting receipt');
    }
  };

  // Periodic refresh of orders for live updates
  useEffect(() => {
    const id = setInterval(() => {
      apiRefreshOrders();
      fetchReceiptCaptures();
    }, 30000);
    return () => clearInterval(id);
  }, [apiRefreshOrders]);

  // Initial fetch
  useEffect(() => {
    fetchReceiptCaptures();
  }, []);

  return (
    <div className="space-y-6">
      {/* Receipt Capture Quick Access */}
      <div className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-2xl p-6 border border-white/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Upload Receipt
            </h3>
            <p className="text-sm text-orange-100 mt-2">Capture and process a new receipt</p>
          </div>
          <div className="flex gap-3">
            <button
              disabled
              className="px-6 py-3 bg-gray-600 text-gray-400 rounded-lg font-bold text-sm flex items-center gap-2 transition-all opacity-50 cursor-not-allowed"
              title="Use scanner to capture receipts"
            >
              <Camera className="w-5 h-5" />
              Capture / Upload
            </button>
          </div>
        </div>
      </div>

      {/* Receipt Captures Section */}
      {receiptCaptures.length > 0 && (
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-6 border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-black uppercase text-white tracking-widest flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Receipt Scanner Queue
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-purple-100">
                {receiptCaptures.filter(c => c.status === 'parsed').length} pending review
              </span>
              <button
                onClick={() => {
                  setCaptureStoreId('');
                  setCaptureStoreName('Manual Entry');
                  setShowPhotoCapture(true);
                }}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
              >
                <Camera className="w-4 h-4" />
                New Receipt
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {receiptCaptures.slice(0, 6).map(capture => (
              <div
                key={capture._id}
                className="bg-white/10 backdrop-blur-sm rounded-lg p-4 hover:bg-white/20 transition-all border border-white/10 group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div 
                    onClick={() => setSelectedCaptureId(capture._id)}
                    className="flex-1 cursor-pointer"
                  >
                    <span className="text-white font-bold text-sm">{capture.storeName}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${
                      capture.status === 'parsed' ? 'bg-yellow-500 text-yellow-900' :
                      capture.status === 'review_complete' ? 'bg-green-500 text-green-900' :
                      'bg-gray-500 text-gray-900'
                    }`}>
                      {capture.status.replace(/_/g, ' ')}
                    </span>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteReceiptCapture(capture._id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/30 rounded text-red-400 hover:text-red-300"
                      title="Delete this receipt"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div 
                  onClick={() => setSelectedCaptureId(capture._id)}
                  className="cursor-pointer"
                >
                  <div className="text-xs text-purple-100 space-y-1">
                    <div>{capture.imageCount} photo{capture.imageCount !== 1 ? 's' : ''}</div>
                    <div>
                      {capture.stats.itemsConfirmed}/{capture.stats.totalItems} items confirmed
                    </div>
                    
                    {/* Workflow breakdown */}
                    {capture.workflowStats && (
                      <div className="flex items-center gap-2 mt-2">
                        {capture.workflowStats.newProducts > 0 && (
                          <span className="bg-orange-500/30 text-orange-200 text-xs px-2 py-1 rounded">
                            {capture.workflowStats.newProducts} NEW
                          </span>
                        )}
                        {capture.workflowStats.priceUpdates > 0 && (
                          <span className="bg-blue-500/30 text-blue-200 text-xs px-2 py-1 rounded">
                            {capture.workflowStats.priceUpdates} PRICES
                          </span>
                        )}
                      </div>
                    )}
                    
                    {capture.stats.itemsNeedingReview > 0 && (
                      <div className="text-yellow-300 font-semibold">
                        {capture.stats.itemsNeedingReview} need review
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-3 text-xs text-purple-200">
                    {new Date(capture.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Receipt Scanner Modal */}
      {selectedCaptureId && (
        <ManagementReceiptScanner
          captureId={selectedCaptureId}
          onClose={() => setSelectedCaptureId(null)}
          onCommit={() => {
            fetchReceiptCaptures();
            apiRefreshOrders();
          }}
        />
      )}

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
                      onClick={() => {
                        if (confirm(`Cancel order ${o.id}? Items will be restocked and order marked as closed.`)) {
                          handleLogisticsUpdate(o.id, OrderStatus.CLOSED);
                        }
                      }}
                      className="md:w-[240px] py-5 bg-ninpo-red/10 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
                    >
                      <XCircle className="w-5 h-5" /> Cancel (Restock)
                    </button>
                  )}
                </div>

                {/* Management Detail Panel: items-not-found and driver proof */}
                <div className="mt-4">
                  <button
                    onClick={() => toggleDetail(o.id)}
                    className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10"
                  >
                    {openDetail[o.id] ? 'Hide Driver Artifacts' : 'View Driver Artifacts'}
                  </button>
                  {openDetail[o.id] && (
                    <div className="mt-4">
                      <ManagementOrderDetailPanel order={o} />
                    </div>
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
