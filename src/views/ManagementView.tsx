import React, { useState } from 'react';
import {
  User,
  Product,
  Order,
  OrderStatus,
  AppSettings,
  ApprovalRequest,
  AuditLog
} from '../types';
import {
  Truck,
  Package,
  Users,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  BrainCircuit,
  Loader2,
  UserCircle,
  Terminal,
  Sliders,
  AlertTriangle,
  ShieldAlert,
  Navigation2,
  PackageCheck,
  Eye,
  EyeOff,
  PackageX,
  Plus
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { getAdvancedInventoryInsights } from '../services/geminiService';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

interface ManagementViewProps {
  user: User;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  orders: Order[];
  users: User[];
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  approvals: ApprovalRequest[];
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  auditLogs: AuditLog[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
  adjustCredits: (userId: string, amount: number, reason: string) => void;
  updateUserProfile: (id: string, updates: Partial<User>) => void;
}

const ManagementView: React.FC<ManagementViewProps> = ({
  products,
  setProducts,
  orders,
  users,
  settings,
  setSettings,
  approvals,
  setApprovals,
  auditLogs,
  updateOrder,
  adjustCredits
}) => {
  const [activeModule, setActiveModule] = useState<string>('analytics');
  const [isAuditing, setIsAuditing] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Inventory create form
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({
    id: '',
    name: '',
    price: 0,
    stock: 0,
    category: 'DRINK',
    image: '',
    isGlass: false
  });

  const chartData = orders
    .slice(0, 15)
    .map(o => ({
      name: o.id.slice(-4),
      revenue: o.total
    }))
    .reverse();

  const handleApprove = (approval: ApprovalRequest) => {
    adjustCredits(approval.userId, approval.amount, `AUTH_APPROVED: ${approval.type}`);

    setApprovals(prev =>
      prev.map(a =>
        a.id === approval.id
          ? { ...a, status: 'APPROVED', processedAt: new Date().toISOString() }
          : a
      )
    );

    if (approval.type === 'REFUND' && approval.orderId) {
      updateOrder(approval.orderId, OrderStatus.REFUNDED);
    }
  };

  const handleReject = (id: string) => {
    setApprovals(prev =>
      prev.map(a =>
        a.id === id
          ? { ...a, status: 'REJECTED', processedAt: new Date().toISOString() }
          : a
      )
    );
  };

  const handleLogisticsUpdate = (orderId: string, status: OrderStatus) => {
    updateOrder(orderId, status);
  };

  // ---- Inventory API ----
  const apiCreateProduct = async () => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: newProduct.id.trim(),
          name: newProduct.name.trim(),
          price: Number(newProduct.price),
          stock: Number(newProduct.stock),
          category: newProduct.category,
          image: newProduct.image,
          isGlass: !!newProduct.isGlass
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create failed');

      const created: Product = data.product;
      setProducts(prev => [created, ...prev]);

      setNewProduct({
        id: '',
        name: '',
        price: 0,
        stock: 0,
        category: 'DRINK',
        image: '',
        isGlass: false
      });
    } catch (e: any) {
      setCreateError(e?.message || 'Create failed');
    } finally {
      setIsCreating(false);
    }
  };

  const apiRestockPlus10 = async (id: string, currentStock: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stock: Number(currentStock) + 10 })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Restock failed');

      const updated: Product = data.product;
      setProducts(prev => prev.map(p => (p.id === id ? updated : p)));
    } catch {
      // silent in UI for now
    }
  };

  const apiDeleteProduct = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch {
      // silent in UI for now
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-12 animate-in fade-in pb-32">
      <aside className="w-full xl:w-72 space-y-2">
        {[
          { id: 'analytics', label: 'Dashboard', icon: BarChart3 },
          { id: 'orders', label: 'Logistics', icon: Truck },
          { id: 'approvals', label: 'Auth Hub', icon: ShieldCheck },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'users', label: 'User Base', icon: Users },
          { id: 'logs', label: 'Audit Logs', icon: Terminal },
          { id: 'settings', label: 'Global Node', icon: Sliders }
        ].map(m => (
          <button
            key={m.id}
            onClick={() => setActiveModule(m.id)}
            className={`w-full text-left p-5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-4 ${
              activeModule === m.id
                ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                : 'hover:bg-white/5 text-slate-500'
            }`}
          >
            <m.icon className="w-5 h-5" /> {m.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 space-y-8">
        {activeModule === 'analytics' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Net Revenue</p>
                <p className="text-3xl font-black text-white">
                  ${orders.reduce((s, o) => s + o.total, 0).toFixed(2)}
                </p>
              </div>

              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Pending Auth</p>
                <p className="text-3xl font-black text-white">
                  {approvals.filter(a => a.status === 'PENDING').length}
                </p>
              </div>

              <button
                onClick={async () => {
                  setIsAuditing(true);
                  const res = await getAdvancedInventoryInsights(products, orders);
                  setAiInsights(res);
                  setIsAuditing(false);
                }}
                className="bg-ninpo-lime text-ninpo-black p-8 rounded-[2.5rem] flex items-center justify-center gap-4 uppercase font-black text-[11px] shadow-neon"
              >
                {isAuditing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <BrainCircuit className="w-6 h-6" />
                )}
                Strategic Audit Run
              </button>
            </div>

            {aiInsights && (
              <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl">
                <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> Strategic Intelligence Report:
                </p>
                {aiInsights}
              </div>
            )}

            <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis dataKey="name" stroke="#555" fontSize={9} />
                  <YAxis stroke="#555" fontSize={9} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111',
                      border: 'none',
                      borderRadius: '1rem',
                      fontSize: '10px'
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#00ff41"
                    strokeWidth={3}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {activeModule === 'orders' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Global Logistics Control
            </h2>

            <div className="grid grid-cols-1 gap-6">
              {orders.filter(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.REFUNDED)
                .length === 0 ? (
                <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <PackageX className="w-12 h-12 text-slate-800 mb-4" />
                  <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
                    Logistics Pipeline Clear
                  </p>
                </div>
              ) : (
                orders
                  .filter(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.REFUNDED)
                  .map(o => (
                    <div
                      key={o.id}
                      className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-black text-slate-600 uppercase">
                            NODE: {o.id}
                          </p>
                          <p className="text-white font-black text-xl uppercase mt-1 tracking-tighter">
                            {o.address}
                          </p>
                          <div className="flex items-center gap-3 mt-4">
                            <span
                              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest ${
                                o.status === OrderStatus.PAID
                                  ? 'text-blue-400 border-blue-400/20 bg-blue-400/5'
                                  : 'text-ninpo-lime border-ninpo-lime/20 bg-ninpo-lime/5'
                              }`}
                            >
                              {o.status.replace('_', ' ')}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-white font-black text-2xl tracking-tighter">
                            ${o.total.toFixed(2)}
                          </p>
                          <p className="text-[10px] font-bold text-slate-700 uppercase mt-1">
                            {o.items.length} SKUs IN BATCH
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-4 border-t border-white/5 pt-6">
                        {o.status === OrderStatus.PAID && (
                          <button
                            onClick={() => handleLogisticsUpdate(o.id, OrderStatus.PICKED_UP)}
                            className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                          >
                            <PackageCheck className="w-5 h-5" /> Acknowledge Pickup
                          </button>
                        )}

                        {o.status === OrderStatus.PICKED_UP && (
                          <button
                            onClick={() => handleLogisticsUpdate(o.id, OrderStatus.ARRIVING)}
                            className="flex-1 py-5 bg-white/10 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all"
                          >
                            <Navigation2 className="w-5 h-5" /> Engage Satellite Nav
                          </button>
                        )}

                        {o.status === OrderStatus.ARRIVING && (
                          <button
                            onClick={() => handleLogisticsUpdate(o.id, OrderStatus.DELIVERED)}
                            className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                          >
                            <CheckCircle2 className="w-5 h-5" /> Finalize Handover
                          </button>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {activeModule === 'approvals' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Authentication Hub
            </h2>

            <div className="space-y-4">
              {approvals.length === 0 ? (
                <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <ShieldCheck className="w-12 h-12 text-slate-800 mb-4" />
                  <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
                    Queue Cleared
                  </p>
                </div>
              ) : (
                approvals.map(a => (
                  <div
                    key={a.id}
                    className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4 transition-all hover:border-white/10"
                  >
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                      <div className="flex items-center gap-6">
                        {a.photoProof && (
                          <div
                            className="relative group cursor-pointer"
                            onClick={() => setPreviewPhoto(a.photoProof!)}
                          >
                            <img
                              src={a.photoProof}
                              className="w-20 h-20 rounded-[1.5rem] object-cover border border-white/10 transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-[1.5rem]">
                              <Eye className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-[10px] font-black text-ninpo-lime uppercase tracking-widest">
                            {a.type} REQUEST
                          </p>
                          <p className="text-white font-black text-sm uppercase mt-1">
                            UID: {a.userId} | Amount: ${a.amount.toFixed(2)}
                          </p>
                          <p className="text-[9px] text-slate-600 font-bold uppercase mt-1">
                            {new Date(a.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {a.status === 'PENDING' ? (
                        <div className="flex gap-4">
                          <button
                            onClick={() => handleApprove(a)}
                            className="px-8 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase shadow-neon transition-transform active:scale-95"
                          >
                            Authorize
                          </button>
                          <button
                            onClick={() => handleReject(a.id)}
                            className="px-8 py-4 bg-ninpo-red text-white rounded-xl text-[10px] font-black uppercase transition-transform active:scale-95"
                          >
                            Deny
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`text-[10px] font-black uppercase tracking-widest px-6 py-3 rounded-xl border ${
                            a.status === 'APPROVED'
                              ? 'text-ninpo-lime border-ninpo-lime/20 bg-ninpo-lime/5'
                              : 'text-ninpo-red border-ninpo-red/20 bg-ninpo-red/5'
                          }`}
                        >
                          {a.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeModule === 'inventory' && (
          <div className="space-y-8">
            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5">
              <div className="flex items-center justify-between gap-6 mb-6">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Inventory
                </h2>

                <button
                  onClick={apiCreateProduct}
                  disabled={isCreating || !newProduct.id.trim() || !newProduct.name.trim()}
                  className="px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-neon disabled:opacity-30"
                >
                  {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add Product
                </button>
              </div>

              {createError && (
                <div className="mb-6 text-[10px] font-black uppercase tracking-widest text-ninpo-red">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  value={newProduct.id}
                  onChange={e => setNewProduct(p => ({ ...p, id: e.target.value }))}
                  placeholder="Product ID (example: ARIZONA_LEMON)"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />
                <input
                  value={newProduct.name}
                  onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
                  placeholder="Name"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />
                <input
                  type="number"
                  step="0.01"
                  value={newProduct.price}
                  onChange={e => setNewProduct(p => ({ ...p, price: Number(e.target.value) }))}
                  placeholder="Price"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />
                <input
                  type="number"
                  value={newProduct.stock}
                  onChange={e => setNewProduct(p => ({ ...p, stock: Number(e.target.value) }))}
                  placeholder="Stock"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />
                <input
                  value={newProduct.category}
                  onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))}
                  placeholder="Category (DRINK / SWEET / SAVORY...)"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />
                <input
                  value={newProduct.image}
                  onChange={e => setNewProduct(p => ({ ...p, image: e.target.value }))}
                  placeholder="Image URL"
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white text-xs font-black uppercase outline-none focus:border-ninpo-lime"
                />

                <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newProduct.isGlass}
                    onChange={e => setNewProduct(p => ({ ...p, isGlass: e.target.checked }))}
                    className="accent-ninpo-lime"
                  />
                  Glass Item
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map(p => (
                <div
                  key={p.id}
                  className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6 group hover:border-ninpo-lime/20 transition-all"
                >
                  <div className="aspect-square bg-ninpo-black rounded-[2rem] overflow-hidden grayscale group-hover:grayscale-0 opacity-40 group-hover:opacity-100 transition-all relative">
                    <img
                      src={p.image}
                      className="w-full h-full object-cover transition-transform group-hover:scale-110"
                      alt={p.name}
                    />
                    {p.stock < 10 && (
                      <div className="absolute inset-0 bg-ninpo-red/20 flex items-center justify-center">
                        <p className="text-[10px] font-black text-white bg-ninpo-red px-4 py-2 rounded-full shadow-lg">
                          LOW STOCK
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-black text-white uppercase block leading-tight">
                        {p.name}
                      </span>
                      <span className="text-[9px] font-bold text-slate-600 uppercase mt-1 block">
                        {p.category}
                      </span>
                      <span className="text-[9px] font-bold text-slate-600 uppercase mt-1 block">
                        ID: {p.id}
                      </span>
                    </div>

                    <span
                      className={`text-sm font-black uppercase ${
                        p.stock < 5 ? 'text-ninpo-red animate-pulse' : 'text-ninpo-lime'
                      }`}
                    >
                      QTY: {p.stock}
                    </span>
                  </div>

                  <button
                    onClick={() => apiRestockPlus10(p.id, p.stock)}
                    className="w-full py-4 bg-white/5 rounded-2xl text-[9px] font-black uppercase text-slate-400 hover:text-ninpo-lime border border-transparent hover:border-ninpo-lime/20 transition-all flex items-center justify-center gap-2"
                  >
                    <Package className="w-4 h-4" /> Restock Batch +10
                  </button>

                  <button
                    onClick={() => apiDeleteProduct(p.id)}
                    className="w-full py-4 bg-ninpo-red/10 rounded-2xl text-[9px] font-black uppercase text-ninpo-red border border-ninpo-red/20 hover:bg-ninpo-red hover:text-white transition-all flex items-center justify-center gap-2"
                  >
                    <PackageX className="w-4 h-4" /> Remove Product
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeModule === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map(u => (
              <div
                key={u.id}
                className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-ninpo-black rounded-2xl flex items-center justify-center border border-white/10 group-hover:border-ninpo-lime/20 transition-all">
                    <UserCircle className="w-7 h-7 text-slate-700 group-hover:text-ninpo-lime" />
                  </div>
                  <div>
                    <p className="text-white font-black text-xs uppercase">{(u as any).name ?? u.id}</p>
                    <p className="text-[10px] font-bold text-slate-600 uppercase">
                      {(u as any).role ?? 'CUSTOMER'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-black text-xs tracking-tighter">
                    ${(u as any).credits ? (u as any).credits.toFixed(2) : '0.00'}
                  </p>
                  <button
                    onClick={() => adjustCredits(u.id, 5.0, 'ADMIN_INCENTIVE')}
                    className="text-[9px] font-black text-ninpo-lime uppercase hover:text-white transition-colors mt-1"
                  >
                    + Grant
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeModule === 'logs' && (
          <div className="space-y-4">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">System Audit Terminal</h2>
            <div className="bg-ninpo-midnight rounded-[2.5rem] border border-white/5 p-8 overflow-hidden h-[40rem] flex flex-col shadow-inner">
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 font-mono">
                {auditLogs
                  .slice()
                  .reverse()
                  .map(log => (
                    <div
                      key={log.id}
                      className="text-[10px] p-4 bg-white/5 rounded-xl border border-white/5 text-slate-400 hover:bg-white/10 transition-colors"
                    >
                      <span className="text-ninpo-lime/60 mr-3">[{log.timestamp}]</span>
                      <span className="text-white uppercase font-black bg-white/10 px-2 py-1 rounded mr-3">
                        {log.action}
                      </span>
                      <span className="text-slate-500">USER: {log.userId}</span>
                      {log.metadata && (
                        <div className="mt-2 pl-4 border-l border-ninpo-lime/20 text-[9px] text-slate-600">
                          {JSON.stringify(log.metadata)}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {activeModule === 'settings' && (
          <div className="space-y-8 max-w-2xl">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">Global Node Settings</h2>

            <div className="bg-ninpo-card p-10 rounded-[4rem] border border-white/5 space-y-10">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em]">
                  Base Logistics Fee ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.deliveryFee}
                  onChange={e => setSettings({ ...settings, deliveryFee: parseFloat(e.target.value) })}
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-6 text-white font-black text-xl outline-none focus:border-ninpo-lime transition-all"
                />
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.4em]">
                  Node Referral Bonus ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.referralBonus}
                  onChange={e => setSettings({ ...settings, referralBonus: parseFloat(e.target.value) })}
                  className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-6 text-white font-black text-xl outline-none focus:border-ninpo-lime transition-all"
                />
              </div>

              <div className="flex items-center justify-between p-8 bg-ninpo-red/5 rounded-3xl border border-ninpo-red/10 group">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-ninpo-red/10 rounded-xl flex items-center justify-center border border-ninpo-red/20 group-hover:scale-110 transition-transform">
                    <AlertTriangle className="w-6 h-6 text-ninpo-red" />
                  </div>
                  <div>
                    <span className="text-[11px] font-black text-white uppercase tracking-widest block">
                      Mainframe Maintenance
                    </span>
                    <span className="text-[9px] font-bold text-slate-600 uppercase">
                      Lock public market access
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.maintenanceMode}
                  onChange={e => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                  className="w-8 h-8 accent-ninpo-red cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-[15000] flex items-center justify-center p-6 bg-ninpo-black/95 backdrop-blur-xl animate-in fade-in duration-300"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="relative max-w-4xl w-full aspect-video rounded-[3rem] overflow-hidden border border-white/10 shadow-neon bg-black"
            onClick={e => e.stopPropagation()}
          >
            <img src={previewPhoto} className="w-full h-full object-contain" alt="Verification proof" />
            <button
              className="absolute top-10 right-10 p-5 bg-white/10 rounded-3xl text-white hover:bg-ninpo-red transition-colors backdrop-blur-md"
              onClick={() => setPreviewPhoto(null)}
            >
              <EyeOff className="w-7 h-7" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagementView;
