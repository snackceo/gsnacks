
import React, { useMemo, useState, useEffect } from 'react';
import { Order, AppSettings, User, OrderStatus } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  ShieldAlert, 
  Zap, 
  ChefHat, 
  Sparkles, 
  Loader2, 
  ArrowRight, 
  Wrench, 
  UserCog, 
  Database, 
  Terminal, 
  Trash2, 
  Plus, 
  Minus,
  CheckCircle,
  XCircle,
  Clock,
  LayoutGrid,
  Settings
} from 'lucide-react';
import { analyzeSalesTrends, getSmartSnackRecommendations, generateSnackImage } from '../services/geminiService';

interface OwnerViewProps {
  orders: Order[];
  users: User[];
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  currentUser: User;
  setCurrentUser: (u: User) => void;
  updateOrder: (id: string, status: OrderStatus) => void;
  deleteOrder: (id: string) => void;
  adjustCredits: (userId: string, amount: number) => void;
}

const OwnerView: React.FC<OwnerViewProps> = ({ 
  orders, 
  users, 
  settings, 
  setSettings, 
  currentUser, 
  updateOrder, 
  deleteOrder, 
  adjustCredits 
}) => {
  const [activeTab, setActiveTab] = useState<'analytics' | 'command' | 'users' | 'lab'>('analytics');
  const [aiInsight, setAiInsight] = useState<string>("Initializing secure data tunnel...");
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const data = useMemo(() => [
    { name: 'Mon', sales: 4200 },
    { name: 'Tue', sales: 3800 },
    { name: 'Wed', sales: 4900 },
    { name: 'Thu', sales: 5200 },
    { name: 'Fri', sales: 6100 },
    { name: 'Sat', sales: 7400 },
    { name: 'Sun', sales: 6800 },
  ], []);

  // Use memoized order count to prevent re-running analysis when only tracking coords update
  const orderCount = orders.length;

  useEffect(() => {
    let isMounted = true;
    const fetchAnalysis = async () => {
      try {
        const insight = await analyzeSalesTrends(orders);
        if (isMounted) setAiInsight(insight || "System stable. Market dominance at 82%.");
      } catch (e) {
        if (isMounted) setAiInsight("Neural analytics core cooling down. Reverting to cached heuristic models.");
      }
    };
    fetchAnalysis();
    return () => { isMounted = false; };
  }, [orderCount]); // Only re-run when actual new orders appear, not tracking updates

  useEffect(() => {
    loadRecommendations();
  }, []); // Only load once on mount to save quota

  const loadRecommendations = async () => {
    if (isLoadingRecs) return;
    setIsLoadingRecs(true);
    try {
      const recs = await getSmartSnackRecommendations(['Zesty Lime Soda', 'Kettle Chips', 'MI Specials']);
      setRecommendations(recs || []);
    } catch (error) {
      console.error("Lab recs failed", error);
    } finally {
      setIsLoadingRecs(false);
    }
  };

  const handleGenerateImage = async (snackName: string) => {
    if (generatingFor) return;
    setGeneratingFor(snackName);
    try {
      const url = await generateSnackImage(snackName);
      if (url) {
        setGeneratedImages(prev => ({ ...prev, [snackName]: url }));
      }
    } catch (error) {
      console.error("Visual gen failed", error);
    } finally {
      setGeneratingFor(null);
    }
  };

  const totalRevenue = orders.reduce((acc, o) => acc + o.total, 0) + 24850.50;

  return (
    <div className="space-y-10 pb-20">
      {/* God Mode Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-lime-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-lime-500 p-2 rounded-xl shadow-lg shadow-lime-500/20"><Database className="w-5 h-5 text-slate-900" /></div>
            <span className="text-xs font-black uppercase tracking-[0.4em] text-lime-400">System Administrator</span>
          </div>
          <h1 className="text-5xl font-black tracking-tighter uppercase leading-none">GOD <span className="text-lime-500">MODE</span></h1>
          <p className="text-slate-400 font-bold mt-4 uppercase tracking-widest text-xs flex items-center gap-2">
            <Clock className="w-3 h-3" /> Live Operations Feed • {new Date().toLocaleTimeString()}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 relative z-10">
          {[
            { id: 'analytics', label: 'Dashboard', icon: LayoutGrid },
            { id: 'command', label: 'Ops Command', icon: Terminal },
            { id: 'users', label: 'Custo Registry', icon: UserCog },
            { id: 'lab', label: 'R&D Lab', icon: ChefHat }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id ? 'bg-lime-500 text-slate-900 shadow-xl shadow-lime-500/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'analytics' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-lime-500/50 transition-all">
              <div className="bg-lime-50 w-14 h-14 rounded-2xl flex items-center justify-center text-lime-600 mb-6 group-hover:scale-110 transition-transform">
                <DollarSign className="w-7 h-7" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Volume</p>
              <h3 className="text-3xl font-black text-slate-900 mt-2">${totalRevenue.toLocaleString()}</h3>
              <div className="flex items-center gap-2 text-lime-600 text-[10px] font-black mt-3 uppercase tracking-widest">
                <TrendingUp className="w-3 h-3" /> Alpha-Growth Positive
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-slate-900 transition-all">
              <div className="bg-slate-900 w-14 h-14 rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                <Users className="w-7 h-7" />
              </div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Network Nodes</p>
              <h3 className="text-3xl font-black text-slate-900 mt-2">{users.length} Active</h3>
              <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black mt-3 uppercase tracking-widest">
                <Zap className="w-3 h-3 text-lime-500" /> Real-time Sync
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2.5rem] md:col-span-2 relative overflow-hidden shadow-2xl group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-lime-500/5 rounded-full blur-[80px]"></div>
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-lime-500 p-2.5 rounded-xl"><Sparkles className="text-white w-5 h-5 animate-pulse" /></div>
                    <h4 className="text-xs font-black text-lime-400 uppercase tracking-widest">Gemini Neural Core</h4>
                  </div>
                  <p className="text-white text-xl font-bold italic leading-relaxed">"{aiInsight}"</p>
                </div>
                <div className="mt-8 flex items-center gap-3 text-[10px] font-black text-lime-400 uppercase tracking-widest">
                   Operational Efficiency: 98.4% <div className="w-2 h-2 bg-lime-500 rounded-full animate-ping"></div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-10 rounded-[3rem] border shadow-sm">
            <h3 className="text-xl font-black mb-10 uppercase tracking-widest flex items-center gap-3">
               <TrendingUp className="text-lime-500" /> Revenue Velocity
            </h3>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a3e635" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#a3e635" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 900}} dy={15} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 900}} dx={-15} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(163 230 53 / 0.1)', fontWeight: 900 }}
                    cursor={{ stroke: '#a3e635', strokeWidth: 2 }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="#a3e635" strokeWidth={5} fillOpacity={1} fill="url(#colorSales)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {activeTab === 'command' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-8 rounded-[2rem] border shadow-sm">
             <h3 className="text-xl font-black uppercase tracking-widest">Global Order Overrides</h3>
             <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-4 py-2 rounded-full uppercase">{orders.length} TOTAL IN FLIGHT</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {orders.length === 0 ? (
              <div className="lg:col-span-2 p-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                <p className="text-slate-300 font-black uppercase tracking-widest text-sm italic">No active missions detected...</p>
              </div>
            ) : (
              orders.map(order => (
                <div key={order.id} className="bg-white p-8 rounded-[2.5rem] border shadow-md hover:shadow-2xl hover:border-lime-500 transition-all group overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Terminal className="w-32 h-32" />
                  </div>
                  
                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <div>
                      <span className="text-[10px] font-black text-lime-600 bg-lime-50 px-3 py-1 rounded-full uppercase tracking-widest mb-2 block w-fit">{order.id}</span>
                      <h4 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Custo Order • ${order.total.toFixed(2)}</h4>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
                        order.status === OrderStatus.DELIVERED ? 'bg-lime-500 text-white' : 'bg-slate-900 text-white'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 relative z-10 border-t border-slate-50 pt-6">
                    <button onClick={() => updateOrder(order.id, OrderStatus.ASSIGNED)} className="flex-1 py-3 bg-slate-100 text-slate-900 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-colors">Assign</button>
                    <button onClick={() => updateOrder(order.id, OrderStatus.OUT_FOR_DELIVERY)} className="flex-1 py-3 bg-slate-100 text-slate-900 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-colors">Dispatch</button>
                    <button onClick={() => updateOrder(order.id, OrderStatus.DELIVERED)} className="flex-1 py-3 bg-lime-500 text-white rounded-xl text-[10px] font-black uppercase hover:bg-lime-600 transition-colors">Force Complete</button>
                    <button onClick={() => deleteOrder(order.id)} className="p-3 bg-red-50 text-red-600 rounded-xl hover:bg-red-600 hover:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm">
             <h3 className="text-xl font-black uppercase tracking-widest mb-6">Custo Node Registry</h3>
             <div className="overflow-x-auto">
                <table className="w-full text-left">
                   <thead>
                      <tr className="border-b border-slate-50">
                         <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Node ID</th>
                         <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Identity</th>
                         <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Credits</th>
                         <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Loyalty</th>
                         <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Override</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-50">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="px-6 py-6 font-mono text-[10px] text-slate-400 uppercase">{u.id}</td>
                           <td className="px-6 py-6">
                              <div className="font-black text-slate-900 uppercase text-xs">{u.name}</div>
                              <div className="text-[10px] text-slate-400 font-bold">{u.email}</div>
                           </td>
                           <td className="px-6 py-6">
                              <span className="text-lg font-black text-lime-600">${u.credits.toFixed(2)}</span>
                           </td>
                           <td className="px-6 py-6">
                              <div className="flex items-center gap-2">
                                <StarIcon className="w-3 h-3 text-amber-500 fill-amber-500" />
                                <span className="font-black text-xs text-slate-700">{u.loyaltyPoints}</span>
                              </div>
                           </td>
                           <td className="px-6 py-6">
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={() => adjustCredits(u.id, 5)} className="p-2 bg-lime-100 text-lime-700 rounded-lg hover:bg-lime-500 hover:text-white transition-all"><Plus className="w-3 h-3" /></button>
                                 <button onClick={() => adjustCredits(u.id, -5)} className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-500 hover:text-white transition-all"><Minus className="w-3 h-3" /></button>
                                 <button className="p-2 bg-slate-900 text-white rounded-lg"><Wrench className="w-3 h-3" /></button>
                              </div>
                           </td>
                        </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>
        </div>
      )}

      {activeTab === 'lab' && (
        <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-xl overflow-hidden relative">
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-10 gap-6">
              <div className="flex items-center gap-5">
                <div className="p-4 bg-slate-50 rounded-3xl"><ChefHat className="text-slate-900 w-8 h-8" /></div>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tighter">SNACK LAB</h3>
                  <p className="text-slate-500 text-sm font-bold">AI Concept Generation for Michigan Market</p>
                </div>
              </div>
              <button onClick={loadRecommendations} className="px-6 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-lime-500 transition-all flex items-center gap-2">
                <Zap className="w-4 h-4" /> Run Lab Simulations
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {isLoadingRecs ? (
                <div className="col-span-3 py-24 flex flex-col items-center justify-center gap-6">
                  <Loader2 className="w-12 h-12 text-lime-500 animate-spin" />
                  <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Simulating Market Trends...</p>
                </div>
              ) : (
                recommendations.map((snack, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-[2.5rem] p-8 border border-slate-100 hover:border-lime-300 transition-all group hover:bg-white hover:shadow-2xl">
                    <div className="aspect-square rounded-[2rem] bg-slate-200 mb-8 overflow-hidden relative shadow-inner">
                      {generatedImages[snack.name] ? (
                        <img src={generatedImages[snack.name]} className="w-full h-full object-cover animate-in fade-in zoom-in duration-1000" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-center p-6">
                          {generatingFor === snack.name ? (
                            <Loader2 className="w-10 h-10 text-lime-500 animate-spin" />
                          ) : (
                            <div className="bg-white/50 p-4 rounded-2xl border border-dashed border-slate-300">
                               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">No Visual Concept</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <h4 className="font-black text-xl mb-3 text-slate-900 uppercase tracking-tight">{snack.name}</h4>
                    <p className="text-xs font-bold text-slate-500 mb-6 leading-relaxed line-clamp-3">{snack.description}</p>
                    <button 
                      onClick={() => handleGenerateImage(snack.name)}
                      disabled={generatingFor === snack.name}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-lime-500 transition-all flex items-center justify-center gap-2 group-hover:scale-105 shadow-xl shadow-slate-100"
                    >
                      {generatedImages[snack.name] ? 'REGENERATE CONCEPT' : 'VISUALIZE IN AI'} <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Config Overrides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-red-50 p-10 rounded-[3rem] border border-red-100 group">
          <div className="flex items-center gap-4 mb-6">
             <ShieldAlert className="text-red-600 w-8 h-8 group-hover:rotate-12 transition-transform" />
             <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">System Quarantine</h3>
          </div>
          <p className="text-xs font-bold text-slate-500 mb-8 leading-relaxed uppercase tracking-widest">Emergency protocol to disable all customer-facing services and driver logistics.</p>
          <div className="flex items-center justify-between p-6 bg-white rounded-3xl border border-red-100">
             <div>
                <h4 className="font-black text-red-800 uppercase text-[10px] tracking-widest">Maintenance Mode</h4>
                <p className="text-[9px] text-red-500 font-bold mt-1">Status: {settings.maintenanceMode ? 'LOCKED' : 'NOMINAL'}</p>
             </div>
             <button 
                onClick={() => setSettings({...settings, maintenanceMode: !settings.maintenanceMode})}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${settings.maintenanceMode ? 'bg-red-600 shadow-lg shadow-red-500/20' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${settings.maintenanceMode ? 'translate-x-7' : 'translate-x-1'}`} />
             </button>
          </div>
        </div>

        <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-lime-500/5 rounded-full blur-3xl"></div>
          <div className="flex items-center justify-between mb-8 relative z-10">
             <div className="flex items-center gap-4">
                <div className="bg-white/10 p-3 rounded-2xl"><Settings className="text-lime-400 w-6 h-6" /></div>
                <h3 className="text-xl font-black uppercase tracking-tighter">Global Parameters</h3>
             </div>
             <Wrench className="w-5 h-5 text-slate-700" />
          </div>
          <div className="space-y-4 relative z-10">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
               MI Deposit Multiplier: <span className="text-lime-400">x1.0 (Fixed)</span>
            </div>
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
               Referral Engine: <span className="text-lime-400">${settings.referralBonus.toFixed(2)} / Sign-up</span>
            </div>
            <button className="w-full mt-4 bg-white/5 border border-white/10 py-5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-lime-500 hover:text-slate-900 transition-all">
               Modify Operational Logic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function StarIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export default OwnerView;
