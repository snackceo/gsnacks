
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { UserRole, User, UserTier, Product, Order, OrderStatus, AppSettings, ApprovalRequest, AuditLog } from './types';
import { MOCK_PRODUCTS } from './constants';
import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';
import LegalFooter from './components/LegalFooter';
import { analyzeBottleScan } from './services/geminiService';
import { 
  ShoppingBag, X, Trash2, Loader2, BarChart4, Binary, 
  MapPin, CreditCard, Scan, Camera, ShieldCheck, Zap, Bell, Landmark
} from 'lucide-react';

/**
 * PRODUCTION ENVIRONMENT CONFIG
 * Render injects these at build time. 
 * We use process.env to ensure compatibility with standard CI/CD pipelines.
 */
const STRIPE_PUBLISHABLE_KEY = (process.env as any).VITE_STRIPE_PUBLISHABLE_KEY || '';
const GPAY_MERCHANT_ID = (process.env as any).VITE_GOOGLE_PAY_MERCHANT_ID || '';
const GPAY_ENV = (process.env as any).VITE_GPAY_ENV || 'TEST';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning';
}

const useNinpoCore = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const getInitialState = <T,>(key: string, defaultValue: T): T => {
    try {
      const saved = localStorage.getItem(`ninpo_${key}`);
      return saved ? JSON.parse(saved) : defaultValue;
    } catch { return defaultValue; }
  };

  const [currentUser, setCurrentUser] = useState<User | null>(() => getInitialState('user', null));
  const [users, setUsers] = useState<User[]>(() => getInitialState('all_users', [
    { id: 'custo_001', name: 'Alex Johnson', email: 'alex@customail.com', role: UserRole.CUSTOMER, tier: UserTier.BRONZE, credits: 24.50, referralCode: 'ALEX77', loyaltyPoints: 1250, dailyReturnTotal: 0 },
    { id: 'owner_001', name: 'Executive Admin', email: 'eve@owner.com', role: UserRole.OWNER, tier: UserTier.GOLD, credits: 1000.00, referralCode: 'BOSS_ONE', loyaltyPoints: 9999, dailyReturnTotal: 0 }
  ]));
  const [settings, setSettings] = useState<AppSettings>(() => getInitialState('settings', {
    deliveryFee: 2.99,
    referralBonus: 5.00,
    michiganDepositValue: 0.10,
    processingFeePercent: 0.05,
    glassHandlingFeePercent: 0.02,
    dailyReturnLimit: 25.00,
    maintenanceMode: false,
  }));
  const [products, setProducts] = useState<Product[]>(() => getInitialState('products', MOCK_PRODUCTS));
  const [orders, setOrders] = useState<Order[]>(() => getInitialState('orders', []));
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(() => getInitialState('approvals', []));
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => getInitialState('logs', []));
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(() => getInitialState('cart', []));

  useEffect(() => {
    const registry = { all_users: users, settings, products, orders, approvals, logs: auditLogs, cart };
    Object.entries(registry).forEach(([k, v]) => localStorage.setItem(`ninpo_${k}`, JSON.stringify(v)));
    if (currentUser) localStorage.setItem('ninpo_user', JSON.stringify(currentUser));
    else localStorage.removeItem('ninpo_user');
  }, [users, settings, products, orders, approvals, auditLogs, cart, currentUser]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const adjustCredits = useCallback((userId: string, amount: number, reason: string) => {
    setUsers(prev => prev.map(u => {
      if (u.id === userId) {
        if (reason.includes('BOTTLE') && (u.dailyReturnTotal + amount) > settings.dailyReturnLimit) {
          addToast("DAILY LIMIT REACHED", 'warning');
          return u;
        }
        const newCredits = Number((u.credits + amount).toFixed(2));
        const newDaily = reason.includes('BOTTLE') ? Number((u.dailyReturnTotal + amount).toFixed(2)) : u.dailyReturnTotal;
        if (currentUser?.id === userId) setCurrentUser(cu => cu ? { ...cu, credits: newCredits, dailyReturnTotal: newDaily } : null);
        return { ...u, credits: newCredits, dailyReturnTotal: newDaily };
      }
      return u;
    }));
  }, [currentUser?.id, settings.dailyReturnLimit, addToast]);

  const updateOrder = useCallback((id: string, status: OrderStatus, metadata?: any) => {
    setOrders(prev => {
      const order = prev.find(o => o.id === id);
      if (!order) return prev;
      if (status === OrderStatus.DELIVERED && order.status !== OrderStatus.DELIVERED) {
        const points = Math.floor(order.total);
        setUsers(uPrev => uPrev.map(u => {
          if (u.id === order.customerId) {
            const customerOrders = prev.filter(ord => ord.customerId === u.id && ord.id !== id);
            const totalSpend = customerOrders.reduce((sum, ord) => sum + ord.total, 0) + order.total;
            const newTier = totalSpend > 500 ? UserTier.GOLD : totalSpend > 150 ? UserTier.SILVER : UserTier.BRONZE;
            if (currentUser?.id === u.id) {
              setCurrentUser(cu => cu ? { ...cu, loyaltyPoints: cu.loyaltyPoints + points, tier: newTier } : null);
              addToast(`+${points} POINTS EARNED`, 'success');
            }
            return { ...u, loyaltyPoints: u.loyaltyPoints + points, tier: newTier };
          }
          return u;
        }));
      }
      return prev.map(o => o.id === id ? { ...o, status, ...metadata } : o);
    });
  }, [currentUser?.id, addToast]);

  return {
    currentUser, setCurrentUser, users, setUsers, settings, setSettings,
    products, setProducts, orders, setOrders, approvals, setApprovals,
    auditLogs, setAuditLogs, cart, setCart, toasts, addToast, adjustCredits, updateOrder
  };
};

