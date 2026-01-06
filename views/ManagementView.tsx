
import React, { useState, useRef, useEffect } from 'react';
import { User, UserRole, Product, Order, OrderStatus, AppSettings } from '../types';
import { 
  Loader2, DollarSign, Zap, X, Cpu, Package, Settings, 
  BarChart3, TrendingUp, Plus, Truck, Recycle, ShieldCheck, 
  Camera, CheckCircle2, MapPin, Search, Bell, Barcode, ScanSearch,
  Trash2, Edit3, ShoppingBag, Layers, Wand2, RefreshCcw, Save,
  Users, Mail, UserCheck, Navigation, Crosshair, Signal, XCircle,
  Lightbulb
} from 'lucide-react';
import { analyzeBottleScan, getSmartSnackRecommendations } from '../services/geminiService';
import { GoogleGenAI } from "@google/genai";

interface ManagementViewProps {
  user: User;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  orders: Order[];
  users: User[];
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  updateOrder: (id: string, status: OrderStatus) => void;
  deleteOrder: (id: string) => void;
  adjustCredits: (userId: string, amount: number) => void;
}

const ManagementView: React.FC<ManagementViewProps> = ({ 
  user, 
  products, 
  setProducts,
  orders, 
  updateOrder,
  deleteOrder,
  settings,
  setSettings,
  adjustCredits,
  users
}) => {
  const [activeModule, setActiveModule] = useState<string>('orders');
  const [verifyingOrder, setVerifyingOrder] = useState<Order | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<{ valid: boolean; message: string; material?: string } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [verifiedCredits, setVerifiedCredits] = useState(0);
  
  // GPS Tracking State
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  // Inventory state
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    name: '', price: 0, deposit: 0, category: 'SNACKS', stock: 0, image: ''
  });
  
  // AI Insights
  const [stockInsights, setStockInsights] = useState<string>("");
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // AI Lab state
  const [labPrompt, setLabPrompt] = useState('');
  const [labResult, setLabResult] = useState('');
  const [isLabLoading, setIsLabLoading] = useState(false);

  // Settings state
  const [tempSettings, setTempSettings] = useState<AppSettings>({ ...settings });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isScanning && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
  }, [isScanning, stream]);

  // Handle GPS Tracking initialization
  useEffect(() => {
    if (activeModule === 'tracking' && "geolocation" in navigator) {
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setGpsError(null);
        },
        (error) => {
          setGpsError(error.message);
        },
        { enableHighAccuracy: true }
      );
    }

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [activeModule]);

  const handleProcessOrder = (orderId: string, status: OrderStatus) => {
    updateOrder(orderId, status);
  };

  const handleVerifyDelivery = (order: Order) => {
    setVerifyingOrder(order);
    setVerifiedCredits(0);
    setIsVerifying(true);
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
      alert("Unable to access camera.");
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
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      setScanResult({ valid: true, message: "Scanning..." }); 
      const result = await analyzeBottleScan(base64Data);
      setScanResult(result);
      setIsAnalyzing(false);
      
      if (result.valid) {
        setVerifiedCredits(prev => prev + settings.michiganDepositValue);
        setTimeout(() => setScanResult(null), 1500);
      }
    } else {
      setIsAnalyzing(false);
    }
  };

  const completeVerification = () => {
    if (verifyingOrder) {
      updateOrder(verifyingOrder.id, OrderStatus.DELIVERED);
      if (verifiedCredits > 0) {
        adjustCredits(verifyingOrder.customerId, verifiedCredits);
      }
      setIsVerifying(false);
      setVerifyingOrder(null);
      stopScanner();
      alert(`Verified! $${verifiedCredits.toFixed(2)} credited.`);
    }
  };

  const generateStockInsights = async () => {
    setIsGeneratingInsights(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Inventory Data: ${JSON.stringify(products)}. Orders Data: ${JSON.stringify(orders.slice(0, 5))}. 
        Analyze stock levels and suggest 3 urgent actions for a snack shop owner. Keep it punchy.`,
      });
      setStockInsights(response.text || "No insights found.");
    } catch (e) {
      setStockInsights("Insights engine offline.");
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  const handleSaveProduct = () => {
    if (!newProduct.name || !newProduct.price) return;
    if (editingProduct) {
      setProducts(prev => prev.map(p => p.id === editingProduct.id ? { ...p, ...newProduct } as Product : p));
    } else {
      const p: Product = { ...newProduct, id: Math.random().toString(36).substr(2, 9) } as Product;
      setProducts(prev => [...prev, p]);
    }
    setIsAddingProduct(false);
    setEditingProduct(null);
    setNewProduct({ name: '', price: 0, deposit: 0, category: 'SNACKS', stock: 0, image: '' });
  };

  const handleDeleteProduct = (id: string) => {
    if (window.confirm("Delete this product?")) {
      setProducts(prev => prev.filter(p => p.id !== id));
    }
  };

  const generateMarketingBlurb = async () => {
    setIsLabLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Marketing blurb for: ${labPrompt}. Style: Urban Detroit.`,
      });
      setLabResult(response.text || "Failed.");
    } catch (e) {
      setLabResult("Lab system busy.");
    } finally {
      setIsLabLoading(false);
    }
  };

  const saveSettings = () => {
    setSettings(tempSettings);
    alert("System config updated.");
  };

  // Stats calculation
  const totalRevenue = orders.reduce((sum, o) => sum + (o.status === OrderStatus.DELIVERED ? o.total : 0), 0);
  const activeOrderCount = orders.filter(o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.CANCELLED).length;
  const processedDeposits = orders.reduce((sum, o) => sum + (o.status === OrderStatus.DELIVERED ? (o.estimatedReturnCredit || 0) : 0), 0);

  return (
    <div className="flex flex-col xl:flex-row gap-8 lg:gap-12 animate-in fade-in min-h-[70vh]">
      <aside className="w-full xl:w-72 bg-ninpo-midnight p-6 rounded-[2rem] border border-white/5 xl:h-fit xl:sticky xl:top-8 z-20 space-y-2 shadow-2xl">
        {[
          {id: 'orders', label: 'Orders', icon: Truck},
          {id: 'tracking', label: 'Tactical Map', icon: Navigation},
          {id: 'finances', label: 'Finances', icon: BarChart3},
          {id: 'products', label: 'Inventory', icon: Package},
          {id: 'users', label: 'Users', icon: Users},
          {id: 'lab', label: 'AI Lab', icon: Cpu},
          {id: 'config', label: 'Settings', icon: Settings}
        ].map(m => (
          <button key={m.id} onClick={() => setActiveModule(m.id)} className={`w-full text-left p-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-4 ${activeModule === m.id ? 'bg-ninpo-lime text-ninpo-black shadow-xl' : 'hover:bg-white/5 text-slate-500'}`}>
            <m.icon className="w-5 h-5" /> {m.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 space-y-8">
        {activeModule === 'orders' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl">
            <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-8">
               <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Active Orders</h2>
               <div className="bg-ninpo-midnight px-6 py-3 rounded-xl border border-white/5 flex items-center gap-3">
                  <Bell className="w-4 h-4 text-ninpo-lime animate-pulse" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{activeOrderCount} Pending</span>
               </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {orders.length === 0 ? (
                <div className="py-32 text-center bg-ninpo-black/20 rounded-[2.5rem] border-2 border-dashed border-white/5">
                   <Truck className="w-16 h-16 text-slate-800 mx-auto mb-4" />
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">No order records.</p>
                </div>
              ) : orders.map(o => (
                <div key={o.id} className="bg-ninpo-midnight p-8 rounded-[2.5rem] border border-white/5 flex flex-col lg:flex-row items-center gap-8 shadow-xl group">
                  <div className="w-16 h-16 bg-ninpo-grey rounded-2xl flex items-center justify-center">
                    <Package className={`w-8 h-8 ${o.status === OrderStatus.PENDING ? 'text-amber-500' : 'text-ninpo-lime'}`} />
                  </div>
                  <div className="flex-1 space-y-2 text-center lg:text-left">
                    <div className="flex items-center justify-center lg:justify-start gap-3">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">ID: {o.id}</p>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${o.status === OrderStatus.DELIVERED ? 'bg-ninpo-lime/20 text-ninpo-lime' : 'bg-amber-400/20 text-amber-400'}`}>{o.status}</span>
                    </div>
                    <p className="text-white font-black text-sm uppercase">{o.address}</p>
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">${o.total.toFixed(2)} • Verifying: ${o.estimatedReturnCredit.toFixed(2)}</p>
                  </div>
                  <div className="flex gap-3">
                    {o.status === OrderStatus.PENDING && (
                      <button onClick={() => handleProcessOrder(o.id, OrderStatus.OUT_FOR_DELIVERY)} className="px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest">Start Delivery</button>
                    )}
                    {o.status === OrderStatus.OUT_FOR_DELIVERY && (
                      <button onClick={() => handleVerifyDelivery(o)} className="px-6 py-4 bg-white text-ninpo-black rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                        <Recycle className="w-4 h-4" /> Verify
                      </button>
                    )}
                    <button onClick={() => deleteOrder(o.id)} className="p-4 bg-white/5 rounded-xl text-slate-600 hover:text-ninpo-red transition-all group-hover:opacity-100 opacity-0"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeModule === 'products' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Inventory Control</h2>
              <div className="flex gap-4 w-full md:w-auto">
                <button onClick={generateStockInsights} disabled={isGeneratingInsights} className="flex-1 md:flex-none bg-ninpo-black text-ninpo-lime border border-ninpo-lime/30 px-6 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                  {isGeneratingInsights ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
                  AI Insights
                </button>
                <button onClick={() => { setIsAddingProduct(true); setEditingProduct(null); }} className="flex-1 md:flex-none bg-ninpo-lime text-ninpo-black px-8 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-3">
                  <Plus className="w-4 h-4" /> New Item
                </button>
              </div>
            </div>
            
            {stockInsights && (
               <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 animate-in fade-in flex items-start gap-6">
                  <div className="w-12 h-12 bg-ninpo-lime/10 rounded-xl flex items-center justify-center flex-shrink-0"><Cpu className="w-6 h-6 text-ninpo-lime" /></div>
                  <div>
                    <h4 className="text-[10px] font-black text-ninpo-lime uppercase tracking-widest mb-2">Smart Stock Analysis</h4>
                    <p className="text-slate-300 font-bold text-xs leading-relaxed uppercase">{stockInsights}</p>
                  </div>
               </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map(p => (
                <div key={p.id} className="bg-ninpo-midnight p-6 rounded-[2rem] border border-white/5 flex flex-col group hover:border-ninpo-lime/20 transition-all">
                  <div className="aspect-square rounded-2xl overflow-hidden mb-6 relative">
                    <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    {p.stock < 10 && <div className="absolute top-4 left-4 bg-ninpo-red text-white px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest animate-pulse">Low Stock</div>}
                  </div>
                  <div className="flex-1 space-y-2">
                    <h4 className="text-white font-bold uppercase text-xs">{p.name}</h4>
                    <div className="flex justify-between items-center">
                       <p className="text-ninpo-lime font-black text-lg">${p.price.toFixed(2)}</p>
                       <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Stock: {p.stock}</span>
                    </div>
                  </div>
                  <div className="mt-6 flex gap-2">
                    <button onClick={() => { setEditingProduct(p); setNewProduct(p); setIsAddingProduct(true); }} className="flex-1 py-3 bg-white/5 text-white rounded-xl text-[9px] font-black uppercase tracking-widest">Edit</button>
                    <button onClick={() => handleDeleteProduct(p.id)} className="p-3 bg-ninpo-red/10 text-ninpo-red rounded-xl"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeModule === 'users' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-10">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Registered Users</h2>
            <div className="grid gap-4">
               {users.map(u => (
                 <div key={u.id} className="bg-ninpo-midnight p-6 rounded-[2rem] border border-white/5 flex items-center justify-between group hover:border-ninpo-lime/20 transition-all">
                    <div className="flex items-center gap-5">
                       <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-ninpo-lime transition-colors">
                          {u.role === UserRole.OWNER ? <ShieldCheck className="w-6 h-6" /> : <Users className="w-6 h-6" />}
                       </div>
                       <div>
                          <h4 className="text-white font-bold uppercase text-sm">{u.name}</h4>
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{u.email} • {u.role}</p>
                       </div>
                    </div>
                    <div className="flex gap-8 items-center">
                       <div className="text-right">
                          <p className="text-white font-black text-sm">${u.credits.toFixed(2)}</p>
                          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Credit</p>
                       </div>
                       <div className="text-right hidden sm:block">
                          <p className="text-white font-black text-sm">{u.loyaltyPoints}</p>
                          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Points</p>
                       </div>
                       <div className="flex gap-2">
                          <button onClick={() => adjustCredits(u.id, 5)} className="p-2 bg-ninpo-lime/10 text-ninpo-lime rounded-lg text-[9px] font-black">+$5</button>
                          <button onClick={() => adjustCredits(u.id, -5)} className="p-2 bg-ninpo-red/10 text-ninpo-red rounded-lg text-[9px] font-black">-$5</button>
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* Tactical Map Module */}
        {activeModule === 'tracking' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-8 animate-in fade-in">
             <div className="flex justify-between items-center">
               <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Tactical Map</h2>
               <div className="flex gap-4">
                <div className="bg-ninpo-midnight px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3">
                   <Signal className={`w-4 h-4 ${gpsError ? 'text-ninpo-red' : 'text-ninpo-lime'}`} />
                   <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{gpsError ? 'OFFLINE' : 'STABLE'}</span>
                </div>
               </div>
             </div>
             <div className="relative aspect-video lg:aspect-[21/9] bg-[#05080c] rounded-[3rem] border-4 border-ninpo-midnight overflow-hidden shadow-inner">
               <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(to right, #00ff41 1px, transparent 1px), linear-gradient(to bottom, #00ff41 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />
               <div className="absolute inset-0 flex items-center justify-center">
                  {currentLocation ? (
                    <div className="relative w-full h-full">
                       <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                          <div className="w-12 h-12 bg-ninpo-lime rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(0,255,65,0.6)] relative z-10 border-4 border-ninpo-black">
                            <Crosshair className="w-6 h-6 text-ninpo-black" />
                          </div>
                          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-ninpo-black/80 px-2 py-1 rounded-lg border border-ninpo-lime/20 whitespace-nowrap">
                            <p className="text-[7px] font-black text-ninpo-lime uppercase">YOU</p>
                          </div>
                       </div>
                       {orders.filter(o => o.status === OrderStatus.OUT_FOR_DELIVERY).map((o, idx) => (
                         <div key={o.id} className="absolute" style={{ left: `${20 + idx * 30}%`, top: `${30 + idx * 20}%` }}>
                            <MapPin className="w-8 h-8 text-amber-500 animate-bounce" />
                         </div>
                       ))}
                    </div>
                  ) : (
                    <div className="text-center space-y-4">
                       <Loader2 className="w-10 h-10 text-ninpo-lime animate-spin mx-auto" />
                       <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Locking Satellite Coordinates...</p>
                    </div>
                  )}
               </div>
             </div>
          </div>
        )}

        {/* Other modules (finances, lab, config) remain implemented as per previous version */}
        {activeModule === 'finances' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-12">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Finance Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-ninpo-midnight p-10 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Gross Revenue</p>
                <p className="text-5xl font-black text-ninpo-lime tracking-tighter">${totalRevenue.toFixed(2)}</p>
              </div>
              <div className="bg-ninpo-midnight p-10 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Bottle Credits</p>
                <p className="text-5xl font-black text-white tracking-tighter">${processedDeposits.toFixed(2)}</p>
              </div>
              <div className="bg-ninpo-midnight p-10 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Mission Vol</p>
                <p className="text-5xl font-black text-white tracking-tighter">{orders.length}</p>
              </div>
            </div>
          </div>
        )}

        {activeModule === 'lab' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-10">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">AI Creative Lab</h2>
            <div className="bg-ninpo-midnight p-10 rounded-[2.5rem] border border-white/5 space-y-8">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Snack Concept</label>
                <div className="flex gap-4">
                  <input type="text" value={labPrompt} onChange={e => setLabPrompt(e.target.value)} placeholder="Detroit Spicy Mochi..." className="flex-1 bg-ninpo-black border border-white/5 rounded-2xl p-6 text-white font-bold text-xs" />
                  <button onClick={generateMarketingBlurb} disabled={isLabLoading || !labPrompt} className="px-10 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center gap-2">
                    {isLabLoading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Gen
                  </button>
                </div>
              </div>
              {labResult && (
                <div className="p-8 bg-white/5 rounded-[2rem] border border-ninpo-lime/20 animate-in fade-in">
                  <p className="text-white font-bold text-sm leading-relaxed">{labResult}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeModule === 'config' && (
          <div className="bg-ninpo-card p-8 lg:p-12 rounded-[3rem] border border-white/5 shadow-2xl space-y-10">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter">System Config</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-ninpo-midnight p-10 rounded-[2.5rem] border border-white/5">
               <div className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Delivery Fee ($)</label>
                   <input type="number" step="0.01" value={tempSettings.deliveryFee} onChange={e => setTempSettings({...tempSettings, deliveryFee: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/10 rounded-xl p-4 text-white font-bold" />
                 </div>
                 <div>
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">MI Deposit ($)</label>
                   <input type="number" step="0.01" value={tempSettings.michiganDepositValue} onChange={e => setTempSettings({...tempSettings, michiganDepositValue: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/10 rounded-xl p-4 text-white font-bold" />
                 </div>
               </div>
               <div className="space-y-6">
                 <div>
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Processing Fee (%)</label>
                   <input type="number" step="0.01" value={tempSettings.processingFeePercent} onChange={e => setTempSettings({...tempSettings, processingFeePercent: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/10 rounded-xl p-4 text-white font-bold" />
                 </div>
                 <div className="flex items-center gap-4 h-full pt-6">
                    <button onClick={saveSettings} className="w-full h-full bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[11px] flex items-center justify-center gap-3">
                      <Save className="w-5 h-5" /> Commit
                    </button>
                 </div>
               </div>
            </div>
          </div>
        )}

        {/* Modal for adding/editing products */}
        {isAddingProduct && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-md" onClick={() => setIsAddingProduct(false)} />
            <div className="relative bg-ninpo-midnight w-full max-w-lg rounded-[3rem] border border-white/10 p-10 shadow-2xl space-y-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-2xl font-black text-white uppercase tracking-tighter">{editingProduct ? 'Update Product' : 'Add Product'}</h3>
              <input type="text" placeholder="Name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full bg-ninpo-black border border-white/5 rounded-2xl p-5 text-white font-bold uppercase text-xs" />
              <div className="grid grid-cols-2 gap-4">
                <input type="number" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/5 rounded-2xl p-5 text-white font-bold uppercase text-xs" />
                <input type="number" placeholder="Stock" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: parseInt(e.target.value)})} className="w-full bg-ninpo-black border border-white/5 rounded-2xl p-5 text-white font-bold uppercase text-xs" />
              </div>
              <input type="text" placeholder="Image URL" value={newProduct.image} onChange={e => setNewProduct({...newProduct, image: e.target.value})} className="w-full bg-ninpo-black border border-white/5 rounded-2xl p-5 text-white font-bold uppercase text-xs" />
              <div className="flex gap-4 pt-4">
                <button onClick={() => setIsAddingProduct(false)} className="flex-1 py-5 text-slate-500 font-black uppercase text-[10px] tracking-widest">Cancel</button>
                <button onClick={handleSaveProduct} className="flex-1 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-[10px] tracking-widest">Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Verification Modal */}
        {isVerifying && verifyingOrder && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-ninpo-black/98" onClick={() => { stopScanner(); setIsVerifying(false); }} />
            <div className="relative bg-ninpo-midnight w-full max-w-4xl rounded-[3rem] border border-white/10 p-12 overflow-hidden flex flex-col shadow-2xl animate-in zoom-in" onClick={e => e.stopPropagation()}>
               <div className="flex flex-col items-center mb-8">
                  <div className="w-16 h-16 bg-ninpo-lime rounded-2xl flex items-center justify-center mb-4 shadow-2xl"><ShieldCheck className="w-10 h-10 text-ninpo-black" /></div>
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Verification Protocol</h3>
               </div>
               <div className="flex-1 min-h-[400px] bg-ninpo-black rounded-[2rem] border-2 border-dashed border-white/10 relative overflow-hidden flex flex-col items-center justify-center">
                  {isScanning ? (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"><ScanSearch className="w-16 h-16 text-ninpo-lime/20" /></div>
                      <button onClick={captureAndAnalyze} disabled={isAnalyzing} className="absolute bottom-6 px-10 py-4 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[10px] tracking-widest shadow-2xl">
                        {isAnalyzing ? 'Processing...' : 'Verify Bottle'}
                      </button>
                    </>
                  ) : (
                    <button onClick={startScanner} className="flex flex-col items-center gap-4 group">
                      <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-ninpo-lime group-hover:text-ninpo-black transition-all"><Barcode className="w-8 h-8" /></div>
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Engage Optical Sensor</span>
                    </button>
                  )}
               </div>
               <div className="grid grid-cols-2 gap-4 mt-8">
                  <div className="bg-ninpo-black p-4 rounded-xl border border-white/5">
                    <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-1">Session Verified</p>
                    <p className="text-ninpo-lime font-black text-xl">${verifiedCredits.toFixed(2)}</p>
                  </div>
                  <button onClick={completeVerification} className="bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[11px] tracking-widest hover:scale-[1.02] transition-all">Submit Verification</button>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManagementView;
