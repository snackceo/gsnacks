
import React, { useState, useEffect, useRef } from 'react';
import { UserRole, User, UserTier, Product, Order, OrderStatus, AppSettings, ApprovalRequest, AuditLog, PaymentMethod } from './types';
import { MOCK_PRODUCTS } from './constants';
import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import DriverView from './views/DriverView';
import LoginView from './views/LoginView';
import LegalFooter from './components/LegalFooter';
import { 
  ShoppingBag, X, Minus, Plus, Trash2, Recycle, 
  CreditCard, MapPin, ArrowRight, Loader2, Wallet, Camera, ShieldCheck, Ticket, Truck, BarChart4, MessageSquare, Send, Sparkles, Activity, Award, Smartphone, AlertCircle, RefreshCw
} from 'lucide-react';
import { analyzeBottleScan } from './services/geminiService';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App: React.FC = () => {
  // --- CORE STATE PERSISTENCE ---
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('ninpo_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem('ninpo_all_users');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      { id: 'custo_001', name: 'Alex Johnson', email: 'alex@customail.com', role: UserRole.CUSTOMER, tier: UserTier.BRONZE, credits: 24.50, referralCode: 'ALEX77', loyaltyPoints: 1250, dailyReturnTotal: 0 },
      { id: 'owner_001', name: 'Executive Admin', email: 'eve@owner.com', role: UserRole.OWNER, tier: UserTier.GOLD, credits: 1000.00, referralCode: 'BOSS_ONE', loyaltyPoints: 9999, dailyReturnTotal: 0 },
      { id: 'driver_001', name: 'Delivery Unit 01', email: 'unit1@ninpo.com', role: UserRole.DRIVER, tier: UserTier.SILVER, credits: 0, referralCode: 'FAST01', loyaltyPoints: 2500, dailyReturnTotal: 0 }
    ];
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('ninpo_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      deliveryFee: 2.99,
      referralBonus: 5.00,
      michiganDepositValue: 0.10,
      processingFeePercent: 0.05, // 5% base processing
      glassHandlingFeePercent: 0.02, // 2% extra for glass
      dailyReturnLimit: 25.00,
      maintenanceMode: false,
    };
  });

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('ninpo_products');
    return saved ? JSON.parse(saved) : MOCK_PRODUCTS;
  });
  
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('ninpo_orders');
    return saved ? JSON.parse(saved) : [];
  });

  const [approvals, setApprovals] = useState<ApprovalRequest[]>(() => {
    const saved = localStorage.getItem('ninpo_approvals');
    return saved ? JSON.parse(saved) : [];
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem('ninpo_logs');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(() => {
    try {
      const saved = localStorage.getItem('ninpo_cart');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [address, setAddress] = useState(() => localStorage.getItem('ninpo_last_address') || '');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [useCredits, setUseCredits] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('STRIPE_CARD');
  
  // UI State
  const [viewMode, setViewMode] = useState<'market' | 'management' | 'delivery'>('market');
  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [apiPulse, setApiPulse] = useState<'nominal' | 'loading' | 'error'>('nominal');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  const [pendingBottleCredits, setPendingBottleCredits] = useState(0);
  const [capturedProofs, setCapturedProofs] = useState<string[]>([]);
  
  const [supportMessage, setSupportMessage] = useState('');
  const [supportChat, setSupportChat] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [isAiTyping, setIsAiTyping] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- PERSISTENCE ---
  useEffect(() => {
    localStorage.setItem('ninpo_orders', JSON.stringify(orders));
    localStorage.setItem('ninpo_all_users', JSON.stringify(users));
    localStorage.setItem('ninpo_products', JSON.stringify(products));
    localStorage.setItem('ninpo_approvals', JSON.stringify(approvals));
    localStorage.setItem('ninpo_logs', JSON.stringify(auditLogs));
    localStorage.setItem('ninpo_settings', JSON.stringify(settings));
    localStorage.setItem('ninpo_cart', JSON.stringify(cart));
    localStorage.setItem('ninpo_last_address', address);
    if (currentUser) localStorage.setItem('ninpo_user', JSON.stringify(currentUser));
    else localStorage.removeItem('ninpo_user');
  }, [orders, users, products, currentUser, approvals, auditLogs, settings, cart, address]);

  // --- CROSS-TAB SYNC ---
  useEffect(() => {
    const handleHubSync = (e: StorageEvent) => {
      if (!e.newValue) return;
      try {
        if (e.key === 'ninpo_products') setProducts(JSON.parse(e.newValue));
        if (e.key === 'ninpo_orders') setOrders(JSON.parse(e.newValue));
        if (e.key === 'ninpo_all_users') setUsers(JSON.parse(e.newValue));
      } catch (err) { console.debug("Sync skip - expected during update"); }
    };
    window.addEventListener('storage', handleHubSync);
    return () => window.removeEventListener('storage', handleHubSync);
  }, []);

  const logAction = (userId: string, action: string, metadata: any) => {
    const newLog: AuditLog = {
      id: `LOG-${Date.now()}`,
      userId,
      action,
      metadata,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [...prev, newLog]);
  };

  const calculateFinalTotal = () => {
    const subtotal = cart.reduce((s, i) => {
      const p = products.find(prod => prod.id === i.productId);
      return s + (p?.price || 0) * i.quantity;
    }, 0);
    
    // Add Processing Fees
    const baseProcessing = subtotal * settings.processingFeePercent;
    
    // Add Glass Fees
    const glassFee = cart.reduce((s, i) => {
      const p = products.find(prod => prod.id === i.productId);
      return p?.isGlass ? s + (p.price * settings.glassHandlingFeePercent * i.quantity) : s;
    }, 0);

    let total = subtotal + baseProcessing + glassFee + getDeliveryFee() - pendingBottleCredits;
    
    if (useCredits && currentUser) {
      const creditToApply = Math.min(total, currentUser.credits);
      total -= creditToApply;
    }
    
    return Math.max(0, total);
  };

  const getDeliveryFee = () => {
    if (!currentUser) return settings.deliveryFee;
    if (currentUser.tier === UserTier.GOLD) return 0;
    if (currentUser.tier === UserTier.SILVER) return settings.deliveryFee / 2;
    return settings.deliveryFee;
  };

  const handleAddToCart = (id: string) => {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    if (p.stock <= 0) {
      setSyncNotice("Logistics Error: Stock Depleted");
      setTimeout(() => setSyncNotice(null), 3000);
      return;
    }
    
    setCart(prev => {
      const existing = prev.find(i => i.productId === id);
      if (existing) {
        if (existing.quantity >= p.stock) return prev;
        return prev.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { productId: id, quantity: 1 }];
    });
    
    setSyncNotice(`${p.name} Pipeline Entry`);
    setTimeout(() => setSyncNotice(null), 1500);
  };

  const handleCreateOrder = async () => {
    if (!address.trim() || !acceptedPolicies || !currentUser || cart.length === 0) return;
    setIsProcessingOrder(true);
    setApiPulse('loading');

    // Simulate Network/Stripe Latency
    await new Promise(r => setTimeout(r, 2000));

    // JIT Verification
    const latestStock = [...products];
    let stockValid = true;
    cart.forEach(item => {
      const p = latestStock.find(prod => prod.id === item.productId);
      if (!p || p.stock < item.quantity) stockValid = false;
    });

    if (!stockValid) {
      alert("Inventory Conflict: One or more items sold out during checkout.");
      setIsProcessingOrder(false);
      setApiPulse('nominal');
      return;
    }

    const finalTotal = calculateFinalTotal();
    const orderId = `ORD-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const timestamp = new Date().toISOString();

    setProducts(prev => prev.map(p => {
      const item = cart.find(i => i.productId === p.id);
      return item ? { ...p, stock: p.stock - item.quantity } : p;
    }));

    let usedCredits = 0;
    if (useCredits) {
      const preCredTotal = calculateFinalTotal() + (useCredits ? Math.min(calculateFinalTotal(), currentUser.credits) : 0);
      usedCredits = Math.min(preCredTotal, currentUser.credits);
    }

    const newOrder: Order = {
      id: orderId,
      customerId: currentUser.id,
      items: [...cart],
      total: finalTotal,
      estimatedReturnCredit: pendingBottleCredits,
      paymentMethod: finalTotal === 0 && usedCredits > 0 ? 'CREDITS' : selectedPaymentMethod,
      address,
      status: OrderStatus.PAID,
      createdAt: timestamp,
      paidAt: timestamp,
    };

    setOrders(prev => [newOrder, ...prev]);
    
    const updatedUser = {
      ...currentUser,
      credits: currentUser.credits - usedCredits,
      loyaltyPoints: currentUser.loyaltyPoints + Math.floor(finalTotal * 10),
      dailyReturnTotal: currentUser.dailyReturnTotal + pendingBottleCredits
    };

    setCurrentUser(updatedUser);
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    logAction(currentUser.id, 'ORDER_EXECUTE', { orderId, total: finalTotal });

    setCart([]);
    setPendingBottleCredits(0);
    setUseCredits(false);
    setIsProcessingOrder(false);
    setIsCartOpen(false);
    setApiPulse('nominal');
    setSyncNotice("Logistics Phase Initiated");
    setTimeout(() => setSyncNotice(null), 4000);
  };

  const updateOrderState = (id: string, status: OrderStatus, metadata?: any) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...metadata, driverId: metadata?.driverId || o.driverId } : o));
    logAction('HUB_AUTH', 'STATUS_CHANGE', { id, status });
  };

  const sendSupportMsg = async () => {
    if (!supportMessage.trim()) return;
    const userMsg = supportMessage;
    setSupportMessage('');
    setSupportChat(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsAiTyping(true);
    setApiPulse('loading');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: userMsg,
        config: {
          systemInstruction: 'Ninpo Snacks Logistics Support. Be helpful, concise, and professional. Focus on Michigan bottle laws and delivery estimates.',
        },
      });
      setSupportChat(prev => [...prev, { role: 'ai', text: response.text || "Connection unstable." }]);
    } catch (e) {
      setSupportChat(prev => [...prev, { role: 'ai', text: "Support node offline." }]);
    } finally {
      setIsAiTyping(false);
      setApiPulse('nominal');
    }
  };

  return (
    <div className="min-h-screen bg-ninpo-black font-sans text-white flex flex-col relative overflow-x-hidden">
      {syncNotice && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[11000] animate-in slide-in-bottom">
           <div className="bg-ninpo-lime text-ninpo-black px-10 py-5 rounded-full border border-ninpo-lime/50 shadow-neon flex items-center gap-4">
              <Sparkles className="w-5 h-5 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-[0.3em]">{syncNotice}</span>
           </div>
        </div>
      )}

      <header className="px-6 pt-8 max-w-[1600px] w-full mx-auto z-50">
        <div className="bg-ninpo-midnight/80 backdrop-blur-xl rounded-[2.5rem] p-5 border border-white/10 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-5 cursor-pointer" onClick={() => setViewMode('market')}>
            <div className="w-14 h-14 bg-ninpo-lime rounded-2xl flex items-center justify-center shadow-neon">
              <span className="text-ninpo-black font-black text-3xl">N</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-white text-2xl font-black uppercase tracking-tighter block leading-none">NINPO</span>
              <span className="text-ninpo-lime text-2xl font-black uppercase tracking-tighter block leading-none">SNACKS</span>
            </div>
          </div>
          <div className="flex gap-2">
            {currentUser?.role === UserRole.OWNER && (
              <button onClick={() => setViewMode('management')} className={`bg-ninpo-grey text-white rounded-2xl px-5 py-4 font-black uppercase text-[9px] tracking-widest hover:bg-ninpo-lime hover:text-ninpo-black transition-all ${viewMode === 'management' ? 'bg-ninpo-lime text-ninpo-black' : ''}`}>
                <BarChart4 className="w-4 h-4" /> Hub Control
              </button>
            )}
            {currentUser?.role === UserRole.DRIVER && (
              <button onClick={() => setViewMode('delivery')} className={`bg-ninpo-grey text-white rounded-2xl px-5 py-4 font-black uppercase text-[9px] tracking-widest hover:bg-ninpo-lime hover:text-ninpo-black transition-all ${viewMode === 'delivery' ? 'bg-ninpo-lime text-ninpo-black' : ''}`}>
                <Truck className="w-4 h-4" /> Drive Hub
              </button>
            )}
            <button onClick={currentUser ? () => setCurrentUser(null) : () => setIsLoginViewOpen(true)} className="bg-ninpo-red text-white rounded-2xl px-6 py-4 font-black uppercase text-[9px] tracking-widest transition-all">
              {currentUser ? 'Logout' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-10 max-w-[1600px] w-full mx-auto">
        {viewMode === 'market' && (
          <CustomerView 
            products={products} 
            orders={orders.filter(o => o.customerId === currentUser?.id)} 
            currentUser={currentUser}
            openLogin={() => setIsLoginViewOpen(true)}
            onRequestRefund={(id) => {
              setApprovals(prev => [{
                id: `APR-${Date.now()}`,
                type: 'REFUND',
                status: 'PENDING',
                userId: currentUser?.id || 'sys',
                orderId: id,
                amount: orders.find(o => o.id === id)?.total || 0,
                createdAt: new Date().toISOString()
              }, ...prev]);
            }} 
            addToCart={handleAddToCart} 
            updateUserProfile={(up) => {
              const u = { ...currentUser!, ...up };
              setCurrentUser(u);
              setUsers(prev => prev.map(usr => usr.id === u.id ? u : usr));
            }}
            reorderItems={(items) => { setCart(items); setIsCartOpen(true); }}
            onRedeemPoints={(pts) => {
              const value = (pts / 1000) * 5;
              const u = { ...currentUser!, loyaltyPoints: currentUser!.loyaltyPoints - pts, credits: currentUser!.credits + value };
              setCurrentUser(u);
              setUsers(prev => prev.map(usr => usr.id === u.id ? u : usr));
            }}
          />
        )}

        {viewMode === 'management' && (
          <ManagementView 
            user={currentUser!} products={products} setProducts={setProducts} 
            orders={orders} users={users} settings={settings} setSettings={setSettings} 
            approvals={approvals} setApprovals={setApprovals} auditLogs={auditLogs} 
            updateOrder={updateOrderState} adjustCredits={(uid, amt, rsn) => {
              setUsers(prev => prev.map(u => u.id === uid ? { ...u, credits: u.credits + amt } : u));
              if (currentUser?.id === uid) setCurrentUser(prev => prev ? { ...prev, credits: prev.credits + amt } : null);
            }} 
            updateUserProfile={(id, up) => {
              setUsers(prev => prev.map(u => u.id === id ? { ...u, ...up } : u));
              if (currentUser?.id === id) setCurrentUser(prev => prev ? { ...prev, ...up } : null);
            }}
          />
        )}

        {viewMode === 'delivery' && (
          <DriverView orders={orders} updateOrder={(id, status, meta) => updateOrderState(id, status, {...meta, driverId: currentUser?.id})} />
        )}
      </main>

      {/* SUPPORT AI */}
      <div className="fixed bottom-32 right-8 z-[8000]">
        {isSupportOpen && (
          <div className="mb-4 w-80 h-[30rem] bg-ninpo-midnight rounded-[2.5rem] border border-ninpo-lime/20 flex flex-col p-6 shadow-2xl animate-in slide-in-bottom">
            <div className="flex justify-between items-center mb-4">
              <span className="text-ninpo-lime font-black uppercase text-[10px] tracking-widest flex items-center gap-2"><Sparkles className="w-3 h-3" /> Support Node</span>
              <button onClick={() => setIsSupportOpen(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar mb-4">
              {supportChat.map((c, i) => (
                <div key={i} className={`p-4 rounded-2xl text-[10px] font-bold ${c.role === 'ai' ? 'bg-ninpo-lime/5 text-ninpo-lime border border-ninpo-lime/10' : 'bg-white/5 text-slate-300 ml-6'}`}>{c.text}</div>
              ))}
              {isAiTyping && <div className="text-ninpo-lime text-[9px] font-black animate-pulse uppercase">Uplink active...</div>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={supportMessage} onChange={e => setSupportMessage(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendSupportMsg()} placeholder="Query hub..." className="flex-1 bg-ninpo-black border border-white/10 rounded-xl px-4 py-4 text-[11px] font-bold outline-none focus:border-ninpo-lime" />
              <button onClick={sendSupportMsg} className="p-4 bg-ninpo-lime text-ninpo-black rounded-xl hover:bg-white transition-all"><Send className="w-4 h-4" /></button>
            </div>
          </div>
        )}
        <button onClick={() => setIsSupportOpen(!isSupportOpen)} className="w-16 h-16 bg-ninpo-midnight border border-ninpo-lime/30 text-ninpo-lime rounded-2xl flex items-center justify-center hover:scale-110 shadow-xl backdrop-blur-md">
          <MessageSquare className="w-8 h-8" />
        </button>
      </div>

      {/* POLISHED CART DRAWER */}
      <div className={`fixed inset-0 z-[10000] ${isCartOpen ? 'visible' : 'invisible'}`}>
        <div className={`absolute inset-0 bg-ninpo-black/95 backdrop-blur-md transition-opacity duration-500 ${isCartOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => !isProcessingOrder && setIsCartOpen(false)} />
        <div className={`absolute right-0 w-full max-w-md bg-ninpo-midnight h-full border-l border-white/10 flex flex-col p-8 transition-transform duration-500 ease-out ${isCartOpen ? 'translate-x-0' : 'translate-x-full'}`}>
           <div className="flex justify-between items-center mb-10">
              <h3 className="text-2xl font-black uppercase tracking-tighter">Cart Pipeline</h3>
              <button onClick={() => setIsCartOpen(false)} className="p-3 bg-white/5 rounded-xl text-slate-400 hover:text-white transition-all"><X className="w-6 h-6" /></button>
           </div>
           
           <div className="flex-1 overflow-y-auto space-y-6 no-scrollbar pr-2">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 text-slate-700 space-y-6">
                   <ShoppingBag className="w-20 h-20 opacity-10" />
                   <p className="text-[10px] font-black uppercase tracking-[0.4em]">Empty Protocol</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    {cart.map((item, idx) => {
                      const p = products.find(prod => prod.id === item.productId);
                      if (!p) return null;
                      return (
                        <div key={idx} className="p-5 rounded-[2.5rem] flex flex-col gap-4 border border-white/5 bg-white/5 group hover:border-white/10">
                           <div className="flex items-center gap-4">
                              <img src={p.image} className="w-16 h-16 rounded-2xl object-cover grayscale group-hover:grayscale-0 transition-all" alt={p.name} />
                              <div className="flex-1">
                                  <p className="text-white font-black text-xs uppercase tracking-tight">{p.name}</p>
                                  <p className="text-ninpo-lime font-bold text-[13px] mt-1">${p.price.toFixed(2)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                  <div className="flex items-center bg-ninpo-black/50 rounded-xl border border-white/5 px-1 py-1">
                                    <button onClick={() => setCart(prev => prev.map(i => i.productId === item.productId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i))} className="p-2 text-slate-500 hover:text-white"><Minus className="w-3 h-3"/></button>
                                    <span className="text-[11px] font-black w-6 text-center">{item.quantity}</span>
                                    <button disabled={p.stock <= item.quantity} onClick={() => setCart(prev => prev.map(i => i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i))} className="p-2 text-slate-500 hover:text-white disabled:opacity-20"><Plus className="w-3 h-3"/></button>
                                  </div>
                                  <button onClick={() => setCart(prev => prev.filter((_, i) => i !== idx))} className="p-3 text-ninpo-red/50 hover:text-ninpo-red bg-ninpo-red/5 rounded-xl"><Trash2 className="w-4 h-4" /></button>
                              </div>
                           </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="bg-white/5 p-6 rounded-[2.2rem] border border-white/10 space-y-4">
                     <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block px-2">Drop-off Node</label>
                     <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="Full Delivery Address..." className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-6 text-white font-bold text-sm outline-none focus:border-ninpo-lime" />
                     <div className="flex items-start gap-4 px-2 group cursor-pointer" onClick={() => setAcceptedPolicies(!acceptedPolicies)}>
                        <input type="checkbox" checked={acceptedPolicies} onChange={e => setAcceptedPolicies(e.target.checked)} className="w-7 h-7 accent-ninpo-lime mt-1 cursor-pointer" />
                        <p className="text-[10px] font-black text-slate-400 uppercase leading-relaxed group-hover:text-slate-200">I authorize logistics and verify ECO audit metrics.</p>
                     </div>
                  </div>
                </>
              )}
           </div>

           <div className="pt-8 mt-auto border-t border-white/10">
              <div className="flex justify-between items-center mb-8 px-2">
                <div>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Final Authorized Value</span>
                  <span className="text-4xl font-black text-white tracking-tighter">${calculateFinalTotal().toFixed(2)}</span>
                </div>
              </div>
              <button 
                disabled={isProcessingOrder || !address.trim() || !acceptedPolicies || cart.length === 0} 
                onClick={handleCreateOrder} 
                className="w-full py-7 bg-ninpo-lime text-ninpo-black rounded-[2rem] font-black uppercase text-[13px] tracking-[0.2em] shadow-neon flex items-center justify-center gap-4 hover:bg-white active:scale-95 transition-all disabled:opacity-20"
              >
                 {isProcessingOrder ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Execute Pipeline <ShieldCheck className="w-6 h-6" /></>}
              </button>
           </div>
        </div>
      </div>

      <button onClick={() => setIsCartOpen(true)} className="fixed bottom-8 right-8 z-[9000] w-20 h-20 bg-ninpo-lime text-ninpo-black rounded-3xl shadow-neon flex items-center justify-center border-4 border-ninpo-black hover:scale-110 active:scale-90 transition-all">
        <ShoppingBag className="w-10 h-10" />
        {cart.length > 0 && <div className="absolute -top-3 -right-3 w-8 h-8 bg-ninpo-red text-white text-xs font-black rounded-full flex items-center justify-center border-4 border-ninpo-black">{cart.reduce((s,i)=>s+i.quantity, 0)}</div>}
      </button>

      {isLoginViewOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-3xl" onClick={() => setIsLoginViewOpen(false)} />
          <LoginView users={users} onLogin={u => {setCurrentUser(u); setIsLoginViewOpen(false);}} onRegister={u => {setUsers([...users, u]); setCurrentUser(u); setIsLoginViewOpen(false);}} onCancel={() => setIsLoginViewOpen(false)} />
        </div>
      )}

      <LegalFooter />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default App;
