import React, { useState, useEffect } from 'react';
import { Product, Order, OrderStatus, User, UserTier } from '../types';
import { Plus, Search, Award, Settings, Leaf, Star, Coins, Zap, Info } from 'lucide-react';

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
  onRequestRefund,
  updateUserProfile,
  reorderItems,
  onRedeemPoints,
}) => {
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDashboard, setShowDashboard] = useState(false);


  // Lifetime bottle returns state
  const [lifetimeBottleReturns, setLifetimeBottleReturns] = useState<number | null>(null);
  const [bottleReturnsLoading, setBottleReturnsLoading] = useState(false);
  const [bottleReturnsError, setBottleReturnsError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBottleReturns = async () => {
      if (!currentUser) return;
      setBottleReturnsLoading(true);
      setBottleReturnsError(null);
      try {
        const res = await fetch(`/server/users/${currentUser.id}/bottle-returns`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setLifetimeBottleReturns(data.lifetimeBottleReturns ?? 0);
      } catch (err: any) {
        setBottleReturnsError('Could not load bottle returns');
        setLifetimeBottleReturns(null);
      } finally {
        setBottleReturnsLoading(false);
      }
    };
    fetchBottleReturns();
  }, [currentUser]);

  // Filtering and derived values
  const filteredProducts = products.filter(
    p =>
      (activeCategory === 'ALL' ||
        p.category.toUpperCase() === activeCategory) &&
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Safe numeric defaults
  const safeCredits = currentUser?.creditBalance ?? 0;
  const safeLoyaltyPoints = currentUser?.loyaltyPoints ?? 0;
  const tierLabel = (currentUser?.membershipTier ?? UserTier.COMMON).toString().toUpperCase();

  // Checklist progress logic
  const ordersCompleted = (currentUser as any)?.ordersCompleted ?? 0;
  const bottlesReturned = lifetimeBottleReturns ?? 0;
  const loyaltyPoints = currentUser?.loyaltyPoints ?? 0;
  const userTier = (currentUser?.membershipTier ?? UserTier.COMMON).toString().toUpperCase();

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col xl:flex-row gap-8 items-center justify-between">
        <div className="relative flex-1 w-full lg:max-w-2xl">
          <input
            id="productSearch"
            name="productSearch"
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
              onClick={() => setShowDashboard(!showDashboard)}
              className="px-8 py-5 bg-ninpo-card border border-white/5 rounded-[1.5rem] text-white font-black text-[12px] uppercase tracking-widest flex items-center gap-3 hover:border-ninpo-lime/40 transition-all shadow-lg active:scale-95"
            >
              <Settings className="w-5 h-5 text-slate-600" /> Dashboard
            </button>
          )}
        </div>
      </div>
      {!showDashboard ? (
        <>
          {/* Main product/market view */}
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
                  {p.nutritionNote && (
                    <div
                      className="absolute top-4 left-4 bg-ninpo-black/60 backdrop-blur-md border border-white/10 p-2 rounded-xl"
                      title={p.nutritionNote}
                    >
                      <Info className="w-3 h-3 text-ninpo-lime" />
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
        </>
      ) : (
        <>
          {/* Dashboard view */}
          <div className="max-w-6xl mx-auto space-y-12 animate-in slide-in-bottom">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Order History Section */}
              <div className="bg-ninpo-lime/5 p-8 rounded-[3rem] border border-ninpo-lime/20 space-y-6 flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 mb-2">
                  <Coins className="w-5 h-5 text-ninpo-lime" />
                  <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">
                    Order History
                  </h3>
                </div>
                <div className="bg-ninpo-black/80 p-4 rounded-2xl border border-white/5 shadow-xl w-full max-h-56 overflow-y-auto min-h-[56px]">
                  {orders === undefined ? (
                    <span className="text-slate-500 text-lg">Loading...</span>
                  ) : null}
                  {orders && orders.length === 0 && (
                    <span className="text-slate-500 text-sm">No orders found.</span>
                  )}
                  {orders && orders.length > 0 && (
                    <ul className="divide-y divide-ninpo-lime/10">
                      {orders
                        .filter(o =>
                          [OrderStatus.DELIVERED, OrderStatus.REFUNDED, OrderStatus.CLOSED].includes(o.status)
                        )
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .slice(0, 10)
                        .map(o => (
                          <li key={o.id} className="py-2 flex flex-col gap-1">
                            <span className="text-white text-xs font-bold">
                              {o.address || 'No address'}
                            </span>
                            <span className="text-slate-500 text-[10px]">
                              {new Date(o.createdAt).toLocaleDateString()} &bull; ${o.total?.toFixed(2) ?? '0.00'}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <p className="text-slate-500 text-xs mt-2 text-center">
                  Most recent completed, refunded, or closed orders.
                </p>
              </div>

              {/* Lifetime Bottle Returns Section */}
              <div className="bg-ninpo-lime/5 p-8 rounded-[3rem] border border-ninpo-lime/20 space-y-6 flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 mb-2">
                  <Leaf className="w-5 h-5 text-ninpo-lime" />
                  <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">
                    Bottle Returns (Lifetime)
                  </h3>
                </div>
                <div className="bg-ninpo-black/80 p-6 rounded-2xl border border-white/5 shadow-xl flex justify-center items-center w-full min-h-[56px]">
                  {bottleReturnsLoading ? (
                    <span className="text-slate-500 text-lg">Loading...</span>
                  ) : bottleReturnsError ? (
                    <span className="text-red-500 text-sm">{bottleReturnsError}</span>
                  ) : (
                    <span className="text-white font-black text-3xl tracking-tighter">
                      {lifetimeBottleReturns ?? 0}
                    </span>
                  )}
                </div>
                <p className="text-slate-500 text-xs mt-2 text-center">
                  Total containers returned and verified for deposit credit. Updated after each completed return.
                </p>
              </div>
              {/* Tier Progress Checklist Section */}
              <div className="bg-ninpo-lime/5 p-8 rounded-[3rem] border border-ninpo-lime/20 space-y-6 flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 mb-2">
                  <Star className="w-5 h-5 text-ninpo-lime" />
                  <h3 className="text-white font-black uppercase text-[10px] tracking-[0.2em]">
                    Tier Progress Checklist
                  </h3>
                </div>
                <ul className="space-y-2 text-white text-sm w-full">
                  <li className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${ordersCompleted > 0 ? 'bg-ninpo-lime border-ninpo-lime' : 'border-slate-700'}`}>
                      {ordersCompleted > 0 && <span className="block w-2 h-2 bg-white rounded-full" />}
                    </span>
                    Complete your first order
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${bottlesReturned >= 10 ? 'bg-ninpo-lime border-ninpo-lime' : 'border-slate-700'}`}>
                      {bottlesReturned >= 10 && <span className="block w-2 h-2 bg-white rounded-full" />}
                    </span>
                    Return 10 bottles
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${loyaltyPoints >= 100 ? 'bg-ninpo-lime border-ninpo-lime' : 'border-slate-700'}`}>
                      {loyaltyPoints >= 100 && <span className="block w-2 h-2 bg-white rounded-full" />}
                    </span>
                    Earn 100 loyalty points
                  </li>
                  <li className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${userTier === 'SILVER' || userTier === 'GOLD' || userTier === 'PLATINUM' ? 'bg-ninpo-lime border-ninpo-lime' : 'border-slate-700'}`}>
                      {(userTier === 'SILVER' || userTier === 'GOLD' || userTier === 'PLATINUM') && <span className="block w-2 h-2 bg-white rounded-full" />}
                    </span>
                    Reach Silver tier
                  </li>
                  <li className="flex items-center gap-2 opacity-60">• ...more coming soon</li>
                </ul>
                <p className="text-slate-500 text-xs mt-2 text-center">
                  Track your progress toward higher membership tiers and rewards.
                </p>
              </div>
              {/* Credit Wallet & Loyalty Points Section */}
              <div className="bg-ninpo-card p-10 rounded-[3rem] border border-white/5 flex flex-col justify-center items-center text-center space-y-8 shadow-2xl relative overflow-hidden group">
                <div className="w-20 h-20 bg-ninpo-lime/10 rounded-[2rem] flex items-center justify-center border border-ninpo-lime/20 shadow-neon mb-2">
                  <Coins className="w-10 h-10 text-ninpo-lime" />
                </div>
                <div>
                  <h3 className="text-slate-600 font-black uppercase text-[10px] tracking-[0.4em] mb-2">
                    Your Credits
                  </h3>
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mb-2">
                    Credits are earned from verified container returns and promotions.
                  </p>
                  <p className="text-4xl font-black text-white tracking-tighter leading-none">
                    ${safeCredits.toFixed(2)}
                  </p>
                  <p className="mt-2 text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                    Credits never expire; Silver+ can cover route and distance fees, and Gold+ may request cash payouts.
                  </p>
                </div>
                <div className="mt-4">
                  <h3 className="text-slate-600 font-black uppercase text-[10px] tracking-[0.4em] mb-2">
                    Loyalty Points
                  </h3>
                  <p className="text-3xl font-black text-ninpo-lime tracking-tighter leading-none">
                    {safeLoyaltyPoints}
                  </p>
                </div>
              </div>
              {/* Add more dashboard sections here, one at a time */}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CustomerView;
