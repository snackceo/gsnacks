
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { UserRole, User, UserTier, Product, Order, OrderStatus, AppSettings, ApprovalRequest, AuditLog } from './types';
import { MOCK_PRODUCTS } from './constants';
import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';
import LegalFooter from './components/LegalFooter';
import { 
  ShoppingBag, X, Trash2, Loader2, Binary, 
  Zap, Landmark, WifiOff, RefreshCcw
} from 'lucide-react';

/**
 * LOGISTICS HUB CONFIGURATION
 * VITE_BACKEND_URL: Point this to your Render Web Service URL in Render settings.
 */
const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

const useNinpoCore = () => {
  const [toasts, setToasts] = useState<{id: string; message: string; type: 'info' | 'success' | 'warning'}[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);
  
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    deliveryFee: 2.99,
    referralBonus: 5.00,
    michiganDepositValue: 0.10,
    processingFeePercent: 0.05,
    glassHandlingFeePercent: 0.02,
    dailyReturnLimit: 25.00,
    maintenanceMode: false,
  });
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);

  const addToast = useCallback((message: string, type: any = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const syncWithBackend = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/sync`);
      if (response.ok) {
        setIsBackendOnline(true);
      } else {
        setIsBackendOnline(false);
      }
    } catch (err) {
      setIsBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    syncWithBackend();
    const interval = setInterval(syncWithBackend, 30000);
    return () => clearInterval(interval);
  }, [syncWithBackend]);

  const adjustCredits = useCallback(async (userId: string, amount: number, reason: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, credits: u.credits + amount } : u));
    try {
      await fetch(`${BACKEND_URL}/api/users/${userId}/credits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason })
      });
    } catch (e) {
      addToast("Failed to sync credits to MongoDB", "warning");
    }
  }, [addToast]);

  const updateOrder = useCallback(async (id: string, status: OrderStatus, metadata?: any) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...metadata } : o));
    try {
      await fetch(`${BACKEND_URL}/api/orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...metadata })
      });
    } catch (e) {
      addToast("Order update failed to sync", "warning");
    }
  }, [addToast]);

  return {
    currentUser, setCurrentUser, users, setUsers, settings, setSettings,
    products, setProducts, orders, setOrders, approvals, setApprovals,
    auditLogs, setAuditLogs, cart, setCart, toasts, addToast, adjustCredits, updateOrder,
    isBackendOnline, syncWithBackend
  };
};

const App: React.FC = () => {
  const core = useNinpoCore();
  const [address, setAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [viewMode, setViewMode] = useState<'market' | 'management' | 'driver'>('market');
  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  const handleExternalPayment = async (type: 'STRIPE' | 'GPAY') => {
    if (isProcessingOrder || !core.currentUser) return;
    setIsProcessingOrder(true);
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/payments/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          items: core.cart,
          userId: core.currentUser.id,
          gateway: type 
        })
      });

      if (!response.ok) throw new Error("Payment gateway handshake failed.");
      
      const { sessionUrl } = await response.json();
      core.addToast("REDIRECTING TO SECURE VAULT", 'success');
      window.location.href = sessionUrl; 
    } catch (err: any) {
      core.addToast(err.message, 'warning');
      setIsProcessingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-ninpo-black text-white flex flex-col relative overflow-x-hidden selection:bg-ninpo-lime selection:text-ninpo-black font-sans">
      {!core.isBackendOnline && (
        <div className="bg-ninpo-red text-white py-2 text-center text-[9px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4 z-[12000] sticky top-0">
          <WifiOff className="w-3 h-3" />
          Mainframe Disconnected - Operating in Offline Buffer
          <button onClick={core.syncWithBackend} className="bg-white/20 px-3 py-1 rounded hover:bg-white/30 transition-all flex items-center gap-1">
            <RefreshCcw className="w-2 h-2" /> Reconnect
          </button>
        </div>
      )}

      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[11000] flex flex-col gap-2 w-full max-w-xs px-4 pointer-events-none">
        {core.toasts.map(t => (
          <div key={t.id} className={`animate-in slide-in-top flex items-center gap-3 px-6 py-4 rounded-full border shadow-neon backdrop-blur-xl pointer-events-auto ${t.type === 'success' ? 'bg-ninpo-lime/10 border-ninpo-lime text-ninpo-lime' : t.type === 'warning' ? 'bg-ninpo-red/10 border-ninpo-red text-ninpo-red' : 'bg-white/10 border-white/20 text-white'}`}>
            <Binary className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">{t.message}</span>
          </div>
        ))}
      </div>

      <header className="px-6 pt-8 max-w-[1600px] w-full mx-auto z-50">
        <div className="bg-ninpo-midnight/80 backdrop-blur-xl rounded-[2.5rem] p-5 border border-white/10 shadow-2xl flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setViewMode('market')}>
            <div className="w-10 h-10 bg-ninpo-lime rounded-xl flex items-center justify-center shadow-neon">
              <span className="text-ninpo-black font-black text-xl">N</span>
            </div>
            <span className="hidden sm:block text-white text-lg font-black uppercase tracking-tighter">Ninpo <span className="text-ninpo-red">Snacks</span></span>
          </div>
          <div className="flex gap-2">
            {core.currentUser?.role === UserRole.OWNER && (
              <>
                <button onClick={() => setViewMode('management')} className={`rounded-2xl px-4 py-3 font-black uppercase text-[9px] ${viewMode === 'management' ? 'bg-ninpo-lime text-ninpo-black shadow-neon' : 'bg-ninpo-grey'}`}>Management</button>
                <button onClick={() => setViewMode('driver')} className={`rounded-2xl px-4 py-3 font-black uppercase text-[9px] ${viewMode === 'driver' ? 'bg-ninpo-lime text-ninpo-black shadow-neon' : 'bg-ninpo-grey'}`}>Logistics</button>
              </>
            )}
            <button onClick={core.currentUser ? () => core.setCurrentUser(null) : () => setIsLoginViewOpen(true)} className="bg-ninpo-red text-white rounded-2xl px-5 py-3 font-black uppercase text-[9px] tracking-widest">{core.currentUser ? 'Logout' : 'Sign In'}</button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-10 max-w-[1600px] w-full mx-auto">
        {viewMode === 'market' && <CustomerView products={core.products} orders={core.orders.filter(o => o.customerId === core.currentUser?.id)} currentUser={core.currentUser} openLogin={() => setIsLoginViewOpen(true)} onRequestRefund={() => {}} addToCart={(id) => {
          if (!core.currentUser) { setIsLoginViewOpen(true); return; }
          core.setCart(prev => {
            const existing = prev.find(i => i.productId === id);
            return existing ? prev.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { productId: id, quantity: 1 }];
          });
          core.addToast("ADDED TO CARGO");
        }} updateUserProfile={() => {}} reorderItems={() => {}} onRedeemPoints={() => {}} />}
        {viewMode === 'management' && <ManagementView user={core.currentUser!} products={core.products} setProducts={core.setProducts} orders={core.orders} users={core.users} settings={core.settings} setSettings={core.setSettings} approvals={core.approvals} setApprovals={core.setApprovals} auditLogs={core.auditLogs} updateOrder={core.updateOrder} adjustCredits={core.adjustCredits} updateUserProfile={() => {}} />}
        {viewMode === 'driver' && <DriverView orders={core.orders} updateOrder={core.updateOrder} />}
      </main>

      <button onClick={() => setIsCartOpen(true)} className="fixed bottom-10 right-10 z-[9000] w-16 h-16 bg-ninpo-lime text-ninpo-black rounded-[1.5rem] shadow-neon flex items-center justify-center border-2 border-ninpo-black hover:scale-110 active:scale-90 transition-all">
        <ShoppingBag className="w-7 h-7" />
        {core.cart.length > 0 && <div className="absolute -top-2 -right-2 w-7 h-7 bg-ninpo-red text-white text-[10px] font-black rounded-full flex items-center justify-center">{core.cart.length}</div>}
      </button>

      {isCartOpen && (
        <div className="fixed inset-0 z-[10000] flex justify-end">
          <div className="absolute inset-0 bg-ninpo-black/80 backdrop-blur-sm" onClick={() => setIsCartOpen(false)} />
          <div className="relative w-full max-w-md bg-ninpo-midnight border-l border-white/10 h-full flex flex-col p-8 animate-in slide-in-right">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-black uppercase text-white">Cargo manifest</h3>
              <button onClick={() => setIsCartOpen(false)}><X className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar">
              {core.cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-20">
                  <ShoppingBag className="w-20 h-20 mb-4" />
                  <p className="font-black uppercase text-xs">Manifest Empty</p>
                </div>
              ) : (
                core.cart.map(item => {
                  const p = core.products.find(prod => prod.id === item.productId);
                  return (
                    <div key={item.productId} className="flex gap-4 bg-ninpo-card p-4 rounded-2xl border border-white/5">
                      <img src={p?.image} className="w-12 h-12 rounded-xl object-cover grayscale" />
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-white uppercase">{p?.name}</p>
                        <p className="text-[9px] font-bold text-ninpo-lime mt-1">{item.quantity} x ${p?.price.toFixed(2)}</p>
                      </div>
                      <button onClick={() => core.setCart(prev => prev.filter(i => i.productId !== item.productId))} className="text-slate-600 hover:text-ninpo-red">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="pt-8 border-t border-white/5 space-y-4">
              <input type="text" placeholder="Drop Location..." value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-white/5 border border-white/5 rounded-2xl p-5 text-white text-xs outline-none focus:border-ninpo-lime" />
              <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer">
                <input type="checkbox" checked={acceptedPolicies} onChange={e => setAcceptedPolicies(e.target.checked)} className="accent-ninpo-lime" /> 
                Accept Hub Protocol
              </label>
              <div className="grid grid-cols-1 gap-2">
                <button disabled={!address.trim() || !acceptedPolicies || isProcessingOrder || core.cart.length === 0} className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[10px] shadow-neon flex items-center justify-center gap-2 disabled:opacity-30">
                  {isProcessingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : "Pay with Credits"}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleExternalPayment('GPAY')} disabled={!address.trim() || !acceptedPolicies || isProcessingOrder || core.cart.length === 0} className="py-4 bg-white/5 rounded-xl text-[9px] font-black uppercase flex items-center justify-center gap-2 hover:bg-white/10 disabled:opacity-30">
                    <Zap className="w-3 h-3" /> Google Pay
                  </button>
                  <button onClick={() => handleExternalPayment('STRIPE')} disabled={!address.trim() || !acceptedPolicies || isProcessingOrder || core.cart.length === 0} className="py-4 bg-white/5 rounded-xl text-[9px] font-black uppercase flex items-center justify-center gap-2 hover:bg-white/10 disabled:opacity-30">
                    <Landmark className="w-3 h-3" /> Stripe
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoginViewOpen && <div className="fixed inset-0 z-[10001] flex items-center justify-center p-6 bg-ninpo-black/98 backdrop-blur-xl"><LoginView users={core.users} onLogin={u => {core.setCurrentUser(u); setIsLoginViewOpen(false);}} onRegister={u => {core.setUsers(p => [...p, u]); core.setCurrentUser(u); setIsLoginViewOpen(false);}} onCancel={() => setIsLoginViewOpen(false)} /></div>}
      <LegalFooter />
    </div>
  );
};

export default App;
