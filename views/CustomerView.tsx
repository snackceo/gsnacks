
import React, { useState, useRef, useEffect } from 'react';
import { Product, Order, User, AppSettings } from '../types';
import { Package, Recycle, History, Star, ShoppingBag, CreditCard, MessageCircle, X, Send, Zap, Clock, ChevronRight, Gift, Trophy, ArrowUpRight, Crown, Camera, Loader2, Target, ShieldAlert, CheckCircle, Tag, Scale } from 'lucide-react';
import { getAgentSupportResponse, analyzeBottleScan } from '../services/geminiService';
import { MOCK_REWARDS, LOYALTY_TIERS } from '../constants';

interface CustomerViewProps {
  products: Product[];
  cart: { productId: string; quantity: number }[];
  addToCart: (id: string) => void;
  createOrder: () => void;
  orders: Order[];
  user: User;
  settings: AppSettings;
  onCreditUpdate: (amount: number) => void;
  onRedeemReward: (id: string) => void;
}

const CustomerView: React.FC<CustomerViewProps> = ({ products, cart, addToCart, createOrder, orders, user, settings, onCreditUpdate, onRedeemReward }) => {
  const [activeTab, setActiveTab] = useState<'shop' | 'outlet' | 'orders' | 'loyalty'>('shop');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    {role: 'bot', text: 'Welcome to Ninpo Snacks! How can I help you with your snacks or bottle returns today?'}
  ]);

  // Scanner State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [showLegalPrompt, setShowLegalPrompt] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scannerStatus, setScannerStatus] = useState<string>("Center the container in the frame...");

  const cartItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  
  const subtotal = cart.reduce((acc, item) => {
    const p = products.find(prod => prod.id === item.productId);
    return acc + (p ? (p.price + p.deposit) * item.quantity : 0);
  }, 0);

  const glassFeeTotal = cart.reduce((acc, item) => {
    const p = products.find(prod => prod.id === item.productId);
    if (p?.isGlass) {
      return acc + (p.price * settings.glassHandlingFeePercent * item.quantity);
    }
    return acc;
  }, 0);

  const cartTotal = subtotal + glassFeeTotal + settings.deliveryFee;

  const currentTier = [...LOYALTY_TIERS].reverse().find(t => user.loyaltyPoints >= t.minXP) || LOYALTY_TIERS[0];
  const nextTier = LOYALTY_TIERS[LOYALTY_TIERS.indexOf(currentTier) + 1] || null;
  const progressPercent = nextTier 
    ? ((user.loyaltyPoints - currentTier.minXP) / (nextTier.minXP - currentTier.minXP)) * 100 
    : 100;

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isBotThinking) return;
    const userMsg = chatInput;
    setChatMessages(prev => [...prev, {role: 'user', text: userMsg}]);
    setChatInput("");
    setIsBotThinking(true);
    try {
      const response = await getAgentSupportResponse(userMsg, user);
      setChatMessages(prev => [...prev, {role: 'bot', text: response || 'Sorry, I encountered an issue. Please try again.'}]);
    } finally {
      setIsBotThinking(false);
    }
  };

  const handleScannerClick = () => {
    // Show legal disclosure before activating camera
    setShowLegalPrompt(true);
  };

  const startScanner = async () => {
    setShowLegalPrompt(false);
    setIsScannerOpen(true);
    setPermissionError(false);
    setScannerStatus("Activating camera...");
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScannerStatus("Error: Browser camera support missing.");
      setPermissionError(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setScannerStatus("Camera active. Ready to scan.");
      }
    } catch (err: any) {
      setPermissionError(true);
      setScannerStatus("Error: Camera access required for returns.");
    }
  };

  const stopScanner = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsScannerOpen(false);
    setIsAnalyzing(false);
    setPermissionError(false);
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) return;

    setIsAnalyzing(true);
    setScannerStatus("Analyzing container...");

    const context = canvasRef.current.getContext('2d');
    if (context) {
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context.drawImage(videoRef.current, 0, 0);
      
      const base64 = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
      const result = await analyzeBottleScan(base64);

      if (result.valid) {
        setScannerStatus(`Success: ${result.message}`);
        onCreditUpdate(settings.michiganDepositValue);
        setTimeout(() => stopScanner(), 2000);
      } else {
        setScannerStatus(`Identification Failed: ${result.message}`);
        setIsAnalyzing(false);
      }
    }
  };

  const renderProductGrid = (items: Product[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {items.map(product => (
        <div key={product.id} className="bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col hover:shadow-xl transition-all group hover:-translate-y-1">
          <div className="aspect-square w-full mb-5 overflow-hidden rounded-[2rem] shadow-md relative">
            <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
            <div className="absolute top-4 right-4 flex flex-col gap-1">
              {product.isUsed && (
                <div className="bg-slate-900 text-white text-[8px] font-black px-3 py-1.5 rounded-full border border-white/10 uppercase tracking-widest text-center">
                  PRE-OWNED
                </div>
              )}
              {product.deposit > 0 && (
                <div className="bg-slate-900/80 backdrop-blur-md text-lime-500 text-[8px] font-black px-3 py-1.5 rounded-full border border-white/10 uppercase tracking-widest text-center">
                  MI DEP
                </div>
              )}
              {product.isGlass && (
                <div className="bg-lime-500 text-slate-900 text-[8px] font-black px-3 py-1.5 rounded-full border border-white/10 uppercase tracking-widest text-center">
                  GLASS
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h4 className="font-black text-slate-900 leading-tight uppercase text-sm tracking-tight">{product.name}</h4>
              {product.isUsed && (
                <p className="text-[10px] font-black text-slate-400 uppercase mt-1">Condition: {product.condition}</p>
              )}
              <p className="text-lg font-black text-lime-600 mt-1">${product.price.toFixed(2)}</p>
            </div>
            <button 
              onClick={() => addToCart(product.id)}
              className="mt-4 w-full py-3.5 bg-slate-900 text-white rounded-2xl text-[10px] font-black hover:bg-lime-500 hover:text-slate-900 transition-all uppercase tracking-widest shadow-lg shadow-slate-100 active:scale-95"
            >
              ADD TO BAG
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-8 relative animate-in fade-in duration-500">
      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-3xl border shadow-sm flex items-center justify-between group hover:border-lime-500/50 transition-all">
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">CURRENT BALANCE</p>
            <h3 className="text-3xl font-black text-lime-600">${user.credits.toFixed(2)}</h3>
          </div>
          <div className="bg-lime-50 p-3 rounded-2xl group-hover:scale-110 transition-transform"><CreditCard className="text-lime-600 w-6 h-6" /></div>
        </div>
        <div 
          className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl flex items-center justify-between cursor-pointer group hover:bg-slate-800 transition-all" 
          onClick={handleScannerClick}
        >
          <div>
            <p className="text-lime-500 text-[10px] font-black uppercase tracking-widest">BOTTLE RETURNS</p>
            <h3 className="text-3xl font-black text-white flex items-center gap-2">
              SCAN NOW <Zap className="w-5 h-5 text-lime-500 fill-lime-500 animate-pulse" />
            </h3>
          </div>
          <div className="bg-lime-500 p-3 rounded-2xl shadow-lg shadow-lime-500/20"><Recycle className="text-slate-900 w-6 h-6" /></div>
        </div>
        <div 
          onClick={() => setActiveTab('loyalty')}
          className="bg-white p-6 rounded-3xl border shadow-sm flex items-center justify-between group hover:border-amber-500/50 transition-all cursor-pointer"
        >
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">LOYALTY POINTS</p>
            <h3 className="text-3xl font-black text-slate-800">{user.loyaltyPoints}</h3>
          </div>
          <div className="bg-amber-50 p-3 rounded-2xl group-hover:scale-110 transition-transform text-amber-500">
             {currentTier.icon}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex space-x-2 bg-slate-100 p-1.5 rounded-2xl w-full max-w-lg border border-slate-200">
        {(['shop', 'outlet', 'orders', 'loyalty'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab ? 'bg-white text-lime-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'shop' ? 'Market' : tab === 'outlet' ? 'Outlet' : tab === 'orders' ? 'Deliveries' : 'Rewards'}
          </button>
        ))}
      </div>

      {activeTab === 'shop' && (
        <div className="space-y-6">
          <div className="flex justify-between items-end px-4">
            <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
              <Package className="text-lime-500" />
              AVAILABLE SNACKS
            </h2>
          </div>
          {renderProductGrid(products.filter(p => !p.isUsed))}
        </div>
      )}

      {activeTab === 'outlet' && (
        <div className="space-y-6">
          <div className="flex justify-between items-end px-4">
            <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
              <Tag className="text-lime-500" />
              PRE-OWNED GEAR
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Eco-Certified Marketplace</p>
          </div>
          <div className="bg-slate-50 p-8 rounded-[3rem] border border-slate-200 border-dashed mb-8">
            <p className="text-sm font-bold text-slate-500 text-center">Items in the outlet are inspected for quality and performance. Support sustainable logistics by purchasing pre-owned gear.</p>
          </div>
          {renderProductGrid(products.filter(p => p.isUsed))}
        </div>
      )}

      {/* Legal Disclosure Prompt for Scanner */}
      {showLegalPrompt && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowLegalPrompt(false)} />
          <div className="relative bg-white w-full max-w-md rounded-[3rem] p-12 shadow-2xl animate-in zoom-in">
             <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-20 h-20 bg-lime-50 rounded-full flex items-center justify-center">
                   <Scale className="w-10 h-10 text-lime-600" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tighter">MI Deposit Disclosure</h3>
                <p className="text-sm font-bold text-slate-500 leading-relaxed uppercase">
                   By activating the scanner, you agree to comply with the Michigan Beverage Container Law. 
                   <br/><br/>
                   <span className="text-red-500">MAXIMUM RETURN LIMIT: $25.00 PER DAY.</span>
                </p>
                <button 
                  onClick={startScanner}
                  className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-lime-500 hover:text-slate-900 transition-all"
                >
                   AGREE & ACTIVATE CAMERA
                </button>
                <button onClick={() => setShowLegalPrompt(false)} className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cancel</button>
             </div>
          </div>
        </div>
      )}

      {/* Scanner Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col animate-in fade-in">
          <div className="p-6 flex justify-between items-center bg-slate-900/50 backdrop-blur-md">
            <div>
              <h2 className="text-white font-black uppercase tracking-tighter flex items-center gap-2">
                <Target className="text-lime-500 w-5 h-5" /> BOTTLE RETURN
              </h2>
              <p className="text-[10px] font-black text-lime-400 uppercase tracking-widest">{scannerStatus}</p>
            </div>
            <button onClick={stopScanner} className="p-3 bg-white/10 rounded-2xl text-white hover:bg-white/20 transition-all">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
            {permissionError ? (
              <div className="flex flex-col items-center justify-center p-12 text-center space-y-6">
                <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center border-2 border-red-500/50">
                  <ShieldAlert className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Camera Access Required</h3>
                <p className="text-slate-400 text-sm max-w-xs font-bold leading-relaxed">Please enable camera access in your settings to verify your bottle returns.</p>
                <button 
                  onClick={startScanner}
                  className="px-8 py-4 bg-lime-500 text-slate-900 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-lime-500/20 hover:bg-lime-400 transition-all"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <>
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover opacity-80" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 h-72 border-2 border-white/20 rounded-3xl relative">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-lime-500 -translate-x-1 -translate-y-1 rounded-tl-lg"></div>
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-lime-500 translate-x-1 -translate-y-1 rounded-tr-lg"></div>
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-lime-500 -translate-x-1 translate-y-1 rounded-bl-lg"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-lime-500 translate-x-1 translate-y-1 rounded-br-lg"></div>
                    <div className="absolute left-0 right-0 h-1 bg-lime-500/50 shadow-[0_0_15px_rgba(163,230,53,1)] animate-[scan_2s_infinite]"></div>
                  </div>
                </div>

                {isAnalyzing && (
                  <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-12 h-12 text-lime-500 animate-spin" />
                    <p className="text-white font-black uppercase text-xs tracking-[0.2em]">Verifying Container...</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="p-10 bg-slate-900 flex justify-center items-center">
            {!permissionError && (
              <button 
                onClick={handleCapture}
                disabled={isAnalyzing}
                className={`w-24 h-24 rounded-full border-8 border-white/10 flex items-center justify-center transition-all ${
                  isAnalyzing ? 'scale-90 opacity-50' : 'hover:scale-105 active:scale-90'
                }`}
              >
                <div className="w-16 h-16 bg-lime-500 rounded-full flex items-center justify-center">
                  <Camera className="w-8 h-8 text-slate-900" />
                </div>
              </button>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="max-w-3xl space-y-5 animate-in slide-in-from-left-2">
          <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
            <History className="text-lime-500" /> RECENT DELIVERIES
          </h2>
          {orders.length === 0 ? (
             <div className="p-16 text-center bg-white rounded-[2.5rem] border border-dashed border-slate-200">
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest italic">No orders found.</p>
             </div>
          ) : orders.map(order => (
            <div key={order.id} className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-lime-500/30 transition-all">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">{order.id}</span>
                  <h4 className="font-black text-slate-900 text-lg mt-1 uppercase tracking-tight">{new Date(order.createdAt).toLocaleDateString()}</h4>
                </div>
                <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm ${
                  order.status === 'DELIVERED' ? 'bg-lime-500 text-white' : 'bg-slate-900 text-white'
                }`}>
                  {order.status}
                </span>
              </div>
              <div className="flex justify-between items-center pt-5 border-t border-slate-50">
                <div className="flex flex-col">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{order.items.length} ITEMS</p>
                   {order.status === 'DELIVERED' && (
                     <p className="text-[8px] font-black text-lime-600 uppercase mt-1">+{Math.floor(order.total * 100)} Points Earned</p>
                   )}
                </div>
                <p className="text-xl font-black text-lime-600">${order.total.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'loyalty' && (
        <div className="space-y-10 animate-in slide-in-from-bottom-4">
           {/* Tier Progress */}
           <div className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-lime-500/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="relative z-10">
                 <div className="flex justify-between items-end mb-8">
                    <div>
                       <p className="text-lime-400 text-[10px] font-black uppercase tracking-[0.3em] mb-2">MEMBERSHIP RANK</p>
                       <h3 className="text-5xl font-black tracking-tighter uppercase flex items-center gap-4">
                          {currentTier.name} 
                          <span className="text-2xl bg-white/10 p-3 rounded-2xl">{currentTier.icon}</span>
                       </h3>
                    </div>
                    <div className="text-right">
                       <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">TOTAL POINTS</p>
                       <p className="text-3xl font-black text-white">{user.loyaltyPoints.toLocaleString()}</p>
                    </div>
                 </div>

                 {nextTier && (
                    <div className="space-y-4">
                       <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span>Next Rank: {nextTier.name}</span>
                          <span className="text-lime-400">{nextTier.minXP - user.loyaltyPoints} POINTS NEEDED</span>
                       </div>
                       <div className="h-4 bg-white/5 rounded-full overflow-hidden p-1 border border-white/5">
                          <div 
                            className="h-full bg-lime-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(163,230,53,0.5)]" 
                            style={{ width: `${progressPercent}%` }}
                          />
                       </div>
                    </div>
                 )}
              </div>
           </div>

           {/* Rewards Marketplace */}
           <div className="space-y-6">
              <div className="flex justify-between items-center px-4">
                 <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
                    <Gift className="text-lime-500" /> MEMBER PERKS
                 </h2>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Redeem Points</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {MOCK_REWARDS.map(reward => {
                    const isRedeemable = user.loyaltyPoints >= reward.cost;
                    return (
                      <div key={reward.id} className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-lime-500/50 transition-all flex flex-col justify-between">
                         <div className="flex justify-between items-start mb-6">
                            <div className="bg-slate-50 p-4 rounded-2xl group-hover:scale-110 transition-transform text-slate-900">
                               {reward.type === 'CREDIT' ? <CreditCard className="w-6 h-6" /> : <Zap className="w-6 h-6" />}
                            </div>
                            <span className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">
                               {reward.cost} PTS
                            </span>
                         </div>
                         <div>
                            <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{reward.title}</h4>
                            <p className="text-xs font-bold text-slate-500 leading-relaxed mb-6">{reward.description}</p>
                         </div>
                         <button 
                           onClick={() => onRedeemReward(reward.id)}
                           disabled={!isRedeemable}
                           className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                             isRedeemable 
                             ? 'bg-lime-500 text-slate-900 hover:bg-slate-900 hover:text-white shadow-lg shadow-lime-500/20' 
                             : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                           }`}
                         >
                           {isRedeemable ? 'REDEEM PERK' : 'LOCKED'}
                         </button>
                      </div>
                    );
                 })}
              </div>
           </div>
        </div>
      )}

      {/* Floating UI */}
      <button 
        onClick={() => setIsCartOpen(true)}
        className="fixed bottom-24 right-6 md:bottom-8 md:right-32 z-50 w-16 h-16 bg-lime-500 text-slate-900 rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all border-4 border-white"
      >
        <ShoppingBag className="w-7 h-7" />
        {cartItemCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-slate-900 text-white text-[10px] font-black w-7 h-7 rounded-full flex items-center justify-center border-2 border-white">
            {cartItemCount}
          </span>
        )}
      </button>

      {isCartOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsCartOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter">YOUR BAG</h3>
                <p className="text-[10px] font-black text-lime-400 uppercase mt-1">Summary of items</p>
              </div>
              <button onClick={() => setIsCartOpen(false)} className="p-3 bg-white/10 rounded-2xl"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <ShoppingBag className="text-slate-200 w-16 h-16 mb-4" />
                  <p className="text-slate-400 font-black uppercase text-[10px]">Your bag is empty.</p>
                </div>
              ) : (
                cart.map(item => {
                  const p = products.find(prod => prod.id === item.productId);
                  return (
                    <div key={item.productId} className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                         <img src={p?.image} className="w-16 h-16 rounded-2xl object-cover border" />
                         <div>
                           <h4 className="text-sm font-black text-slate-900 uppercase">{p?.name}</h4>
                           <p className="text-[10px] font-bold text-slate-400">Qty: {item.quantity}</p>
                         </div>
                      </div>
                      <p className="text-sm font-black text-slate-900">${((p?.price || 0) + (p?.deposit || 0)).toFixed(2)}</p>
                    </div>
                  );
                })
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-8 bg-slate-50 border-t space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-black uppercase text-slate-400">
                    <span>Subtotal</span>
                    <span className="text-slate-900">${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-end pt-4 border-t">
                    <span className="text-xl font-black text-slate-900 uppercase">TOTAL</span>
                    <span className="text-3xl font-black text-lime-600">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>
                <button 
                  onClick={() => { createOrder(); setIsCartOpen(false); }}
                  className="w-full bg-slate-900 text-white py-6 rounded-3xl font-black uppercase text-xs hover:bg-lime-500 hover:text-slate-900 transition-all"
                >
                  Confirm Order
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Support Chat */}
      <div className="fixed bottom-24 right-6 md:bottom-8 md:right-8 z-50">
        {!isChatOpen ? (
          <button 
            onClick={() => setIsChatOpen(true)}
            className="w-16 h-16 bg-slate-900 text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all border-4 border-white"
          >
            <MessageCircle className="w-7 h-7 text-lime-500" />
          </button>
        ) : (
          <div className="bg-white w-96 rounded-[2.5rem] shadow-2xl border flex flex-col animate-in slide-in-from-bottom-6">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-lime-500 flex items-center justify-center font-black text-slate-900">NS</div>
                <div>
                  <span className="font-black text-sm uppercase">Support Agent</span>
                  <span className="text-[9px] text-lime-400 block uppercase">Online</span>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="p-2"><X className="w-5 h-5" /></button>
            </div>
            <div className="h-80 p-6 overflow-y-auto space-y-5 bg-slate-50">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-5 py-3 rounded-2xl text-[11px] font-bold ${
                    msg.role === 'user' ? 'bg-lime-500 text-white' : 'bg-white text-slate-700 border'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isBotThinking && <Loader2 className="w-4 h-4 animate-spin text-lime-500" />}
            </div>
            <div className="p-5 bg-white border-t flex gap-3">
              <input 
                type="text" 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type your message..." 
                className="flex-1 text-xs font-bold border rounded-2xl px-5 py-4 outline-none focus:border-lime-500"
              />
              <button onClick={handleSendMessage} className="bg-slate-900 text-white p-4 rounded-2xl"><Send className="w-5 h-5" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerView;
