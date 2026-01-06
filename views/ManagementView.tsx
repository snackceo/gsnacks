
import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole, Product, Order, OrderStatus, AppSettings } from '../types';
import { 
  LayoutGrid, 
  Truck, 
  Package, 
  Settings, 
  Users, 
  ChefHat, 
  TrendingUp, 
  Clock, 
  Terminal, 
  Database, 
  ShieldAlert, 
  Trash2, 
  CheckCircle, 
  Navigation, 
  Compass, 
  ArrowUp, 
  MoveRight, 
  MoveLeft, 
  List, 
  Loader2, 
  Sparkles,
  DollarSign,
  Plus,
  Edit2,
  RefreshCw,
  Zap,
  Globe,
  Cpu
} from 'lucide-react';
import { 
  analyzeSalesTrends, 
  getSmartSnackRecommendations, 
  generateSnackImage, 
  getNavigationDirections 
} from '../services/geminiService';

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
  user, products, setProducts, orders, users, settings, setSettings, updateOrder, deleteOrder, adjustCredits
}) => {
  // --- Navigation & State ---
  const [activeModule, setActiveModule] = useState<string>('dashboard');
  
  // Driver logic
  const [activeDelivery, setActiveDelivery] = useState<Order | null>(null);
  const [navSteps, setNavSteps] = useState<{ instruction: string, distance: string }[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [isLoadingNav, setIsLoadingNav] = useState(false);

  // Owner/Admin logic
  const [aiInsight, setAiInsight] = useState<string>("System Readiness: 100%. Awaiting market synchronization.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isGeneratingLab, setIsGeneratingLab] = useState(false);

  // --- Permission Helpers ---
  const isDriver = user.role === UserRole.DRIVER;
  const isAdmin = user.role === UserRole.ADMIN;
  const isOwner = user.role === UserRole.OWNER;
  const isManagement = isAdmin || isOwner;

  // --- Filtered Modules ---
  const modules = [
    { id: 'dashboard', label: 'Overview', icon: LayoutGrid, visible: isManagement },
    { id: 'dispatch', label: 'Fleet Ops', icon: Truck, visible: true }, 
    { id: 'inventory', label: 'Stock', icon: Package, visible: isManagement },
    { id: 'users', label: 'Personnel', icon: Users, visible: isOwner },
    { id: 'lab', label: 'R&D Lab', icon: ChefHat, visible: isOwner },
    { id: 'config', label: 'Terminal', icon: Settings, visible: isManagement },
  ].filter(m => m.visible);

  useEffect(() => {
    if (isDriver && activeModule === 'dashboard') setActiveModule('dispatch');
  }, [isDriver]);

  const handleStartDelivery = async (order: Order) => {
    setActiveDelivery(order);
    setIsLoadingNav(true);
    setCurrentStepIdx(0);
    updateOrder(order.id, OrderStatus.OUT_FOR_DELIVERY);
    
    try {
      const directions = await getNavigationDirections("Customer Sector 7");
      setNavSteps(directions || []);
    } catch (error) {
      setNavSteps([{ instruction: "Proceed to delivery coordinates manually.", distance: "0.5 mi" }]);
    } finally {
      setIsLoadingNav(false);
    }
  };

  const handleCompleteDelivery = (order: Order) => {
    updateOrder(order.id, OrderStatus.DELIVERED);
    setActiveDelivery(null);
    setNavSteps([]);
    setCurrentStepIdx(0);
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAiInsight("Polling node consensus and synthesizing patterns...");
    try {
      const insight = await analyzeSalesTrends(orders);
      setAiInsight(insight || "Network stable. High delivery efficiency detected in Detroit sector.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateConcepts = async () => {
    setIsGeneratingLab(true);
    try {
      const recs = await getSmartSnackRecommendations(['Soda', 'Chips', 'Jerky']);
      setRecommendations(recs || []);
    } finally {
      setIsGeneratingLab(false);
    }
  };

  const publishSnack = (snack: any) => {
    const price = parseFloat(prompt(`Set retail price for ${snack.name}:`, "4.99") || "4.99");
    const newProduct: Product = {
      id: `AI-${Math.random().toString(36).substr(2, 5)}`,
      name: snack.name,
      price,
      deposit: 0,
      category: 'Snacks',
      stock: 100,
      image: 'https://images.unsplash.com/photo-15994906592b3-5405c28cd0db?auto=format&fit=crop&w=400&q=80',
    };
    setProducts(prev => [newProduct, ...prev]);
    alert(`${snack.name} is now live in the Market View!`);
  };

  const updateStock = (id: string, newStock: number) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, stock: newStock } : p));
  };

  const stats = useMemo(() => {
    const revenue = orders.reduce((acc, o) => acc + (o.status === OrderStatus.DELIVERED ? o.total : 0), 0);
    return {
      revenue: 24850.50 + revenue,
      pending: orders.filter(o => o.status === OrderStatus.PENDING).length,
      fleetStatus: orders.filter(o => o.status === OrderStatus.OUT_FOR_DELIVERY).length > 0 ? 'Active' : 'Standby',
      health: 98.4
    };
  }, [orders, products]);

  const renderDashboard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-lime-500/50 transition-all">
          <DollarSign className="w-7 h-7 text-lime-600 mb-6" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Gross Liquidity</p>
          <h3 className="text-3xl font-black text-slate-900 mt-2 tracking-tighter">${stats.revenue.toLocaleString()}</h3>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-slate-900 transition-all">
          <Clock className="w-7 h-7 text-slate-900 mb-6" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Queue Depth</p>
          <h3 className="text-3xl font-black text-slate-900 mt-2 tracking-tighter">{stats.pending} Orders</h3>
        </div>
        
        {isOwner && (
          <div className="bg-slate-900 p-8 rounded-[2.5rem] relative overflow-hidden group">
            <Globe className="absolute -right-4 -bottom-4 w-32 h-32 text-white/5 group-hover:text-lime-500/10 transition-colors" />
            <Cpu className="w-7 h-7 text-lime-400 mb-6" />
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Fleet Health</p>
            <h3 className="text-3xl font-black text-white mt-2 tracking-tighter">{stats.health}% <span className="text-[10px] text-lime-400">UP</span></h3>
          </div>
        )}

        <div className="bg-slate-900 p-8 rounded-[2.5rem] md:col-span-2 relative overflow-hidden group flex flex-col justify-between">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Sparkles className="text-lime-500 w-5 h-5 animate-pulse" />
              <h4 className="text-[10px] font-black text-lime-400 uppercase tracking-[0.3em]">Cortex Analysis</h4>
            </div>
            <button 
              onClick={handleRunAnalysis}
              disabled={isAnalyzing}
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {isAnalyzing ? "Processing" : "Sync Intelligence"}
            </button>
          </div>
          <p className="text-white text-lg font-bold italic leading-relaxed opacity-90">
            {isAnalyzing ? "AI is intercepting real-time logistical patterns..." : `"${aiInsight}"`}
          </p>
        </div>
      </div>

      {isOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <div className="lg:col-span-2 bg-white rounded-[3rem] border p-8 h-80 relative overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-900">Live Logistics Grid</h4>
                <div className="flex items-center gap-2 px-3 py-1 bg-lime-50 text-lime-600 rounded-full text-[8px] font-black uppercase">
                   <div className="w-1.5 h-1.5 bg-lime-500 rounded-full animate-ping" /> Real-time tracking
                </div>
              </div>
              <div className="absolute inset-x-8 bottom-8 top-20 bg-slate-900 rounded-2xl border border-white/5 flex items-center justify-center p-4">
                 <svg width="100%" height="100%" viewBox="0 0 400 200" className="opacity-40">
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" strokeOpacity="0.1"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                    {/* Simulated Nodes */}
                    <circle cx="50" cy="50" r="2" fill="#a3e635">
                       <animate attributeName="r" values="2;4;2" dur="2s" repeatCount="indefinite" />
                       <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="150" cy="80" r="3" fill="#a3e635">
                       <animate attributeName="r" values="3;6;3" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="300" cy="140" r="2" fill="#a3e635" />
                    <path d="M50 50 L150 80 L300 140" stroke="#a3e635" strokeWidth="1" strokeDasharray="5,5" strokeOpacity="0.3" />
                 </svg>
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <p className="text-[9px] font-black text-lime-400 uppercase tracking-[0.5em] mb-2">Sector 7 Sync: Active</p>
                    <p className="text-white text-[8px] font-bold opacity-30 uppercase">Triangulating Latency: 12ms</p>
                 </div>
              </div>
           </div>
           <div className="bg-white rounded-[3rem] border p-8 space-y-6">
              <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 border-b pb-4">Executive Tasks</h4>
              {[
                { label: 'Review Q3 Logistics', status: 'Pending', icon: List },
                { label: 'Audit Staff Clearance', status: 'Complete', icon: ShieldAlert },
                { label: 'Update Deposit Values', status: 'Action Required', icon: TrendingUp }
              ].map((task, i) => (
                <div key={i} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-lime-50 transition-colors">
                      <task.icon className="w-4 h-4 text-slate-400 group-hover:text-lime-600" />
                    </div>
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{task.label}</span>
                  </div>
                  <MoveRight className="w-4 h-4 text-slate-200 group-hover:text-slate-900 transition-colors" />
                </div>
              ))}
           </div>
        </div>
      )}
    </div>
  );

  const renderDispatch = () => {
    const availableOrders = orders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.ASSIGNED);
    if (activeDelivery) {
      return (
        <div className="bg-slate-900 rounded-[3rem] border border-slate-800 shadow-2xl overflow-hidden min-h-[500px] flex flex-col animate-in zoom-in">
          <div className="p-8 border-b border-white/5 flex justify-between items-center bg-black/20">
            <div>
              <p className="text-[10px] font-black text-lime-400 uppercase mb-1">Route: {activeDelivery.id}</p>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Vessel Tracking Active</h2>
            </div>
            <div className="px-4 py-2 bg-white/5 text-white rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
               <div className="w-2 h-2 bg-lime-500 rounded-full animate-ping" /> Synchronized
            </div>
          </div>
          <div className="flex-1 p-8 flex flex-col items-center justify-center">
            {isLoadingNav ? (
              <div className="flex flex-col items-center gap-4 text-lime-500 animate-pulse">
                <Compass className="w-16 h-16 animate-spin" />
                <p className="font-black uppercase tracking-[0.4em] text-[10px]">Triangulating Coordinates...</p>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center gap-12 text-center">
                 <div className="relative w-44 h-44 rounded-full border-8 border-lime-500/10 flex flex-col items-center justify-center bg-slate-900 shadow-2xl">
                      <Navigation className="w-10 h-10 text-lime-500" />
                      <p className="mt-2 text-3xl font-black text-white">{navSteps[currentStepIdx]?.distance || '0.1 mi'}</p>
                 </div>
                 <h3 className="text-3xl font-black text-white uppercase max-w-lg leading-tight tracking-tighter italic">
                      {navSteps[currentStepIdx]?.instruction || "Arriving at Target Destination"}
                 </h3>
                 <div className="flex gap-4">
                    <button 
                      disabled={currentStepIdx === 0}
                      onClick={() => setCurrentStepIdx(prev => prev - 1)}
                      className="px-8 py-5 bg-white/5 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest disabled:opacity-20 hover:bg-white/10 transition-all"
                    >Previous</button>
                    <button 
                      onClick={() => currentStepIdx < navSteps.length - 1 ? setCurrentStepIdx(prev => prev + 1) : handleCompleteDelivery(activeDelivery)}
                      className="px-16 py-6 bg-lime-500 text-slate-900 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl shadow-lime-500/20 active:scale-95 transition-all"
                    >
                      {currentStepIdx === navSteps.length - 1 ? 'Terminal Finalize' : 'Confirm Step'}
                    </button>
                 </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 animate-in slide-in-from-bottom">
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest flex items-center gap-3 px-4">
          <Truck className="text-lime-500" /> Live Dispatch Matrix ({availableOrders.length})
        </h3>
        <div className="space-y-4">
          {availableOrders.map(order => (
            <div key={order.id} className="bg-white p-8 rounded-[3rem] border shadow-sm flex flex-col sm:flex-row items-center justify-between gap-8 group hover:border-slate-900 transition-all">
              <div className="flex-1">
                <span className="text-[10px] font-black text-lime-600 bg-lime-50 px-4 py-1.5 rounded-full uppercase mb-3 block w-fit tracking-[0.2em]">{order.id}</span>
                <h4 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Sector 7 • Local Transit • ${order.total.toFixed(2)}</h4>
                <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-[0.3em]">{order.items.length} Package Payloads</p>
              </div>
              <button 
                onClick={() => handleStartDelivery(order)}
                className="px-12 py-5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] group-hover:bg-lime-500 group-hover:text-slate-900 transition-all shadow-xl shadow-slate-200"
              >
                Initiate Route
              </button>
            </div>
          ))}
          {availableOrders.length === 0 && (
            <div className="p-24 text-center bg-slate-50 rounded-[4rem] border-2 border-dashed border-slate-200">
               <Package className="w-12 h-12 text-slate-200 mx-auto mb-4" />
               <p className="text-slate-400 font-black uppercase text-[10px] tracking-[0.4em]">No pending dispatch payloads</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderInventory = () => (
    <div className="space-y-8 animate-in fade-in">
      <div className="flex justify-between items-center px-4">
        <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Vault Inventory</h2>
        <button className="flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-lime-500 hover:text-slate-900 shadow-2xl transition-all">
          <Plus className="w-4 h-4" /> Register Item
        </button>
      </div>
      <div className="bg-white rounded-[4rem] border shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-10 py-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Asset</th>
              <th className="px-10 py-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Valuation</th>
              <th className="px-10 py-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Availability</th>
              <th className="px-10 py-8 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Terminal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-50/50 transition-colors group">
                <td className="px-10 py-8">
                  <div className="flex items-center gap-6">
                    <img src={p.image} className="w-16 h-16 rounded-2xl object-cover shadow-xl group-hover:scale-110 transition-transform duration-500" />
                    <div>
                      <p className="font-black text-slate-900 uppercase text-sm tracking-tight">{p.name}</p>
                      <p className="text-[8px] font-black uppercase text-slate-400 mt-1.5 tracking-widest">{p.category} • {p.isUsed ? 'RE-CERTIFIED' : 'NEW ASSET'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-10 py-8 font-black text-slate-900 text-lg tracking-tighter">${p.price.toFixed(2)}</td>
                <td className="px-10 py-8">
                   <div className="flex items-center gap-3">
                      <button onClick={() => updateStock(p.id, Math.max(0, p.stock - 1))} className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-red-100 hover:text-red-500">-</button>
                      <span className={`font-black text-xs min-w-[3ch] text-center ${p.stock < 10 ? 'text-red-500' : 'text-slate-900'}`}>{p.stock}</span>
                      <button onClick={() => updateStock(p.id, p.stock + 1)} className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-lime-100 hover:text-lime-500">+</button>
                   </div>
                </td>
                <td className="px-10 py-8">
                  <button className="p-3 text-slate-300 hover:text-slate-900 transition-colors bg-slate-50 rounded-xl"><Edit2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderConfig = () => (
    <div className="max-w-4xl space-y-10 animate-in slide-in-from-right">
       <div className="bg-white p-12 rounded-[3.5rem] border shadow-sm space-y-12">
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase border-b pb-6">Global Logistics Control</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Base Delivery Surcharge ($)</label>
              <input 
                type="number" value={settings.deliveryFee} 
                onChange={(e) => setSettings({...settings, deliveryFee: parseFloat(e.target.value)})}
                className="w-full px-6 py-5 bg-slate-50 border-0 rounded-[2rem] focus:ring-2 focus:ring-lime-500 outline-none font-black text-lg" 
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">MI Return Fee (%)</label>
              <input 
                type="number" value={settings.processingFeePercent * 100} 
                onChange={(e) => setSettings({...settings, processingFeePercent: parseFloat(e.target.value)/100})}
                className="w-full px-6 py-5 bg-slate-50 border-0 rounded-[2rem] focus:ring-2 focus:ring-lime-500 outline-none font-black text-lg" 
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-8 bg-red-50 rounded-[2.5rem] border border-red-100">
            <div>
              <h4 className="font-black text-red-800 uppercase text-xs tracking-[0.2em] mb-1">Fleet Lockdown</h4>
              <p className="text-[10px] text-red-600 font-bold">Suspend all commercial operations immediately.</p>
            </div>
            <button 
              onClick={() => setSettings({...settings, maintenanceMode: !settings.maintenanceMode})}
              className={`relative inline-flex h-10 w-20 items-center rounded-full transition-all focus:outline-none ${settings.maintenanceMode ? 'bg-red-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-8 w-8 transform rounded-full bg-white shadow-md transition-transform ${settings.maintenanceMode ? 'translate-x-11' : 'translate-x-1'}`} />
            </button>
          </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-160px)] flex flex-col lg:flex-row gap-10">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-72 flex-col gap-2 bg-slate-900 p-8 rounded-[4rem] border border-slate-800 shadow-2xl sticky top-24 h-[calc(100vh-140px)]">
        <div className="mb-12 px-2 border-b border-white/5 pb-8">
          <p className="text-lime-400 text-[10px] font-black uppercase tracking-[0.5em] mb-2">Command Matrix</p>
          <p className="text-white text-xs font-black uppercase tracking-[0.2em]">{user.role}</p>
        </div>
        {modules.map(mod => (
          <button
            key={mod.id}
            onClick={() => setActiveModule(mod.id)}
            className={`flex items-center gap-5 px-6 py-5 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all group ${
              activeModule === mod.id 
                ? 'bg-lime-500 text-slate-900 shadow-[0_0_30px_rgba(163,230,53,0.2)]' 
                : 'text-slate-500 hover:text-white hover:bg-white/5'
            }`}
          >
            <mod.icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${activeModule === mod.id ? 'text-slate-900' : 'text-slate-600'}`} /> {mod.label}
          </button>
        ))}
      </aside>

      {/* Main Content Hub */}
      <div className="flex-1 px-4 lg:px-0">
         {activeModule === 'dashboard' && renderDashboard()}
         {activeModule === 'dispatch' && renderDispatch()}
         {activeModule === 'inventory' && renderInventory()}
         {activeModule === 'config' && renderConfig()}
         {activeModule === 'lab' && (
           <div className="bg-white p-16 rounded-[4rem] border shadow-xl space-y-16 animate-in fade-in">
              <div className="flex justify-between items-end border-b pb-12">
                <div>
                  <h3 className="text-4xl font-black uppercase tracking-tighter">Innovation Lab</h3>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-3">Synthesizing Alpha Product Concepts</p>
                </div>
                <button 
                  onClick={handleGenerateConcepts}
                  disabled={isGeneratingLab}
                  className="px-10 py-5 bg-slate-900 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-lime-500 hover:text-slate-900 transition-all flex items-center gap-4 disabled:opacity-50 shadow-2xl"
                >
                  {isGeneratingLab ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 fill-current" />}
                  {isGeneratingLab ? "Processing" : "Generate Lab Data"}
                </button>
              </div>
              
              {recommendations.length === 0 && !isGeneratingLab ? (
                <div className="py-40 text-center bg-slate-50 rounded-[4rem] border-2 border-dashed border-slate-200">
                  <ChefHat className="w-16 h-16 text-slate-200 mx-auto mb-6" />
                  <p className="text-slate-400 font-black uppercase text-[10px] tracking-[0.4em]">Awaiting synthetic concept generation</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                    {recommendations.map((snack, idx) => (
                      <div key={idx} className="bg-slate-50 rounded-[3.5rem] p-12 border border-slate-200 hover:border-lime-500 transition-all group animate-in zoom-in">
                        <div className="aspect-square bg-slate-200 rounded-[2.5rem] mb-10 flex items-center justify-center overflow-hidden border">
                           <ChefHat className="w-16 h-16 text-slate-300 group-hover:scale-125 transition-transform duration-700" />
                        </div>
                        <h4 className="font-black text-2xl mb-4 uppercase tracking-tighter">{snack.name}</h4>
                        <p className="text-xs font-bold text-slate-500 mb-10 leading-relaxed opacity-80 italic">"{snack.reason}"</p>
                        <button 
                           onClick={() => publishSnack(snack)}
                           className="w-full py-6 bg-slate-900 text-white rounded-3xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-lime-500 hover:text-slate-900 transition-all"
                        >
                           Publish To Market
                        </button>
                      </div>
                    ))}
                </div>
              )}
           </div>
         )}
         {activeModule === 'users' && (
           <div className="bg-white p-16 rounded-[4rem] border shadow-xl animate-in slide-in-from-left">
              <h3 className="text-4xl font-black uppercase tracking-tighter mb-12">Personnel Hub</h3>
              <div className="space-y-6">
                {users.map(u => (
                  <div key={u.id} className="p-8 bg-slate-50 rounded-[3rem] border flex items-center justify-between group hover:border-lime-300 transition-all">
                    <div className="flex items-center gap-8">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-slate-900 flex items-center justify-center text-white font-black text-2xl group-hover:bg-lime-500 group-hover:text-slate-900 transition-all duration-500 shadow-xl">
                        {u.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-black text-slate-900 uppercase text-lg tracking-tight">{u.name}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-1">{u.role} • Security ID {u.id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                       <button className="px-6 py-3 bg-white border rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-900 hover:text-white transition-all">Edit Clearance</button>
                       <button className="p-3 text-red-300 hover:text-red-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  </div>
                ))}
              </div>
           </div>
         )}
      </div>
    </div>
  );
};

export default ManagementView;
