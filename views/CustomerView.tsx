
import React, { useState, useRef, useEffect } from 'react';
import { Product, Order, User, AppSettings, OrderStatus, PaymentMethod } from '../types';
import { 
  ShoppingBag, Plus, Search, Recycle, Camera, X, CheckCircle2, 
  AlertTriangle, ChevronRight, Wallet, Banknote, Trash2, Beaker, 
  Wine, Coffee, MapPin, CreditCard, Smartphone, ShieldCheck, Loader2,
  ScanSearch, Barcode, ToggleLeft, ToggleRight, Sparkles, Award,
  ArrowUpDown, ChevronLeft, Minus, MessageSquare, Send, Gift, Cpu, Stars,
  ThumbsUp, Info, XCircle
} from 'lucide-react';
import { analyzeBottleScan, getAgentSupportResponse, getSmartSnackRecommendations } from '../services/geminiService';

interface ReturnItem {
  id: string;
  type: 'PLASTIC' | 'CAN' | 'GLASS' | 'UNKNOWN';
  message: string;
}

interface CustomerViewProps {
  products: Product[];
  cart: { productId: string; quantity: number }[];
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  updateCartQuantity: (id: string, q: number) => void;
  createOrder: (order: Order) => void;
  orders: Order[];
  user: User;
  settings: AppSettings;
  onCreditUpdate: (amount: number) => void;
}

