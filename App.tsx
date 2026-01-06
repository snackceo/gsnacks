
import React, { useState, useEffect, useCallback } from 'react';
import { UserRole, User, Product, Order, OrderStatus, AppSettings, LoyaltyReward } from './types';
import { MOCK_USER, MOCK_PRODUCTS, MOCK_REWARDS } from './constants';
import Navbar from './components/Navbar';
import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import LegalFooter from './components/LegalFooter';
import { ShieldCheck, Zap, ShoppingCart, Terminal, X, Crown, Truck, User as UserIcon } from 'lucide-react';

const App: React.FC = () => {
  // Global App State - Default to Customer now
  const [currentUser, setCurrentUser] = useState<User>(MOCK_USER as User);
  const [viewMode, setViewMode] = useState<'market' | 'management'>('market');
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [resetCounter, setResetCounter] = useState(0); 

  const [users] = useState<User[]>([
    { ...MOCK_USER } as User,
    { id: 'custo_002', name: 'Sam Rivera', email: 'sam@customail.com', role: UserRole.CUSTOMER, credits: 10.00, referralCode: 'SAM99', loyaltyPoints: 400, dailyReturnTotal: 0 },
    { id: 'driver_001', name: 'Delivery Dan', email: 'dan@driver.com', role: UserRole.DRIVER, credits: 0, referralCode: 'DAN123', loyaltyPoints: 0, dailyReturnTotal: 0 },
    { id: 'admin_001', name: 'Admin Alice', email: 'alice@admin.com', role: UserRole.ADMIN, credits: 0, referralCode: 'ALICE_A', loyaltyPoints: 0, dailyReturnTotal: 0 },
    { id: 'owner_001', name: 'Executive Eve', email: 'eve@owner.com', role: UserRole.OWNER, credits: 1000.00, referralCode: 'BOSS_ONE', loyaltyPoints: 9999, dailyReturnTotal: 0 }
  ]);
  
  const [settings, setSettings] = useState<AppSettings>({
    deliveryFee: 2.99,
    referralBonus: 5.00,
    michiganDepositValue: 0.10,
    processingFeePercent: 0.20,
    glassHandlingFeePercent: 0.05, 
    dailyReturnLimit: 25.00,
    maintenanceMode: false,
  });

  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);

  const handleRoleSwitch = (role: UserRole) => {
    const newUser = users.find(u => u.role === role) || users[0];
    setCurrentUser(newUser);
    setViewMode(role === UserRole.CUSTOMER ? 'market' : 'management');
    setIsTerminalOpen(false);
    setResetCounter(prev => prev + 1);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.map(order => {
        if (order.status === OrderStatus.OUT_FOR_DELIVERY) {
          return {
            ...order,
            trackingLocation: {
              lat: (order.trackingLocation?.lat || 42.3314) + (Math.random() - 0.5) * 0.001,
              lng: (order.trackingLocation?.lng || -83.0458) + (Math.random() - 0.5) * 0.001,
            }
          };
        }
        return order;
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const addToCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        return prev.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { productId, quantity: 1 }];
    });
  };

  const createOrder = () => {
    if (cart.length === 0) return;
    const total = cart.reduce((sum, item) => {
      const p = products.find(prod => prod.id === item.productId);
      if (!p) return sum;
      let itemTotal = (p.price + p.deposit) * item.quantity;
      if (p.isGlass) {
        const glassFee = p.price * settings.glassHandlingFeePercent * item.quantity;
        itemTotal += glassFee;
      }
      return sum + itemTotal;
    }, settings.deliveryFee);

    const newOrder: Order = {
      id: `ORD-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      customerId: currentUser.id,
      items: [...cart],
      total,
      status: OrderStatus.PENDING,
      createdAt: new Date().toISOString(),
      trackingLocation: { lat: 42.3314, lng: -83.0458 }
    };

    setOrders([newOrder, ...orders]);
    setCart([]);
    alert("Order Received! Our team is processing it now.");
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => {
      const updatedOrders = prev.map(o => o.id === orderId ? { ...o, status } : o);
      if (status === OrderStatus.DELIVERED) {
        const order = updatedOrders.find(o => o.id === orderId);
        if (order) {
          const pointsEarned = Math.floor(order.total * 100);
          adjustUserLoyalty(order.customerId, pointsEarned);
        }
      }
      return updatedOrders;
    });
  };

  const deleteOrder = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  const adjustUserCredits = (userId: string, amount: number) => {
    if (currentUser.id === userId) {
      setCurrentUser(prev => ({ ...prev, credits: Math.max(0, prev.credits + amount) }));
    }
  };

  const adjustUserLoyalty = (userId: string, amount: number) => {
    if (currentUser.id === userId) {
      setCurrentUser(prev => ({ ...prev, loyaltyPoints: prev.loyaltyPoints + amount }));
    }
  };

  const redeemReward = (rewardId: string) => {
    const reward = MOCK_REWARDS.find(r => r.id === rewardId);
    if (!reward || currentUser.loyaltyPoints < reward.cost) {
      alert("Insufficient points for this reward.");
      return;
    }
    adjustUserLoyalty(currentUser.id, -reward.cost);
    if (reward.type === 'CREDIT' && reward.value) {
      adjustUserCredits(currentUser.id, reward.value);
    }
    setCurrentUser(prev => ({
      ...prev,
      redeemedRewards: [...(prev.redeemedRewards || []), rewardId]
    }));
    alert(`Reward Claimed: ${reward.title}! Your balance has been updated.`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 selection:bg-lime-500 selection:text-white">
      <Navbar 
        currentUser={currentUser} 
        setCurrentUser={setCurrentUser} 
        cartCount={cart.length} 
        isDevMode={false}
        setIsDevMode={() => {}}
        onHomeClick={() => setResetCounter(c => c+1)}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onLogout={() => handleRoleSwitch(UserRole.CUSTOMER)}
      />
      
      {settings.maintenanceMode && currentUser.role === UserRole.OWNER && (
        <div className="bg-red-600 text-white text-[10px] font-black uppercase py-2 px-4 text-center tracking-[0.3em] sticky top-16 z-30">
          Maintenance Mode Active • Public Storefront Offline
        </div>
      )}

      <main className="flex-1">
        <div className={`${viewMode === 'market' ? 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8' : ''} py-8`}>
          {viewMode === 'market' ? (
            <CustomerView 
              key={`custo-${resetCounter}`}
              products={products} cart={cart} addToCart={addToCart} createOrder={createOrder}
              orders={orders.filter(o => o.customerId === currentUser.id)}
              user={currentUser} settings={settings} onCreditUpdate={(amt) => adjustUserCredits(currentUser.id, amt)}
              onRedeemReward={redeemReward}
            />
          ) : (
            <ManagementView 
              key={`mgmt-${resetCounter}`}
              user={currentUser} products={products} setProducts={setProducts}
              orders={orders} users={users} settings={settings} setSettings={setSettings}
              updateOrder={updateOrderStatus} deleteOrder={deleteOrder} adjustCredits={adjustUserCredits}
            />
          )}
        </div>
      </main>

      <LegalFooter />

      {/* Floating Terminal Access */}
      <div className="fixed bottom-6 left-6 z-[100]">
        {!isTerminalOpen ? (
          <button 
            onClick={() => setIsTerminalOpen(true)}
            className="w-12 h-12 bg-slate-900/10 hover:bg-slate-900 text-slate-400 hover:text-lime-500 rounded-full flex items-center justify-center transition-all backdrop-blur-sm border border-slate-900/5 group"
            title="Terminal Access"
          >
            <Terminal className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
        ) : (
          <div className="bg-slate-900 rounded-3xl p-6 shadow-2xl border border-white/10 w-64 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Ninpo Terminal</h3>
              <button onClick={() => setIsTerminalOpen(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4"/></button>
            </div>
            <div className="space-y-2">
              <button onClick={() => handleRoleSwitch(UserRole.OWNER)} className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-lime-500 text-white hover:text-slate-900 rounded-xl transition-all group">
                <Crown className="w-4 h-4 text-lime-500 group-hover:text-slate-900" />
                <span className="text-[10px] font-black uppercase tracking-widest">Executive (Owner)</span>
              </button>
              <button onClick={() => handleRoleSwitch(UserRole.DRIVER)} className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white text-white hover:text-slate-900 rounded-xl transition-all group">
                <Truck className="w-4 h-4 text-slate-400 group-hover:text-slate-900" />
                <span className="text-[10px] font-black uppercase tracking-widest">Fleet Agent</span>
              </button>
              <button onClick={() => handleRoleSwitch(UserRole.CUSTOMER)} className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white text-white hover:text-slate-900 rounded-xl transition-all group">
                <UserIcon className="w-4 h-4 text-slate-400 group-hover:text-slate-900" />
                <span className="text-[10px] font-black uppercase tracking-widest">Market Profile</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
