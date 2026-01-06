
import React, { useState } from 'react';
import { Product, Order, OrderStatus, User, UserTier } from '../types';
import { 
  Plus, Search, History, Award, Truck, MapPin, 
  Navigation, Star, ShieldAlert, Settings, Wallet, 
  ChevronRight, ArrowLeft, Package, Clock, ShieldCheck,
  RefreshCw, UserCheck, Mail, Edit2, Share2, ChevronDown, ChevronUp, Zap, Coins, CheckCircle2, Save, X
} from 'lucide-react';

interface CustomerViewProps {
  products: Product[];
  orders: Order[];
  currentUser: User | null;
  openLogin: () => void;
  onRequestRefund: (orderId: string) => void;
  addToCart: (id: string) => void;
  updateUserProfile: (updates: Partial<User>) => void;
  reorderItems: (items: { productId: string; quantity: number }[]) => void;
  onRedeemPoints: (points: number) => void;
}

const CustomerView: React.FC<CustomerViewProps> = ({ 
  products, 
  orders, 
  currentUser, 
  openLogin, 
  onRequestRefund, 
  addToCart, 
  updateUserProfile,
  reorderItems,
  onRedeemPoints
}) => {
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || '');
  const [editEmail, setEditEmail] = useState(currentUser?.email || '');

  const activeOrders = orders.filter(o => [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.PICKED_UP, OrderStatus.ARRIVING].includes(o.status));
  
  const filteredProducts = products.filter(p => 
    (activeCategory === 'ALL' || p.category.toUpperCase() === activeCategory) &&
    (p.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getTierColor = (tier: UserTier) => {
    switch(tier) {
      case UserTier.GOLD: return 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5';
      case UserTier.SILVER: return 'text-slate-300 border-slate-300/20 bg-slate-300/5';
      default: return 'text-orange-500 border-orange-500/20 bg-orange-500/5';
    }
  };

  const getPointsToNextTier = () => {
    if (!currentUser) return 0;
    if (currentUser.tier === UserTier.GOLD) return 0;
    if (currentUser.tier === UserTier.SILVER) return 5000 - currentUser.loyaltyPoints;
    return 1000 - currentUser.loyaltyPoints;
  };

  const getTierProgress = () => {
    if (!currentUser) return 0;
    const pts = currentUser.loyaltyPoints;
    if (pts >= 5000) return 100;
    if (pts >= 1000) return ((pts - 1000) / 4000) * 100;
    return (pts / 1000) * 100;
  };

  const handleUpdateProfile = () => {
    updateUserProfile({ name: editName, email: editEmail });
    setIsEditingProfile(false);
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col xl:flex-row gap-8 items-center justify-between">
        {!showSettings ? (
          <>
            <div className="relative flex-1 w-full lg:max-w-2xl">
              <input type="text" placeholder="Search Logistics Hub..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-ninpo-midnight border border-white/10 text-white px-10 py-7 rounded-[2.5rem] font-bold text-lg shadow-2xl outline-none placeholder:text-slate-800 focus:border-ninpo-lime transition-all" />
              <Search className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-800 w-6 h-6" />
            </div>
            {currentUser && (
              <button onClick={() => setShowSettings(true)} className="px-8 py-5 bg-ninpo-card border border-white/5 rounded-[1.5rem] text-white font-black text-[12px] uppercase tracking-widest flex items-center gap-3 hover:border-ninpo-lime/40 transition-all shadow-lg active:scale-95">
                <Settings className="w-5 h-5 text-slate-600" /> Dispatch Intelligence
              </button>
            )}
          </>
        ) : (
          <button onClick={() => setShowSettings(false)} className="px-8 py-5 bg-ninpo-card border border-white/5 rounded-[1.5rem] text-slate-400 font-black text-[12px] uppercase tracking-widest flex items-center gap-3 hover:text-white transition-all">
            <ArrowLeft className="w-5 h-5" /> Back to Terminal
          </button>
        )}
      </div>

      {!showSettings ? (
        <div className="space-y-12">
          {activeOrders.length > 0 && (
            <div className="bg-ninpo-midnight rounded-[3rem] border border-ninpo-lime/20 p-8 space-y-4 animate-in slide-in-bottom">
                <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="w-3 h-3 bg-ninpo-lime rounded-full animate-pulse" />
                    <h3 className="text-white font-black uppercase text-[10px] tracking-[0.3em]">Active Logistics Dispatches</h3>
                </div>
                {activeOrders.map(o => (
                    <div key={o.id} className="bg-white/5 p-6 rounded-3xl flex items-center justify-between group hover:bg-white/10 transition-all border border-transparent">
                        <div className="flex items-center gap-6">
                            <Package className="w-6 h-6 text-ninpo-lime group-hover:scale-110 transition-transform" />
                            <div>
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{o.id}</p>
                                <p className="text-white font-black text-xs uppercase mt-1">{o.status.replace('_', ' ')}</p>
                            </div>
                        </div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] hidden sm:block">Awaiting Satellite Ping...</span>
                    </div>
                ))}
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4 px-1">
            {['ALL', 'SAVORY', 'SWEET', 'DRINK', 'HEALTHY', 'USED GEAR'].map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all whitespace-nowrap shadow-xl ${activeCategory === cat ? 'bg-ninpo-lime text-ninpo-black shadow-neon' : 'bg-ninpo-card border border-white/5 text-slate-600 hover:text-white hover:border-white/20'}`}>
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-8">
            {filteredProducts.map(p => (
              <div key={p.id} className="bg-ninpo-card rounded-[3.5rem] p-6 flex flex-col border border-white/5 shadow-2xl relative group hover:border-ninpo-lime/20 transition-all duration-500">
                <div className="aspect-square rounded-[2.5rem] overflow-hidden mb-6 bg-ninpo-black relative">
                  <img src={p.image} className={`w-full h-full object-cover grayscale transition-all duration-700 ${p.stock > 0 ? 'group-hover:grayscale-0 group-hover:scale-110' : 'opacity-20'}`} alt={p.name} />
                  {p.stock === 0 && (
                     <div className="absolute inset-0 flex items-center justify-center bg-ninpo-black/40">
                        <span className="text-[9px] font-black text-white border border-white/20 px-3 py-1 rounded-full uppercase tracking-widest backdrop-blur-md">Depleted</span>
                     </div>
                  )}
                </div>
                <div className="space-y-2 mb-10 px-1">
                  <h4 className="text-white font-black text-[13px] uppercase group-hover:text-ninpo-lime transition-colors leading-tight">{p.name}</h4>
                  <p className="text-slate-700 font-bold text-[9px] uppercase tracking-widest">{p.category}</p>
                </div>
                <div className="mt-auto flex justify-between items-center px-1">
                  <span className="text-ninpo-lime font-black text-lg tracking-tighter">${p.price.toFixed(2)}</span>
                  <button onClick={() => addToCart(p.id)} disabled={p.stock === 0} className="w-12 h-12 bg-ninpo-lime rounded-[1.2rem] flex items-center justify-center text-ninpo-black hover:bg-white active:scale-90 transition-all shadow-neon disabled:opacity-5 disabled:grayscale">
                    <Plus className="w-6 h-6 stroke-[3px]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto space-y-12 animate-in slide-in-bottom">
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-ninpo-midnight p-10 rounded-[4rem] border border-white/5 space-y-12">
                 <div className="flex flex-col md:flex-row gap-10 items-center md:items-start justify-between">
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start text-center md:text-left">
                        <div className="w-36 h-36 bg-ninpo-black rounded-full border-4 border-white/5 flex items-center justify-center shadow-2xl relative">
                           <Award className={`w-16 h-16 ${currentUser?.tier === UserTier.GOLD ? 'text-yellow-400' : currentUser?.tier === UserTier.SILVER ? 'text-slate-300' : 'text-orange-500'}`} />
                           <div className="absolute -bottom-2 bg-ninpo-lime text-ninpo-black px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-neon">Verified</div>
                        </div>
                        <div className="space-y-4 pt-2">
                            {isEditingProfile ? (
                                <div className="space-y-4 w-full md:w-80">
                                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="bg-white/5 border border-white/10 rounded-2xl p-5 text-white font-black uppercase text-xs w-full outline-none focus:border-ninpo-lime" placeholder="Name" />
                                    <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="bg-white/5 border border-white/10 rounded-2xl p-5 text-white font-black uppercase text-xs w-full outline-none focus:border-ninpo-lime" placeholder="Email" />
                                    <div className="flex gap-3">
                                        <button onClick={handleUpdateProfile} className="flex-1 py-4 bg-ninpo-lime text-ninpo-black rounded-2xl font-black uppercase text-[10px] flex items-center justify-center gap-2 shadow-neon"><CheckCircle2 className="w-4 h-4" /> Commit</button>
                                        <button onClick={() => setIsEditingProfile(false)} className="px-6 py-4 bg-white/5 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/10 transition-all">Abort</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <h2 className="text-4xl font-black text-white uppercase tracking-tighter leading-none">{currentUser?.name}</h2>
                                    <div className={`inline-flex items-center gap-3 px-6 py-2.5 rounded-full border ${getTierColor(currentUser!.tier)} shadow-lg bg-ninpo-black/50`}>
                                        <Star className="w-4 h-4 fill-current" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">{currentUser?.tier} CLEARANCE</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    {!isEditingProfile && (
                        <button onClick={() => setIsEditingProfile(true)} className="p-5 bg-white/5 rounded-3xl text-slate-600 hover:text-white hover:bg-white/10 transition-all active:scale-90"><Edit2 className="w-6 h-6" /></button>
                    )}
                 </div>

                 <div className="bg-white/5 p-10 rounded-[3rem] border border-white/5 space-y-8">
                    <div className="flex justify-between items-center">
                        <h3 className="text-white font-black uppercase text-[10px] tracking-[0.3em]">Tier Progression Engine</h3>
                        {currentUser?.tier !== UserTier.GOLD && (
                            <span className="text-ninpo-lime font-black text-[10px] uppercase tracking-widest">{getPointsToNextTier()} EXP TO UPGRADE</span>
                        )}
                    </div>
                    <div className="h-6 bg-ninpo-black rounded-full overflow-hidden border border-white/10 relative shadow-inner">
                        <div className="absolute inset-0 bg-ninpo-lime opacity-5 animate-pulse" />
                        <div className="h-full bg-ninpo-lime shadow-neon transition-all duration-1000 ease-out" style={{ width: `${getTierProgress()}%` }} />
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-black text-slate-700 uppercase tracking-[0.4em]">
                        <span className={currentUser?.tier === UserTier.BRONZE ? 'text-ninpo-lime' : ''}>Bronze</span>
                        <span className={currentUser?.tier === UserTier.SILVER ? 'text-ninpo-lime' : ''}>Silver</span>
                        <span className={currentUser?.tier === UserTier.GOLD ? 'text-ninpo-lime' : ''}>Gold</span>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-ninpo-lime/5 p-8 rounded-[3rem] border border-ninpo-lime/20 space-y-6">
                        <div className="flex items-center gap-3">
                            <Coins className="w-5 h-5 text-ninpo-lime" />
                            <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">Loyalty Node</h3>
                        </div>
                        <div className="flex justify-between items-center bg-ninpo-black/80 p-6 rounded-2xl border border-white/5 shadow-xl">
                            <span className="text-white font-black text-3xl tracking-tighter">{currentUser?.loyaltyPoints}</span>
                            <button disabled={!currentUser || currentUser.loyaltyPoints < 1000} onClick={() => onRedeemPoints(1000)} className="px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase disabled:opacity-20 transition-all active:scale-95 shadow-neon">Redeem $5</button>
                        </div>
                    </div>
                    <div className="bg-white/5 p-8 rounded-[3rem] border border-white/5 space-y-6">
                        <div className="flex items-center gap-3">
                            <Share2 className="w-5 h-5 text-slate-600" />
                            <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">Referral Uplink</h3>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(currentUser?.referralCode || ''); alert("Referral ID uplinked to clipboard."); }} className="w-full py-5 bg-ninpo-black/80 border border-white/10 rounded-2xl text-[12px] font-black text-slate-400 hover:text-ninpo-lime transition-all uppercase tracking-[0.2em] group">
                          {currentUser?.referralCode}
                          <span className="block text-[8px] text-slate-700 group-hover:text-ninpo-lime mt-2">(Copy Protocol)</span>
                        </button>
                    </div>
                 </div>
              </div>
              <div className="bg-ninpo-card p-10 rounded-[4rem] border border-white/5 flex flex-col justify-center items-center text-center space-y-10 shadow-2xl relative overflow-hidden group">
                 <div className="absolute inset-0 bg-ninpo-lime opacity-0 group-hover:opacity-[0.02] transition-opacity duration-1000" />
                 <div className="w-24 h-24 bg-ninpo-lime/10 rounded-[2.5rem] flex items-center justify-center border border-ninpo-lime/20 shadow-neon">
                    <Wallet className="w-12 h-12 text-ninpo-lime" />
                 </div>
                 <div>
                    <h3 className="text-slate-600 font-black uppercase text-[10px] tracking-[0.4em] mb-3">System Credits</h3>
                    <p className="text-6xl font-black text-white tracking-tighter leading-none">${currentUser?.credits.toFixed(2)}</p>
                 </div>
                 <button className="w-full py-5 bg-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-all border border-white/5 hover:border-white/10 active:scale-95">Recharge Node</button>
              </div>
           </div>

           <div className="space-y-12">
              <h3 className="text-white font-black uppercase text-xs tracking-[0.5em] flex items-center gap-5 px-2">
                <History className="w-6 h-6 text-ninpo-lime" /> Dispatch Operations History
              </h3>
              <div className="grid grid-cols-1 gap-8">
                {orders.length === 0 ? (
                  <div className="py-24 bg-ninpo-card rounded-[4rem] text-center border border-white/5 shadow-inner">
                    <p className="text-[10px] font-black text-slate-800 uppercase tracking-[0.5em]">No Previous Operations Detected</p>
                  </div>
                ) : (
                  orders.slice().reverse().map(o => (
                    <div key={o.id} className="bg-ninpo-card p-10 rounded-[4rem] border border-white/5 space-y-10 hover:border-white/20 transition-all group shadow-2xl">
                      <div className="flex flex-col md:flex-row justify-between items-start gap-8">
                          <div>
                              <p className="text-[10px] font-black text-slate-700 uppercase mb-3 tracking-[0.3em]">LOG_TOKEN: {o.id}</p>
                              <p className="text-white font-black text-2xl uppercase leading-tight tracking-tight">{o.address}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase border tracking-[0.2em] shadow-lg ${o.status === OrderStatus.DELIVERED ? 'text-ninpo-lime border-ninpo-lime/20 bg-ninpo-lime/5' : 'text-slate-500 border-white/10 bg-white/5'}`}>{o.status.replace('_', ' ')}</span>
                          </div>
                      </div>
                      <div className="flex flex-wrap gap-4">
                          {o.items.map((item, idx) => {
                              const p = products.find(prod => prod.id === item.productId);
                              return p && (
                                  <div key={idx} className="flex items-center gap-4 bg-ninpo-black/60 px-6 py-4 rounded-[1.5rem] border border-white/5 group-hover:border-white/10 transition-all shadow-inner">
                                      <span className="text-xs font-black text-ninpo-lime">{item.quantity}x</span>
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{p.name}</span>
                                  </div>
                              );
                          })}
                      </div>
                      <div className="flex justify-between items-center pt-10 border-t border-white/5">
                          <p className="text-4xl font-black text-white tracking-tighter leading-none">${o.total.toFixed(2)}</p>
                          <div className="flex gap-4">
                            <button onClick={() => reorderItems(o.items)} className="px-10 py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-neon">Reorder Skus</button>
                            {o.status === OrderStatus.PAID && (
                                <button onClick={() => onRequestRefund(o.id)} className="px-8 py-5 bg-white/5 text-slate-600 rounded-2xl text-[11px] font-black uppercase hover:text-ninpo-red transition-all border border-transparent hover:border-ninpo-red/20">Refund Auth</button>
                            )}
                          </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default CustomerView;