const CustomerView: React.FC<CustomerViewProps> = ({ 
  products, 
  cart, 
  addToCart, 
  removeFromCart,
  updateCartQuantity,
  createOrder,
  orders,
  user, 
  settings, 
  onCreditUpdate 
}) => {
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [sortBy, setSortBy] = useState<'NONE' | 'PRICE_ASC' | 'PRICE_DESC' | 'STOCK'>('NONE');
  const [isReturnTerminalOpen, setIsReturnTerminalOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<{ valid: boolean; message: string; material?: string } | null>(null);
  const [returnBasket, setReturnBasket] = useState<ReturnItem[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [useAccountCredits, setUseAccountCredits] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [isReferralApplied, setIsReferralApplied] = useState(false);
  
  // Smart Recommendations
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  // Support Chat State
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportQuery, setSupportQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'agent', text: string}[]>([]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  // Rewards State
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);

  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('STRIPE_CARD');
  const [checkoutStep, setCheckoutStep] = useState<'ITEMS' | 'LOGISTICS' | 'PAYMENT'>('ITEMS');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isScanning && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
  }, [isScanning, stream]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Logic for smart recommendations
  useEffect(() => {
    const fetchRecs = async () => {
      if (user.id !== 'custo_001') {
        setIsLoadingRecs(true);
        const prefs = orders.length > 0 
          ? `User likes ${orders.map(o => o.items.map(i => products.find(p => p.id === i.productId)?.name).join(', ')).join(' and ')}`
          : "User is new, show popular spicy or sweet items.";
        
        const result = await getSmartSnackRecommendations(products, prefs);
        setRecommendedIds(result.recommendedIds || []);
        setIsLoadingRecs(false);
      }
    };
    fetchRecs();
  }, [user.id, products.length]);

  const isAuthenticated = user.role !== undefined && user.id !== 'custo_001'; 
  
  let filteredProducts = activeCategory === 'ALL' 
    ? [...products] 
    : products.filter(p => p.category.toUpperCase() === activeCategory);

  if (sortBy === 'PRICE_ASC') filteredProducts.sort((a, b) => a.price - b.price);
  if (sortBy === 'PRICE_DESC') filteredProducts.sort((a, b) => b.price - a.price);
  if (sortBy === 'STOCK') filteredProducts.sort((a, b) => b.stock - a.stock);

  const calculateReturnStats = () => {
    const validItems = returnBasket.filter(b => b.type !== 'UNKNOWN');
    const totalCount = validItems.length;
    const glassCount = validItems.filter(b => b.type === 'GLASS').length;
    const gross = totalCount * settings.michiganDepositValue;
    const fee = gross * settings.processingFeePercent;
    const glassFee = glassCount * (settings.michiganDepositValue * settings.glassHandlingFeePercent);
    return { net: Math.max(0, gross - fee - glassFee), total: totalCount };
  };

  const returnStats = calculateReturnStats();

  const calculateCartStats = () => {
    let subtotal = 0;
    let deposits = 0;
    cart.forEach(item => {
      const p = products.find(prod => prod.id === item.productId);
      if (p) {
        subtotal += p.price * item.quantity;
        deposits += (p.deposit || 0) * item.quantity;
      }
    });
    
    let grossTotal = subtotal + deposits + settings.deliveryFee;
    if (isReferralApplied) grossTotal = Math.max(0, grossTotal - settings.referralBonus);

    const bottleCreditOffset = returnStats.net;
    const maxApplicableAccountCredits = Math.max(0, grossTotal - bottleCreditOffset);
    const accountCreditOffset = useAccountCredits ? Math.min(user.credits, maxApplicableAccountCredits) : 0;
    
    const finalTotal = Math.max(0, grossTotal - bottleCreditOffset - accountCreditOffset);
    
    return { 
      subtotal, 
      deposits, 
      bottleCreditOffset,
      accountCreditOffset,
      referralDiscount: isReferralApplied ? settings.referralBonus : 0,
      total: finalTotal 
    };
  };

  const cartStats = calculateCartStats();

  const handlePlaceOrder = () => {
    if (!address) {
      alert("Please enter a delivery address.");
      return;
    }
    const newOrder: Order = {
      id: `ORD-${Math.floor(Math.random() * 1000000)}`,
      customerId: user.id,
      items: [...cart],
      total: cartStats.total,
      estimatedReturnCredit: returnStats.net,
      paymentMethod,
      address,
      status: OrderStatus.PENDING,
      createdAt: new Date().toISOString(),
    };
    
    if (useAccountCredits && cartStats.accountCreditOffset > 0) {
      onCreditUpdate(-cartStats.accountCreditOffset);
    }
    
    createOrder(newOrder);
    setIsCheckoutOpen(false);
    setCheckoutStep('ITEMS');
    setReturnBasket([]);
    setUseAccountCredits(false);
    setIsReferralApplied(false);
    setReferralCode('');
    alert("Order placed! Your snacks are on the way.");
  };

  const handleApplyReferral = () => {
    if (referralCode.length > 3) {
      setIsReferralApplied(true);
      alert(`Referral applied! $${settings.referralBonus.toFixed(2)} off.`);
    }
  };

  const handleSendSupportMessage = async () => {
    if (!supportQuery.trim()) return;
    const userMsg = supportQuery;
    setChatHistory(prev => [...prev, {role: 'user', text: userMsg}]);
    setSupportQuery('');
    setIsAgentTyping(true);

    const context = {
      userName: user.name,
      credits: user.credits,
      loyaltyPoints: user.loyaltyPoints,
      activeOrders: orders.filter(o => o.status !== OrderStatus.DELIVERED).length
    };

    const response = await getAgentSupportResponse(userMsg, context);
    setIsAgentTyping(false);
    setChatHistory(prev => [...prev, {role: 'agent', text: response || "I'm sorry, I'm having trouble connecting to our systems."}]);
  };

  const redeemReward = (points: number, creditAmount: number) => {
    if (user.loyaltyPoints >= points) {
      onCreditUpdate(creditAmount);
      alert(`Redeemed ${points} points for $${creditAmount} credit!`);
    } else {
      alert("Not enough points.");
    }
  };

  const startScanner = async () => {
    if (stream) {
      stopScanner();
    }
    setScanResult(null);
    
    try {
      const constraints = { 
        video: { 
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      };
      
      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (fallbackErr) {
        newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      
      setStream(newStream);
      setIsScanning(true);
    } catch (err: any) {
      setIsScanning(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert("Camera access denied. Please enable camera permissions.");
      } else {
        alert("Unable to access camera.");
      }
    }
  };

  const stopScanner = () => {
    if (stream) {
      stream.getTracks().forEach(t => {
        t.stop();
        stream.removeTrack(t);
      });
      setStream(null);
    }
    setIsScanning(false);
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) return;
    setIsAnalyzing(true);
    setScanResult(null); // Clear previous result to show fresh "analyzing" state if needed

    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      setScanResult({ valid: true, message: "Analyzing bottle via Ninpo Vision..." }); 
      const result = await analyzeBottleScan(base64Data);
      setScanResult(result);
      setIsAnalyzing(false);

      if (result.valid) {
        const materialType = result.material?.toUpperCase() as any;
        setReturnBasket(prev => [...prev, { 
          id: Math.random().toString(36).substr(2, 9), 
          type: ['PLASTIC', 'CAN', 'GLASS'].includes(materialType) ? materialType : 'UNKNOWN',
          message: result.message
        }]);
        // Leave result visible for positive reinforcement
        setTimeout(() => setScanResult(null), 4000);
      } else {
        // Errors stay a bit longer so they can be read
        setTimeout(() => setScanResult(null), 5000);
      }
    } else {
      setIsAnalyzing(false);
    }
  };

  const handleStandaloneReturn = (method: 'CREDIT' | 'CASH') => {
    onCreditUpdate(method === 'CREDIT' ? returnStats.net : 0);
    alert(`${method === 'CREDIT' ? 'Account' : 'Cash'} credit successful: $${returnStats.net.toFixed(2)}.`);
    setReturnBasket([]);
    setIsReturnTerminalOpen(false);
    stopScanner();
  };

  return (
    <div className="space-y-12 animate-in fade-in pb-20">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row items-stretch gap-4 max-w-6xl mx-auto w-full">
        <div className="relative flex-1">
          <input type="text" placeholder="Search snacks..." className="w-full bg-white text-slate-900 px-10 py-6 rounded-[2rem] font-bold focus:outline-none border-4 border-transparent focus:border-ninpo-lime transition-all shadow-xl" />
          <Search className="absolute right-8 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300" />
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsRewardsOpen(true)}
            className="bg-ninpo-grey px-8 py-4 rounded-[2rem] border border-white/5 flex items-center gap-3 hover:border-amber-400 transition-all"
          >
            <Award className="w-5 h-5 text-amber-400" />
            <div>
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Points</p>
              <p className="text-white font-black text-sm">{user.loyaltyPoints.toLocaleString()}</p>
            </div>
          </button>
          {isAuthenticated && (
            <button onClick={() => { setIsReturnTerminalOpen(true); startScanner(); }} className="bg-ninpo-lime text-ninpo-black px-10 py-6 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-xl">
              <Recycle className="w-5 h-5" /> Bottle Return
            </button>
          )}
        </div>
      </div>

      {/* AI Recommendations Shelf */}
      {isAuthenticated && recommendedIds.length > 0 && (
        <section className="space-y-6 animate-in slide-in-bottom">
           <div className="flex items-center gap-4">
              <div className="p-3 bg-ninpo-lime/10 rounded-xl border border-ninpo-lime/20"><Stars className="w-6 h-6 text-ninpo-lime" /></div>
              <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Personalized Picks</h3>
           </div>
           <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {recommendedIds.map(id => {
                const p = products.find(prod => prod.id === id);
                return p && (
                  <div key={`rec-${p.id}`} className="bg-ninpo-midnight/60 rounded-[2.5rem] border border-ninpo-lime/20 overflow-hidden group flex flex-col h-full shadow-2xl relative">
                    <div className="absolute top-3 left-3 z-10 bg-ninpo-black/80 px-2 py-1 rounded-lg border border-ninpo-lime/40">
                      <span className="text-[8px] font-black text-ninpo-lime uppercase tracking-widest">AI MATCH</span>
                    </div>
                    <div className="relative aspect-square overflow-hidden">
                      <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-60 group-hover:opacity-100" />
                    </div>
                    <div className="p-5 flex flex-col flex-1 justify-between">
                      <h4 className="text-white font-bold text-[11px] uppercase mb-4 leading-tight">{p.name}</h4>
                      <div className="flex justify-between items-center">
                        <span className="text-ninpo-lime font-black text-lg">${p.price.toFixed(2)}</span>
                        <button onClick={() => addToCart(p.id)} className="w-8 h-8 bg-ninpo-lime rounded-lg flex items-center justify-center text-ninpo-black hover:scale-110 active:scale-90 transition-all">
                          <Plus className="w-5 h-5 stroke-[3px]" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
           </div>
        </section>
      )}

      {/* Marketplace */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Marketplace</h3>
          <div className="flex flex-wrap gap-2 bg-ninpo-midnight p-1.5 rounded-2xl border border-white/5">
            {['ALL', 'SNACKS', 'DRINK', 'HEALTHY'].map(cat => (
              <button 
                key={cat} 
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeCategory === cat ? 'bg-ninpo-lime text-ninpo-black' : 'text-slate-500 hover:text-white'}`}
              >
                {cat}
              </button>
            ))}
            <div className="w-px bg-white/10 mx-2" />
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-400 focus:outline-none cursor-pointer hover:text-white px-2"
            >
              <option value="NONE">Default Sort</option>
              <option value="PRICE_ASC">Price: Low-High</option>
              <option value="PRICE_DESC">Price: High-Low</option>
              <option value="STOCK">Stock Level</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {filteredProducts.map(p => (
            <div key={p.id} className="bg-ninpo-card rounded-[2.5rem] border border-white/5 overflow-hidden group flex flex-col h-full shadow-xl hover:border-ninpo-lime/30 transition-all duration-300">
              <div className="relative aspect-square overflow-hidden">
                <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={p.name} />
                <div className="absolute top-4 right-4 bg-ninpo-black/90 px-3 py-1.5 rounded-lg border border-ninpo-lime/40">
                  <span className="text-ninpo-lime font-black text-[10px] uppercase">Stock: {p.stock}</span>
                </div>
              </div>
              <div className="p-6 flex flex-col flex-1 justify-between">
                <h4 className="text-white font-bold text-sm uppercase mb-4 leading-tight">{p.name}</h4>
                <div className="flex justify-between items-center">
                  <span className="text-ninpo-lime font-black text-xl">${p.price.toFixed(2)}</span>
                  <button onClick={() => addToCart(p.id)} className="w-10 h-10 bg-ninpo-lime rounded-xl flex items-center justify-center text-ninpo-black hover:scale-110 active:scale-90 transition-all shadow-xl">
                    <Plus className="w-6 h-6 stroke-[3px]" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Rewards Store Modal */}
      {isRewardsOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-xl" onClick={() => setIsRewardsOpen(false)} />
          <div className="relative bg-ninpo-midnight w-full max-w-2xl rounded-[3rem] border border-white/10 p-10 overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center mb-10">
               <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-amber-400 rounded-2xl flex items-center justify-center shadow-lg"><Gift className="w-8 h-8 text-ninpo-black" /></div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Rewards Store</h3>
               </div>
               <button onClick={() => setIsRewardsOpen(false)} className="p-4 bg-white/5 rounded-2xl text-slate-400 hover:text-white transition-all"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="grid gap-4">
              {[
                {id: '1', points: 500, label: '$5.00 Credit', value: 5.00},
                {id: '2', points: 1000, label: '$12.00 Credit', value: 12.00},
                {id: '3', points: 2500, label: '$35.00 Credit', value: 35.00}
              ].map(reward => (
                <div key={reward.id} className="bg-ninpo-black p-6 rounded-[2rem] border border-white/5 flex items-center justify-between group hover:border-amber-400/30 transition-all">
                  <div className="flex items-center gap-5">
                    <Award className="w-8 h-8 text-amber-400" />
                    <div>
                      <h4 className="text-white font-bold text-lg uppercase tracking-tight">{reward.label}</h4>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{reward.points} Points required</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => redeemReward(reward.points, reward.value)}
                    disabled={user.loyaltyPoints < reward.points}
                    className="px-8 py-3 bg-amber-400 text-ninpo-black rounded-xl font-black uppercase text-[10px] tracking-widest disabled:opacity-20 hover:scale-105 active:scale-95 transition-all"
                  >
                    Redeem
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Support Chat Overlay */}
      <div className={`fixed bottom-32 left-8 z-[140] flex flex-col items-start transition-all ${isSupportOpen ? 'w-full max-w-sm' : 'w-24'}`}>
        {isSupportOpen && (
          <div className="w-full bg-ninpo-midnight rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col mb-4 animate-in slide-in-bottom h-[500px]">
            <div className="bg-ninpo-lime p-6 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-ninpo-black rounded-xl flex items-center justify-center"><Cpu className="w-6 h-6 text-ninpo-lime" /></div>
                <h4 className="text-ninpo-black font-black uppercase text-xs tracking-widest">Ninpo AI Support</h4>
              </div>
              <button onClick={() => setIsSupportOpen(false)} className="text-ninpo-black hover:opacity-50 transition-opacity"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
              <div className="bg-ninpo-black/40 p-4 rounded-2xl border border-white/5">
                <p className="text-[11px] text-slate-300 font-bold leading-relaxed uppercase">Hello {user.name}! I'm the Ninpo Logistics Assistant. How can I help you today?</p>
              </div>
              {chatHistory.map((chat, idx) => (
                <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`p-4 rounded-2xl max-w-[85%] ${chat.role === 'user' ? 'bg-ninpo-lime/10 border border-ninpo-lime/20 text-ninpo-lime' : 'bg-white/5 text-slate-300'}`}>
                      <p className="text-[11px] font-bold leading-relaxed uppercase tracking-tight">{chat.text}</p>
                   </div>
                </div>
              ))}
              {isAgentTyping && (
                <div className="flex justify-start">
                  <div className="bg-white/5 p-4 rounded-2xl animate-pulse">
                     <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                        <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                        <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                     </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-white/10 bg-ninpo-black">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={supportQuery}
                  onChange={(e) => setSupportQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendSupportMessage()}
                  placeholder="Type a message..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-[10px] font-bold uppercase tracking-widest focus:border-ninpo-lime focus:outline-none"
                />
                <button onClick={handleSendSupportMessage} className="p-3 bg-ninpo-lime text-ninpo-black rounded-xl hover:scale-105 active:scale-95 transition-all"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        )}
        <button 
          onClick={() => setIsSupportOpen(!isSupportOpen)} 
          className={`w-24 h-24 bg-ninpo-midnight border-4 border-white/10 rounded-[2rem] shadow-2xl flex items-center justify-center relative active:scale-90 transition-all hover:border-ninpo-lime/40 ${isSupportOpen ? 'border-ninpo-lime' : ''}`}
        >
          <MessageSquare className={`w-10 h-10 ${isSupportOpen ? 'text-ninpo-lime' : 'text-slate-500'}`} />
          {!isSupportOpen && <div className="absolute -top-1 -right-1 w-6 h-6 bg-ninpo-lime rounded-full animate-ping opacity-20" />}
        </button>
      </div>

      {/* Floating Cart Button */}
      <div className="fixed bottom-32 right-8 z-[60]">
        <button onClick={() => { setIsCheckoutOpen(true); setCheckoutStep('ITEMS'); }} className="w-24 h-24 bg-ninpo-lime rounded-[2rem] shadow-[0_20px_60px_rgba(0,255,65,0.4)] flex items-center justify-center relative border-[8px] border-ninpo-black active:scale-90 transition-all hover:rotate-6">
          <ShoppingBag className="w-12 h-12 text-ninpo-black" />
          {cart.length > 0 && <div className="absolute -top-3 -right-3 w-10 h-10 bg-ninpo-red text-white text-[12px] font-black rounded-full flex items-center justify-center border-4 border-ninpo-black animate-bounce">{cart.length}</div>}
        </button>
      </div>

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-xl" onClick={() => setIsCheckoutOpen(false)} />
          <div 
            className="relative bg-ninpo-midnight w-full max-w-4xl rounded-[3rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-8 border-b border-white/5 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Checkout</h3>
                <div className="flex gap-4 mt-2">
                  {['ITEMS', 'LOGISTICS', 'PAYMENT'].map((s) => (
                    <div key={s} className={`h-1.5 w-12 rounded-full ${checkoutStep === s ? 'bg-ninpo-lime shadow-[0_0_10px_#00ff41]' : 'bg-white/5'}`} />
                  ))}
                </div>
              </div>
              <button onClick={() => setIsCheckoutOpen(false)} className="p-4 bg-white/5 rounded-2xl text-slate-400 hover:text-white transition-all"><X className="w-6 h-6" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {checkoutStep === 'ITEMS' && (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Your Order</h4>
                    {cart.length === 0 ? (
                      <div className="py-12 text-center text-slate-600 font-bold uppercase tracking-widest">Your cart is empty.</div>
                    ) : cart.map((item, idx) => {
                      const p = products.find(prod => prod.id === item.productId);
                      return p && (
                        <div key={idx} className="flex items-center gap-6 bg-ninpo-black/40 p-6 rounded-[2rem] border border-white/5 group">
                          <img src={p.image} className="w-16 h-16 rounded-xl object-cover" />
                          <div className="flex-1">
                            <h4 className="text-white font-bold text-xs uppercase">{p.name}</h4>
                            <div className="flex items-center gap-4 mt-2">
                               <button onClick={() => updateCartQuantity(p.id, item.quantity - 1)} className="p-1.5 bg-white/5 rounded-lg text-slate-400 hover:text-white"><Minus className="w-3 h-3" /></button>
                               <span className="text-[11px] font-black text-white">{item.quantity}</span>
                               <button onClick={() => updateCartQuantity(p.id, item.quantity + 1)} className="p-1.5 bg-white/5 rounded-lg text-slate-400 hover:text-white"><Plus className="w-3 h-3" /></button>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end gap-2">
                            <p className="text-white font-black text-lg">${(p.price * item.quantity).toFixed(2)}</p>
                            <button onClick={() => removeFromCart(p.id)} className="text-[9px] font-black text-ninpo-red uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Remove</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-ninpo-lime/5 border border-ninpo-lime/20 rounded-[2.5rem] p-8 space-y-6 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-4">
                          <Wallet className="w-5 h-5 text-ninpo-lime" />
                          <h4 className="text-white font-black uppercase text-xs tracking-widest">My Balance</h4>
                        </div>
                        <p className="text-3xl font-black text-white">${user.credits.toFixed(2)}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-1">Available to spend</p>
                      </div>
                      <button 
                        onClick={() => setUseAccountCredits(!useAccountCredits)}
                        className={`w-full py-5 rounded-2xl flex items-center justify-center gap-4 font-black uppercase text-[10px] tracking-[0.2em] transition-all ${useAccountCredits ? 'bg-ninpo-lime text-ninpo-black shadow-[0_10px_30px_rgba(0,255,65,0.3)]' : 'bg-white/5 text-slate-400 border border-white/5'}`}
                      >
                        {useAccountCredits ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        {useAccountCredits ? 'Credit Applied' : 'Apply Balance'}
                      </button>
                    </div>

                    <div className="bg-amber-400/5 border border-amber-400/20 rounded-[2.5rem] p-8 space-y-6 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-4">
                          <Recycle className="w-5 h-5 text-amber-400" />
                          <h4 className="text-white font-black uppercase text-xs tracking-widest">Bottle Refund</h4>
                        </div>
                        <p className="text-3xl font-black text-white">${returnStats.net.toFixed(2)}</p>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-1">Estimated return value</p>
                      </div>
                      <button 
                        onClick={() => { setIsCheckoutOpen(false); setIsReturnTerminalOpen(true); startScanner(); }}
                        className="w-full py-5 bg-amber-400 text-black rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] shadow-lg hover:scale-[1.02] transition-all"
                      >
                        Scan Bottles
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {checkoutStep === 'LOGISTICS' && (
                <div className="space-y-8 p-4">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><MapPin className="w-4 h-4" /> Delivery Address</label>
                    <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address, City, State, Zip..." className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-6 text-white font-bold uppercase text-xs focus:border-ninpo-lime h-32 focus:outline-none shadow-inner" />
                  </div>
                  
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">Referral Code</label>
                    <div className="flex gap-3">
                      <input 
                        type="text" 
                        value={referralCode} 
                        onChange={(e) => setReferralCode(e.target.value)} 
                        placeholder="ENTER CODE" 
                        disabled={isReferralApplied}
                        className="flex-1 bg-ninpo-black border border-white/10 rounded-xl px-6 py-4 text-white font-bold uppercase text-xs focus:border-ninpo-lime focus:outline-none"
                      />
                      <button 
                        onClick={handleApplyReferral}
                        disabled={isReferralApplied || referralCode.length < 3}
                        className="px-6 bg-white/5 text-white rounded-xl font-black uppercase text-[10px] tracking-widest disabled:opacity-30"
                      >
                        {isReferralApplied ? 'Applied' : 'Apply'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-ninpo-lime/5 p-8 rounded-[2rem] border border-ninpo-lime/10 flex gap-6 items-center">
                    <ShieldCheck className="w-8 h-8 text-ninpo-lime" />
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                      Bottle deposits will be verified by the driver upon delivery. Estimated credits will be applied to your final total.
                    </p>
                  </div>
                </div>
              )}

              {checkoutStep === 'PAYMENT' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(['STRIPE_CARD', 'GOOGLE_PAY'] as PaymentMethod[]).map(m => (
                    <button key={m} onClick={() => setPaymentMethod(m)} className={`p-10 rounded-[2.5rem] border-2 flex flex-col items-center justify-center gap-6 transition-all ${paymentMethod === m ? 'border-ninpo-lime bg-ninpo-lime/5 shadow-[0_0_30px_rgba(0,255,65,0.1)]' : 'border-white/5 bg-ninpo-black hover:border-white/10'}`}>
                      {m === 'STRIPE_CARD' && <CreditCard className="w-10 h-10 text-blue-400" />}
                      {m === 'GOOGLE_PAY' && <Smartphone className="w-10 h-10 text-slate-300" />}
                      <span className="text-[11px] font-black text-white uppercase tracking-widest">{m.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-ninpo-card p-10 border-t border-white/10">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-8">
                <div className="text-center sm:text-left">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Amount</p>
                  <h4 className="text-5xl font-black text-white tracking-tighter">${cartStats.total.toFixed(2)}</h4>
                  {(cartStats.accountCreditOffset > 0 || cartStats.bottleCreditOffset > 0 || cartStats.referralDiscount > 0) && (
                    <div className="flex flex-wrap justify-center sm:justify-start gap-3 mt-3">
                      {cartStats.accountCreditOffset > 0 && (
                        <span className="text-[8px] font-black text-ninpo-lime uppercase tracking-widest px-2 py-0.5 bg-ninpo-lime/10 rounded-lg">
                          Credit: -${cartStats.accountCreditOffset.toFixed(2)}
                        </span>
                      )}
                      {cartStats.bottleCreditOffset > 0 && (
                        <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest px-2 py-0.5 bg-amber-400/10 rounded-lg">
                          Bottles: -${cartStats.bottleCreditOffset.toFixed(2)}
                        </span>
                      )}
                      {cartStats.referralDiscount > 0 && (
                        <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest px-2 py-0.5 bg-blue-400/10 rounded-lg">
                          Bonus: -${cartStats.referralDiscount.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-4 w-full sm:w-auto">
                  {checkoutStep !== 'ITEMS' && (
                    <button onClick={() => setCheckoutStep(checkoutStep === 'PAYMENT' ? 'LOGISTICS' : 'ITEMS')} className="flex-1 sm:flex-none p-6 bg-white/5 text-white rounded-2xl flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></button>
                  )}
                  {checkoutStep !== 'PAYMENT' ? (
                    <button 
                      onClick={() => setCheckoutStep(checkoutStep === 'ITEMS' ? 'LOGISTICS' : 'PAYMENT')} 
                      disabled={cart.length === 0}
                      className="flex-1 sm:w-auto px-12 py-6 bg-white text-ninpo-black rounded-2xl font-black uppercase text-[11px] tracking-widest hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-4 shadow-xl disabled:opacity-30"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={handlePlaceOrder} className="flex-1 sm:w-auto px-16 py-6 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-[11px] tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_20px_60px_rgba(0,255,65,0.4)]">Place Order</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottle Return Scanner Modal */}
      {isReturnTerminalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ninpo-black/98" onClick={() => { stopScanner(); setIsReturnTerminalOpen(false); }} />
          <div 
            className="relative bg-ninpo-midnight w-full max-w-6xl rounded-[3rem] border border-white/10 overflow-hidden flex flex-col lg:flex-row max-h-[90vh] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 p-8 lg:p-12 flex flex-col bg-ninpo-black/40 overflow-y-auto">
               <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 bg-ninpo-lime rounded-2xl flex items-center justify-center shadow-lg"><Recycle className="w-8 h-8 text-ninpo-black" /></div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter leading-none">Bottle Scanner</h3>
                    <p className="text-[10px] font-black text-ninpo-lime uppercase tracking-widest mt-2 opacity-60">MI Deposit Return System</p>
                  </div>
               </div>
               
               <div className="flex-1 min-h-[400px] bg-ninpo-black rounded-[2.5rem] border-2 border-dashed border-white/10 relative overflow-hidden flex flex-col items-center justify-center shadow-inner">
                  {isScanning ? (
                    <>
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted
                        className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale" 
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                        <div className="w-80 h-80 border-2 border-ninpo-lime/40 rounded-[3.5rem] relative animate-pulse">
                           <div className="absolute top-0 left-0 w-full h-1 bg-ninpo-lime shadow-[0_0_20px_#00ff41] animate-[scan_3s_linear_infinite]" />
                           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                              <ScanSearch className="w-16 h-16 text-ninpo-lime/20" />
                           </div>
                        </div>
                      </div>
                      
                      {scanResult && (
                        <div className={`absolute bottom-32 left-8 right-8 p-6 rounded-2xl z-40 border-2 backdrop-blur-md shadow-2xl animate-in slide-in-bottom ${scanResult.valid ? 'bg-ninpo-lime/95 border-ninpo-lime shadow-[0_0_40px_rgba(0,255,65,0.4)]' : 'bg-ninpo-red/95 border-ninpo-red shadow-[0_0_40px_rgba(255,0,0,0.4)]'}`}>
                           <div className="flex items-center gap-5">
                              {scanResult.valid ? (
                                <div className="p-4 bg-ninpo-black rounded-2xl animate-bounce shadow-lg">
                                  <ThumbsUp className="text-ninpo-lime w-8 h-8" />
                                </div>
                              ) : (
                                <div className="p-4 bg-ninpo-black rounded-2xl shadow-lg">
                                  <XCircle className="text-ninpo-red w-8 h-8" />
                                </div>
                              )}
                              <div className="flex-1">
                                <p className={`text-[12px] font-black uppercase tracking-[0.2em] mb-1 ${scanResult.valid ? 'text-ninpo-black' : 'text-white'}`}>
                                  {scanResult.valid ? `VERIFIED: ${scanResult.material}` : 'REJECTED: INELIGIBLE'}
                                </p>
                                <p className={`text-[11px] font-bold uppercase leading-tight ${scanResult.valid ? 'text-ninpo-black/70' : 'text-ninpo-red/20 text-white'}`}>
                                  {scanResult.message}
                                </p>
                              </div>
                              {scanResult.valid && (
                                <div className="p-2">
                                  <Sparkles className="w-6 h-6 text-ninpo-black animate-pulse" />
                                </div>
                              )}
                           </div>
                        </div>
                      )}

                      <button 
                        onClick={captureAndAnalyze} 
                        disabled={isAnalyzing}
                        className="absolute bottom-10 px-16 py-6 bg-ninpo-lime text-ninpo-black rounded-[2rem] font-black uppercase text-[12px] tracking-widest shadow-[0_20px_50px_rgba(0,255,65,0.4)] active:scale-95 transition-all z-30 flex items-center gap-4"
                      >
                        {isAnalyzing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Barcode className="w-6 h-6" />}
                        {isAnalyzing ? 'Scanning...' : 'Verify Bottle'}
                      </button>
                    </>
                  ) : (
                    <button onClick={startScanner} className="px-16 py-6 bg-ninpo-lime/10 text-ninpo-lime border border-ninpo-lime rounded-3xl font-black uppercase text-[11px] tracking-widest hover:bg-ninpo-lime hover:text-ninpo-black transition-all">Start Camera</button>
                  )}
               </div>
               
               <div className="mt-8 bg-ninpo-black/20 p-6 rounded-[2rem] border border-white/5 flex items-center gap-4">
                  <Info className="w-5 h-5 text-slate-500" />
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-relaxed">
                    Michigan Law Tip: Ninpo Vision looks for the MI 10c mark and a clear barcode. Ensure your bottle is clean and well-lit.
                  </p>
               </div>
            </div>
            
            <div className="w-full lg:w-[480px] bg-ninpo-midnight p-8 lg:p-12 border-l border-white/5 flex flex-col justify-between overflow-y-auto">
              <div className="space-y-12">
                <div>
                  <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-8">Returns Basket</h4>
                  <div className="space-y-4 max-h-72 overflow-y-auto pr-4 no-scrollbar">
                    {returnBasket.length === 0 ? (
                      <div className="py-24 text-center border-2 border-dashed border-white/5 rounded-[2.5rem] bg-ninpo-black/20">
                         <Recycle className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                         <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Empty Basket</p>
                      </div>
                    ) : returnBasket.map((b, idx) => (
                      <div key={b.id} className="flex justify-between items-center p-6 bg-ninpo-card rounded-[1.5rem] border border-white/5 group animate-in slide-in-bottom">
                        <div className="flex items-center gap-5">
                           {b.type === 'GLASS' ? <Wine className="text-amber-400 w-6 h-6" /> : b.type === 'CAN' ? <Beaker className="text-slate-300 w-6 h-6" /> : <Coffee className="text-blue-400 w-6 h-6" />}
                           <div>
                              <p className="text-[11px] font-black text-white uppercase tracking-widest">{b.type}</p>
                              <p className="text-[9px] font-bold text-ninpo-lime uppercase mt-1 tracking-widest">Verified +$0.10</p>
                           </div>
                        </div>
                        <button onClick={() => setReturnBasket(prev => prev.filter(item => item.id !== b.id))} className="p-3 text-slate-700 hover:text-ninpo-red transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-ninpo-black/40 p-10 rounded-[3rem] border border-white/5 shadow-inner">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Total Credit Earned</p>
                  <p className="text-6xl font-black text-ninpo-lime tracking-tighter">${returnStats.net.toFixed(2)}</p>
                  <div className="mt-6 pt-6 border-t border-white/5 space-y-3">
                     <div className="flex justify-between text-[9px] font-black text-slate-600 uppercase tracking-widest">
                        <span>Items Scanned</span>
                        <span>{returnBasket.length}</span>
                     </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-12">
                <button 
                  onClick={() => { stopScanner(); setIsReturnTerminalOpen(false); if(cart.length > 0) setIsCheckoutOpen(true); }} 
                  className="w-full py-7 bg-ninpo-lime text-ninpo-black rounded-3xl font-black text-[13px] uppercase tracking-widest shadow-xl hover:scale-[1.02] transition-all"
                >
                  {cart.length > 0 ? 'Back to Checkout' : 'Confirm Return'}
                </button>
                {!isCheckoutOpen && (
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => handleStandaloneReturn('CREDIT')} disabled={returnBasket.length === 0} className="py-5 bg-white/5 text-white border border-white/10 rounded-2xl font-black text-[11px] uppercase tracking-widest disabled:opacity-20 transition-all">Add to Balance</button>
                    <button onClick={() => handleStandaloneReturn('CASH')} disabled={returnBasket.length === 0} className="py-5 bg-ninpo-red/20 text-ninpo-red border border-ninpo-red/20 rounded-2xl font-black text-[11px] uppercase tracking-widest disabled:opacity-20 transition-all">Cash Out</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scan { 0% { top: 0; } 100% { top: 100%; } }
      `}</style>
    </div>
  );
};

export default CustomerView;
