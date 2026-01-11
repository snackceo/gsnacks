import React, { useEffect, useMemo, useState } from 'react';
import {
  User,
  Product,
  Order,
  OrderStatus,
  UpcItem,
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
  Terminal,
  Sliders,
  ShieldAlert,
  Navigation2,
  PackageCheck,
  EyeOff,
  PackageX,
  Plus,
  RefreshCw,
  UserCheck,
  XCircle,
  ScanLine
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

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

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
    deposit: 0,
    stock: 0,
    category: 'DRINK',
    image: '',
    isGlass: false
  });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: '',
    price: 0,
    deposit: 0,
    stock: 0,
    category: '',
    image: '',
    isGlass: false
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [upcItems, setUpcItems] = useState<UpcItem[]>([]);
  const [upcInput, setUpcInput] = useState('');
  const [upcFilter, setUpcFilter] = useState('');
  const [upcDraft, setUpcDraft] = useState<UpcItem>({
    upc: '',
    name: '',
    depositValue: settings.michiganDepositValue || 0.1,
    isGlass: false,
    isEligible: true
  });
  const [isUpcLoading, setIsUpcLoading] = useState(false);
  const [isUpcSaving, setIsUpcSaving] = useState(false);
  const [upcError, setUpcError] = useState<string | null>(null);

  const chartData = useMemo(() => {
    return (orders || [])
      .filter((o: any) => o && (o as any).id)
      .slice(0, 15)
      .map((o: any) => ({
        name: String(o.id).slice(-4),
        revenue: Number(o.total || 0)
      }))
      .reverse();
  }, [orders]);

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

  const handleLogisticsUpdate = (orderId: string, status: OrderStatus, metadata?: any) => {
    updateOrder(orderId, status, metadata);
  };

  // ---- Orders API (OWNER) ----
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const apiRefreshOrders = async () => {
    setOrdersError(null);
    setIsRefreshingOrders(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Orders fetch failed');

      // NOTE:
      // This view receives `orders` from parent state. This button checks connectivity,
      // but does not directly set `orders` here. Your parent core should re-fetch orders
      // on session restore / status updates (which you already have).
    } catch (e: any) {
      setOrdersError(e?.message || 'Orders fetch failed');
    } finally {
      setIsRefreshingOrders(false);
    }
  };

  // ---- UPC Whitelist API (OWNER) ----
  const apiLoadUpcItems = async () => {
    setUpcError(null);
    setIsUpcLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'GET',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load UPC list');
      setUpcItems(Array.isArray(data?.upcItems) ? data.upcItems : []);
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to load UPC list');
    } finally {
      setIsUpcLoading(false);
    }
  };

  const loadUpcDraft = (entry: UpcItem) => {
    setUpcDraft({
      upc: entry.upc,
      name: entry.name || '',
      depositValue: Number(entry.depositValue || 0),
      isGlass: !!entry.isGlass,
      isEligible: entry.isEligible !== false
    });
  };

  const handleUpcLookup = () => {
    const upc = upcInput.trim();
    if (!upc) {
      setUpcError('UPC is required.');
      return;
    }

    setUpcError(null);
    const existing = upcItems.find(item => item.upc === upc);
    if (existing) {
      loadUpcDraft(existing);
      return;
    }

    setUpcDraft({
      upc,
      name: '',
      depositValue: settings.michiganDepositValue || 0.1,
      isGlass: false,
      isEligible: true
    });
  };

  const apiSaveUpc = async () => {
    if (!upcDraft.upc) {
      setUpcError('UPC is required.');
      return;
    }

    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          upc: upcDraft.upc,
          name: upcDraft.name,
          depositValue: Number(upcDraft.depositValue || 0),
          isGlass: upcDraft.isGlass,
          isEligible: upcDraft.isEligible
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save UPC');
      const saved: UpcItem = data.upcItem;
      setUpcItems(prev => {
        const next = prev.filter(item => item.upc !== saved.upc);
        return [saved, ...next];
      });
      loadUpcDraft(saved);
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to save UPC');
    } finally {
      setIsUpcSaving(false);
    }
  };

  const apiDeleteUpc = async () => {
    if (!upcDraft.upc) return;
    setIsUpcSaving(true);
    setUpcError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/upc/${upcDraft.upc}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete UPC');
      setUpcItems(prev => prev.filter(item => item.upc !== upcDraft.upc));
      setUpcDraft({
        upc: '',
        name: '',
        depositValue: settings.michiganDepositValue || 0.1,
        isGlass: false,
        isEligible: true
      });
      setUpcInput('');
    } catch (e: any) {
      setUpcError(e?.message || 'Failed to delete UPC');
    } finally {
      setIsUpcSaving(false);
    }
  };

  useEffect(() => {
    if (activeModule === 'upc' && upcItems.length === 0 && !isUpcLoading) {
      apiLoadUpcItems();
    }
  }, [activeModule, upcItems.length, isUpcLoading]);

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
          deposit: Number(newProduct.deposit),
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
        deposit: 0,
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

  const startEditProduct = (product: Product) => {
    setEditError(null);
    setEditingProduct(product);
    setEditDraft({
      name: product.name,
      price: product.price,
      deposit: product.deposit,
      stock: product.stock,
      category: product.category,
      image: product.image,
      isGlass: product.isGlass
    });
  };

  const closeEditProduct = () => {
    setEditError(null);
    setEditingProduct(null);
  };

  const apiUpdateProduct = async () => {
    if (!editingProduct) return;
    setEditError(null);

    const name = editDraft.name.trim();
    const price = Number(editDraft.price);
    const deposit = Number(editDraft.deposit);
    const stock = Number(editDraft.stock);

    if (!name) {
      setEditError('Name is required.');
      return;
    }

    if ([price, deposit, stock].some(value => Number.isNaN(value))) {
      setEditError('Price, deposit, and stock must be valid numbers.');
      return;
    }

    const updates: Partial<Product> = {};

    if (name !== editingProduct.name) updates.name = name;
    if (price !== editingProduct.price) updates.price = price;
    if (deposit !== editingProduct.deposit) updates.deposit = deposit;
    if (stock !== editingProduct.stock) updates.stock = stock;
    if (editDraft.category !== editingProduct.category) updates.category = editDraft.category;
    if (editDraft.image !== editingProduct.image) updates.image = editDraft.image;
    if (editDraft.isGlass !== editingProduct.isGlass) updates.isGlass = editDraft.isGlass;

    if (Object.keys(updates).length === 0) {
      setEditError('No changes to save.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update failed');

      const updated: Product = data.product;
      setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
      setEditingProduct(null);
    } catch (e: any) {
      setEditError(e?.message || 'Update failed');
    } finally {
      setIsSavingEdit(false);
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

  const runAudit = async () => {
    setIsAuditing(true);
    try {
      const report = await getAdvancedInventoryInsights(products as any, orders as any);
      setAiInsights(report || 'NO OUTPUT');
    } catch {
      setAiInsights('Audit transmission interrupted.');
    } finally {
      setIsAuditing(false);
    }
  };

  const canCancel = (o: Order) => {
    // Cancel is allowed for anything not delivered/refunded/closed.
    // Backend will block cancel if already PAID (it returns an error). We keep the UI conservative.
    return (
      o.status !== OrderStatus.DELIVERED &&
      o.status !== OrderStatus.REFUNDED &&
      o.status !== OrderStatus.CLOSED
    );
  };

  return (
    <div className="flex flex-col xl:flex-row gap-12 animate-in fade-in pb-32">
      <aside className="w-full xl:w-72 space-y-2">
        {[
          { id: 'analytics', label: 'Dashboard', icon: BarChart3 },
          { id: 'orders', label: 'Orders', icon: Truck },
          { id: 'approvals', label: 'Auth Hub', icon: ShieldCheck },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'upc', label: 'UPC Whitelist', icon: ScanLine },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'logs', label: 'Audit Logs', icon: Terminal },
          { id: 'settings', label: 'Settings', icon: Sliders }
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
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div>
                <h2 className="text-xl font-black uppercase text-white tracking-widest">
                  Main Dashboard
                </h2>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                  Revenue snapshots & operational pulse
                </p>
              </div>

              <button
                onClick={runAudit}
                disabled={isAuditing}
                className="px-8 py-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center gap-3"
              >
                {isAuditing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <BrainCircuit className="w-6 h-6" />
                )}
                Run Audit
              </button>
            </div>

            {aiInsights && (
              <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl whitespace-pre-wrap">
                <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> Audit Report
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
                  <Line type="monotone" dataKey="revenue" stroke="#00ff41" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* =========================
            ORDERS LIST
        ========================= */}
        {activeModule === 'orders' && (
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
                orders.map(o => (
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

                      {/* UPDATED HEADER RIGHT-SIDE */}
                      <div className="md:text-right space-y-2">
                        <p className="text-white font-black text-2xl tracking-tighter">
                          ${Number(o.total || 0).toFixed(2)}
                        </p>

                        <p className="text-[10px] font-bold text-slate-700 uppercase">
                          {o.items.length} LINE ITEMS
                        </p>

                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 space-y-1">
                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Est Credit:</span>
                            <span className="text-slate-300">
                              Est Credit: ${Number(o.estimatedReturnCredit || 0).toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between md:justify-end md:gap-3">
                            <span className="md:hidden">Verified:</span>
                            <span className="text-slate-300">
                              Verified:{' '}
                              {o.verifiedReturnCredit === undefined
                                ? '—'
                                : `$${Number(o.verifiedReturnCredit || 0).toFixed(2)}`}
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

                    {/* ACTIONS */}
                    <div className="flex flex-col md:flex-row gap-4 border-t border-white/5 pt-6">
                      {/* Assign to Me (owner-as-driver) */}
                      {(o.status === OrderStatus.PENDING || o.status === OrderStatus.PAID) && (
                        <button
                          onClick={() =>
                            handleLogisticsUpdate(o.id, OrderStatus.ASSIGNED, { driverId: 'OWNER' })
                          }
                          className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-neon"
                        >
                          <UserCheck className="w-5 h-5" /> Assign to Me
                        </button>
                      )}

                      {/* Progress buttons */}
                      {o.status === OrderStatus.PAID && (
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

                      {/* Cancel (immediate restock on backend) */}
                      {canCancel(o) && (
                        <button
                          onClick={() => handleLogisticsUpdate(o.id, OrderStatus.CLOSED)}
                          className="md:w-[240px] py-5 bg-ninpo-red/10 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition-all"
                        >
                          <XCircle className="w-5 h-5" /> Cancel (Restock)
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================
            APPROVALS
        ========================= */}
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
                              alt="Proof"
                              className="w-24 h-24 rounded-2xl object-cover border border-white/10"
                            />
                          </div>
                        )}

                        <div>
                          <p className="text-white font-black uppercase tracking-widest text-[11px]">
                            {a.type}
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest">
                            USER: {a.userId} • AMOUNT: ${a.amount.toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => handleApprove(a)}
                          className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(a.id)}
                          className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================
            INVENTORY
        ========================= */}
        {activeModule === 'inventory' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">
              Inventory
            </h2>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Create Product
              </p>

              {createError && (
                <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="ID (e.g. coke-12oz)"
                  value={newProduct.id}
                  onChange={e => setNewProduct({ ...newProduct, id: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Name"
                  value={newProduct.name}
                  onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Price"
                  type="number"
                  value={newProduct.price}
                  onChange={e => setNewProduct({ ...newProduct, price: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Deposit"
                  type="number"
                  value={newProduct.deposit}
                  onChange={e => setNewProduct({ ...newProduct, deposit: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Stock"
                  type="number"
                  value={newProduct.stock}
                  onChange={e => setNewProduct({ ...newProduct, stock: Number(e.target.value) })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white md:col-span-2"
                  placeholder="Image URL"
                  value={newProduct.image}
                  onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                />
              </div>

              <button
                onClick={apiCreateProduct}
                disabled={isCreating}
                className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.01] transition-all shadow-neon"
              >
                {isCreating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Plus className="w-5 h-5" />
                )}
                Create
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6">
              {products.map(p => (
                <div
                  key={p.id}
                  className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div>
                    <p className="text-white font-black">{p.name}</p>
                    <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                      ID: {p.id} • Stock: {p.stock}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => startEditProduct(p)}
                      className="px-6 py-3 rounded-2xl bg-white/5 text-white/70 text-[10px] font-black uppercase tracking-widest border border-white/10"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => apiRestockPlus10(p.id, p.stock)}
                      className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      +10 Stock
                    </button>
                    <button
                      onClick={() => apiDeleteProduct(p.id)}
                      className="px-6 py-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================
            UPC WHITELIST
        ========================= */}
        {activeModule === 'upc' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-black uppercase text-white tracking-widest">
                UPC Whitelist
              </h2>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
                Scan UPCs, confirm eligibility, and store deposit metadata.
              </p>
            </div>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Scanner Input
              </p>

              {upcError && (
                <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                  {upcError}
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white flex-1"
                  placeholder="Scan or enter UPC"
                  value={upcInput}
                  onChange={e => setUpcInput(e.target.value)}
                />
                <button
                  onClick={handleUpcLookup}
                  className="px-6 py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                >
                  Load
                </button>
                <button
                  onClick={apiSaveUpc}
                  disabled={isUpcSaving}
                  className="px-6 py-4 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                >
                  {isUpcSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={apiDeleteUpc}
                  disabled={isUpcSaving || !upcDraft.upc}
                  className="px-6 py-4 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20"
                >
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Name / Description"
                  value={upcDraft.name}
                  onChange={e => setUpcDraft({ ...upcDraft, name: e.target.value })}
                />
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  placeholder="Deposit Value"
                  type="number"
                  value={upcDraft.depositValue}
                  onChange={e =>
                    setUpcDraft({ ...upcDraft, depositValue: Number(e.target.value) })
                  }
                />
                <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <input
                    type="checkbox"
                    checked={upcDraft.isGlass}
                    onChange={e => setUpcDraft({ ...upcDraft, isGlass: e.target.checked })}
                  />
                  Glass Container
                </label>
                <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <input
                    type="checkbox"
                    checked={upcDraft.isEligible}
                    onChange={e =>
                      setUpcDraft({ ...upcDraft, isEligible: e.target.checked })
                    }
                  />
                  Eligible for MI Deposit
                </label>
              </div>
            </div>

            <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Whitelist Entries
                </p>
                <div className="flex gap-3">
                  <input
                    className="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs text-white"
                    placeholder="Filter by UPC or name"
                    value={upcFilter}
                    onChange={e => setUpcFilter(e.target.value)}
                  />
                  <button
                    onClick={apiLoadUpcItems}
                    disabled={isUpcLoading}
                    className="px-5 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                  >
                    {isUpcLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {upcItems.length === 0 && !isUpcLoading ? (
                <p className="text-xs text-slate-500">
                  No UPC entries yet. Scan a code to begin.
                </p>
              ) : (
                <div className="space-y-3">
                  {upcItems
                    .filter(item => {
                      if (!upcFilter.trim()) return true;
                      const needle = upcFilter.toLowerCase();
                      return (
                        item.upc.toLowerCase().includes(needle) ||
                        (item.name || '').toLowerCase().includes(needle)
                      );
                    })
                    .map(item => (
                      <button
                        key={item.upc}
                        onClick={() => {
                          setUpcInput(item.upc);
                          loadUpcDraft(item);
                        }}
                        className="w-full text-left p-4 rounded-2xl border border-white/5 bg-black/40 hover:bg-white/5 transition-all"
                      >
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div>
                            <p className="text-white text-sm font-black">{item.upc}</p>
                            <p className="text-[10px] uppercase tracking-widest text-slate-500">
                              {item.name || 'Unnamed'} • $
                              {Number(item.depositValue || 0).toFixed(2)} •{' '}
                              {item.isGlass ? 'GLASS' : 'PLASTIC'} •{' '}
                              {item.isEligible ? 'ELIGIBLE' : 'INELIGIBLE'}
                            </p>
                          </div>
                          <p className="text-[10px] uppercase tracking-widest text-slate-600">
                            Updated {fmtTime(item.updatedAt)}
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editingProduct && (
        <div
          className="fixed inset-0 z-[14000] flex items-center justify-center p-6 bg-ninpo-black/95 backdrop-blur-xl animate-in fade-in duration-300"
          onClick={closeEditProduct}
        >
          <div
            className="w-full max-w-2xl bg-ninpo-card border border-white/10 rounded-[2.5rem] p-8 space-y-6"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <p className="text-white font-black uppercase tracking-widest text-sm">
                Edit Product
              </p>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-2">
                ID: {editingProduct.id}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Name"
                value={editDraft.name}
                onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Category"
                value={editDraft.category}
                onChange={e => setEditDraft({ ...editDraft, category: e.target.value })}
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Price"
                type="number"
                value={editDraft.price}
                onChange={e =>
                  setEditDraft({
                    ...editDraft,
                    price: Number(e.target.value)
                  })
                }
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Deposit"
                type="number"
                value={editDraft.deposit}
                onChange={e =>
                  setEditDraft({
                    ...editDraft,
                    deposit: Number(e.target.value)
                  })
                }
              />
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                placeholder="Stock"
                type="number"
                value={editDraft.stock}
                onChange={e =>
                  setEditDraft({
                    ...editDraft,
                    stock: Number(e.target.value)
                  })
                }
              />
              <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white">
                <input
                  id="edit-is-glass"
                  type="checkbox"
                  className="h-4 w-4 accent-ninpo-lime"
                  checked={editDraft.isGlass}
                  onChange={e => setEditDraft({ ...editDraft, isGlass: e.target.checked })}
                />
                <label htmlFor="edit-is-glass" className="text-[11px] font-bold">
                  Glass Bottle
                </label>
              </div>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white md:col-span-2"
                placeholder="Image URL"
                value={editDraft.image}
                onChange={e => setEditDraft({ ...editDraft, image: e.target.value })}
              />
            </div>

            {editError && (
              <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                {editError}
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-3">
              <button
                onClick={closeEditProduct}
                className="w-full py-4 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={apiUpdateProduct}
                disabled={isSavingEdit}
                className="w-full py-4 rounded-2xl bg-white/20 text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
              >
                {isSavingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

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