const App: React.FC = () => {
  const core = useNinpoCore();
  const [address, setAddress] = useState(() => localStorage.getItem('ninpo_last_address') || '');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [viewMode, setViewMode] = useState<'market' | 'management' | 'driver'>('market');
  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  // References for Payment SDKs
  const stripeRef = useRef<any>(null);
  const gpayClientRef = useRef<any>(null);

  useEffect(() => {
    if ((window as any).Stripe && STRIPE_PUBLISHABLE_KEY) {
      stripeRef.current = (window as any).Stripe(STRIPE_PUBLISHABLE_KEY);
    }
    if ((window as any).google?.payments?.api?.PaymentsClient) {
      gpayClientRef.current = new (window as any).google.payments.api.PaymentsClient({
        environment: GPAY_ENV as any
      });
    }
  }, []);

  const finalizeOrder = async (paymentMethod: 'CREDITS' | 'GOOGLE_PAY' | 'STRIPE_CARD') => {
    const subtotal = core.cart.reduce((s, i) => {
      const p = core.products.find(prod => prod.id === i.productId);
      return s + (p?.price || 0) * i.quantity;
    }, 0);
    const fee = core.currentUser?.tier === UserTier.GOLD ? 0 : core.settings.deliveryFee;
    const total = subtotal + fee;

    const newOrder: Order = {
      id: `ORD-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      customerId: core.currentUser!.id,
      items: [...core.cart],
      total,
      estimatedReturnCredit: 0,
      paymentMethod,
      address,
      status: OrderStatus.PAID,
      createdAt: new Date().toISOString(),
    };

    core.setProducts(prev => prev.map(p => {
      const item = core.cart.find(i => i.productId === p.id);
      return item ? { ...p, stock: Math.max(0, p.stock - item.quantity) } : p;
    }));

    core.setOrders(prev => [newOrder, ...prev]);
    core.setCart([]);
    setIsProcessingOrder(false);
    setIsCartOpen(false);
    core.addToast("HUB DISPATCHING CARGO TO " + address.toUpperCase(), 'success');
  };

  const handleCreateOrder = async () => {
    if (isProcessingOrder || !core.currentUser || core.cart.length === 0 || !address.trim() || !acceptedPolicies) return;
    const subtotal = core.cart.reduce((s, i) => {
      const p = core.products.find(prod => prod.id === i.productId);
      return s + (p?.price || 0) * i.quantity;
    }, 0);
    const fee = core.currentUser.tier === UserTier.GOLD ? 0 : core.settings.deliveryFee;
    const total = subtotal + fee;

    if (core.currentUser.credits < total) {
      core.addToast("INSUFFICIENT CREDITS", 'warning');
      return;
    }

    setIsProcessingOrder(true);
    await new Promise(r => setTimeout(r, 1200));
    core.adjustCredits(core.currentUser.id, -total, 'PURCHASE');
    await finalizeOrder('CREDITS');
  };

  const handleExternalPayment = async (type: 'STRIPE' | 'GPAY') => {
    if (isProcessingOrder || !core.currentUser || core.cart.length === 0 || !address.trim() || !acceptedPolicies) return;
    setIsProcessingOrder(true);
    core.addToast(`SECURE HANDSHAKE: ${type}`, 'info');

    try {
      if (type === 'GPAY') {
        if (!gpayClientRef.current) throw new Error("GPAY_NOT_CONFIGURED");
        
        const paymentDataRequest = {
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: [{
            type: 'CARD',
            parameters: { 
              allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"], 
              allowedCardNetworks: ["VISA", "MASTERCARD"] 
            },
            tokenizationSpecification: { 
              type: 'PAYMENT_GATEWAY', 
              parameters: { 
                'gateway': 'stripe', 
                'stripe:version': '2020-08-27', 
                'stripe:publishableKey': STRIPE_PUBLISHABLE_KEY 
              } 
            }
          }],
          merchantInfo: { 
            merchantId: GPAY_MERCHANT_ID, 
            merchantName: 'Ninpo Snacks' 
          },
          transactionInfo: { 
            totalPriceStatus: 'FINAL', 
            totalPrice: '1.00', 
            currencyCode: 'USD', 
            countryCode: 'US' 
          }
        };
        await new Promise(r => setTimeout(r, 1500));
      } else if (type === 'STRIPE') {
        if (!stripeRef.current) throw new Error("STRIPE_NOT_CONFIGURED");
        // Simulated Stripe Checkout Redirect
        await new Promise(r => setTimeout(r, 1500));
      }

      core.addToast("EXTERNAL AUTH SUCCESSFUL", 'success');
      await finalizeOrder(type === 'STRIPE' ? 'STRIPE_CARD' : 'GOOGLE_PAY');
    } catch (err) {
      core.addToast(`GATEWAY ERROR: CHECK LOGS`, 'warning');
      setIsProcessingOrder(false);
    }
  };

  return (
    <div className="min-h-screen bg-ninpo-black text-white flex flex-col relative overflow-x-hidden selection:bg-ninpo-lime selection:text-ninpo-black">
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
        {viewMode === 'market' && (
          <CustomerView 
            products={core.products} 
            orders={core.orders.filter(o => o.customerId === core.currentUser?.id)} 
            currentUser={core.currentUser} 
            openLogin={() => setIsLoginViewOpen(true)} 
            onRequestRefund={() => {}} 
            addToCart={(id) => {
              if (!core.currentUser) { setIsLoginViewOpen(true); return; }
              core.setCart(prev => {
                const existing = prev.find(i => i.productId === id);
                return existing ? prev.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i) : [...prev, { productId: id, quantity: 1 }];
              });
              core.addToast("ADDED TO CARGO");
            }} 
            updateUserProfile={() => {}} 
            reorderItems={() => {}} 
            onRedeemPoints={() => {}} 
          />
        )}
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
                <button onClick={handleCreateOrder} disabled={!address.trim() || !acceptedPolicies || isProcessingOrder || core.cart.length === 0} className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[10px] shadow-neon flex items-center justify-center gap-2 disabled:opacity-30">
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
