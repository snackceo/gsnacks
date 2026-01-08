import React, { useState } from 'react';
import { Product, Order, OrderStatus, User, UserTier } from '../types';
import {
  Plus,
  Search,
  Award,
  Settings,
  Leaf,
  Star,
  Coins,
  Zap,
  Info
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
  addToCart,
  onRedeemPoints
}) => {
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const filteredProducts = products.filter(
    p =>
      (activeCategory === 'ALL' ||
        p.category.toUpperCase() === activeCategory) &&
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Safe numeric defaults (prevents toFixed crash when fields are missing)
  const safeCredits = (currentUser as any)?.credits ?? 0;
  const safeDailyReturnTotal = (currentUser as any)?.dailyReturnTotal ?? 0;
  const safeLoyaltyPoints = (currentUser as any)?.loyaltyPoints ?? 0;

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col xl:flex-row gap-8 items-center justify-between">
        <div className="relative flex-1 w-full lg:max-w-2xl">
          <input
            type="text"
            placeholder="Search Logistics Hub..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-ninpo-midnight border border-white/10 text-white px-10 py-7 rounded-[2.5rem] font-bold text-lg shadow-2xl outline-none placeholder:text-slate-800 focus:border-ninpo-lime transition-all"
          />
          <Search className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-800 w-6 h-6" />
        </div>

        <div className="flex gap-4">
          {currentUser && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-8 py-5 bg-ninpo-card border border-white/5 rounded-[1.5rem] text-white font-black text-[12px] uppercase tracking-widest flex items-center gap-3 hover:border-ninpo-lime/40 transition-all shadow-lg active:scale-95"
            >
              <Settings className="w-5 h-5 text-slate-600" /> Dispatch
              Intelligence
            </button>
          )}
        </div>
      </div>

      {!showSettings ? (
        <div className="space-y-12">
          {orders.filter(
            o => o.status !== OrderStatus.DELIVERED && o.status !== OrderStatus.REFUNDED
          ).length > 0 && (
            <div className="space-y-6">
              <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] flex items-center gap-3">
                <Zap className="w-4 h-4 text-ninpo-lime" /> Active Transmissions
              </h3>

              <div className="flex gap-6 overflow-x-auto no-scrollbar pb-4">
                {orders
                  .filter(
                    o =>
                      o.status !== OrderStatus.DELIVERED &&
                      o.status !== OrderStatus.REFUNDED
                  )
                  .map(o => (
                    <div
                      key={o.id}
                      className="min-w-[300px] bg-ninpo-midnight p-6 rounded-[2rem] border border-white/5 flex flex-col justify-between shadow-xl"
                    >
                      <div>
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-[9px] font-black text-slate-700 uppercase">
                            NODE: {o.id}
                          </span>
                          <span className="text-[9px] font-black text-ninpo-lime uppercase bg-ninpo-lime/5 px-3 py-1 rounded-full border border-ninpo-lime/20">
                            {o.status}
                          </span>
                        </div>
                        <p className="text-white font-black text-xs uppercase truncate mb-1">
                          {o.address}
                        </p>
                      </div>

                      <div className="mt-6 flex items-center gap-4 text-[9px] font-black uppercase text-slate-500">
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-ninpo-lime shadow-neon transition-all duration-1000"
                            style={{ width: '40%' }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4 px-1">
            {['ALL', 'SAVORY', 'SWEET', 'DRINK', 'HEALTHY', 'USED GEAR'].map(
              cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-10 py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all whitespace-nowrap shadow-xl ${
                    activeCategory === cat
                      ? 'bg-ninpo-lime text-ninpo-black shadow-neon'
                      : 'bg-ninpo-card border border-white/5 text-slate-600 hover:text-white hover:border-white/20'
                  }`}
                >
                  {cat}
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-8">
            {filteredProducts.map(p => (
              <div
                key={p.id}
                className="bg-ninpo-card rounded-[3.5rem] p-6 flex flex-col border border-white/5 shadow-2xl relative group hover:border-ninpo-lime/20 transition-all duration-500"
              >
                <div className="aspect-square rounded-[2.5rem] overflow-hidden mb-6 bg-ninpo-black relative">
                  <img
                    src={p.image || '/placeholder.png'}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '/placeholder.png';
                    }}
                    className={`w-full h-full object-cover grayscale transition-all duration-700 ${
                      p.stock > 0
                        ? 'group-hover:grayscale-0 group-hover:scale-110'
                        : 'opacity-20'
                    }`}
                    alt={p.name}
                  />
                  {p.isGlass && (
                    <div className="absolute top-4 right-4 bg-ninpo-black/60 backdrop-blur-md border border-white/10 p-2 rounded-xl">
                      <Leaf className="w-3 h-3 text-ninpo-lime" />
                    </div>
                  )}
                </div>

                <div className="space-y-2 mb-10 px-1">
                  <h4 className="text-white font-black text-[13px] uppercase group-hover:text-ninpo-lime transition-colors leading-tight">
                    {p.name}
                  </h4>
                  <p className="text-slate-700 font-bold text-[9px] uppercase tracking-widest">
                    {p.category}
                  </p>
                </div>

                <div className="mt-auto flex justify-between items-center px-1">
                  <span className="text-ninpo-lime font-black text-lg tracking-tighter">
                    ${((p.price ?? 0) as number).toFixed(2)}
                  </span>
                  <button
                    onClick={() => addToCart(p.id)}
                    disabled={p.stock === 0}
                    className="w-12 h-12 bg-ninpo-lime rounded-[1.2rem] flex items-center justify-center text-ninpo-black hover:bg-white active:scale-90 transition-all shadow-neon disabled:opacity-5 disabled:grayscale"
                  >
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
              <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                <div className="w-36 h-36 bg-ninpo-black rounded-full border-4 border-white/5 flex items-center justify-center shadow-2xl relative">
                  <Award
                    className={`w-16 h-16 ${
                      currentUser?.tier === UserTier.GOLD
                        ? 'text-yellow-400'
                        : currentUser?.tier === UserTier.SILVER
                        ? 'text-slate-300'
                        : 'text-orange-500'
                    }`}
                  />
                </div>

                <div className="space-y-4 pt-2">
                  <h2 className="text-4xl font-black text-white uppercase tracking-tighter leading-none">
                    {(currentUser as any)?.name ?? (currentUser as any)?.username ?? 'USER'}
                  </h2>

                  <div className="inline-flex items-center gap-3 px-6 py-2.5 rounded-full border border-ninpo-lime/20 bg-ninpo-black/50">
                    <Star className="w-4 h-4 text-ninpo-lime fill-current" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                      {(currentUser as any)?.tier ?? 'BRONZE'} CLEARANCE
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-ninpo-lime/5 p-8 rounded-[3rem] border border-ninpo-lime/20 space-y-6">
                  <div className="flex items-center gap-3">
                    <Coins className="w-5 h-5 text-ninpo-lime" />
                    <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">
                      Loyalty Node
                    </h3>
                  </div>

                  <div className="flex justify-between items-center bg-ninpo-black/80 p-6 rounded-2xl border border-white/5 shadow-xl">
                    <span className="text-white font-black text-3xl tracking-tighter">
                      {safeLoyaltyPoints}
                    </span>

                    <button
                      disabled={!currentUser || safeLoyaltyPoints < 1000}
                      onClick={() => onRedeemPoints(1000)}
                      className="px-6 py-4 bg-ninpo-lime text-ninpo-black rounded-xl text-[10px] font-black uppercase disabled:opacity-20 transition-all active:scale-95 shadow-neon"
                    >
                      Redeem $5
                    </button>
                  </div>
                </div>

                <div className="bg-white/5 p-8 rounded-[3rem] border border-white/5 space-y-6">
                  <div className="flex items-center gap-3">
                    <Leaf className="w-5 h-5 text-ninpo-lime" />
                    <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">
                      Eco Influence
                    </h3>
                  </div>

                  <div className="bg-ninpo-black/80 p-6 rounded-2xl border border-white/5 shadow-xl flex justify-between items-center">
                    <span className="text-white font-black text-3xl tracking-tighter">
                      MI {(safeDailyReturnTotal as number).toFixed(2)}
                    </span>
                    <div className="group relative">
                      <Info className="w-4 h-4 text-slate-700" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-ninpo-card p-10 rounded-[4rem] border border-white/5 flex flex-col justify-center items-center text-center space-y-10 shadow-2xl relative overflow-hidden group">
              <div className="w-24 h-24 bg-ninpo-lime/10 rounded-[2.5rem] flex items-center justify-center border border-ninpo-lime/20 shadow-neon">
                <Coins className="w-12 h-12 text-ninpo-lime" />
              </div>

              <div>
                <h3 className="text-slate-600 font-black uppercase text-[10px] tracking-[0.4em] mb-3">
                  System Credits
                </h3>
                <p className="text-6xl font-black text-white tracking-tighter leading-none">
                  ${(safeCredits as number).toFixed(2)}
                </p>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="px-6 py-3 bg-white/5 text-slate-500 rounded-xl uppercase text-[9px] font-black hover:text-white transition-colors"
              >
                Return to Market
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerView;
