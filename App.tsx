
import React, { useState, useEffect } from 'react';
import { UserRole, User, Product, Order, OrderStatus, AppSettings } from './types';
import { MOCK_USER, MOCK_PRODUCTS } from './constants';
import Navbar from './components/Navbar';
import CustomerView from './views/CustomerView';
import DriverView from './views/DriverView';
import AdminView from './views/AdminView';
import OwnerView from './views/OwnerView';
import { AlertCircle, ShoppingCart, Truck, ShieldCheck, Zap } from 'lucide-react';

const App: React.FC = () => {
  // Global App State
  const [currentUser, setCurrentUser] = useState<User>(MOCK_USER as User);
  const [products] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [users, setUsers] = useState<User[]>([
    { ...MOCK_USER } as User,
    { id: 'custo_002', name: 'Sam Rivera', email: 'sam@customail.com', role: UserRole.CUSTOMER, credits: 10.00, referralCode: 'SAM99', loyaltyPoints: 400, dailyReturnTotal: 0 },
    { id: 'driver_001', name: 'Delivery Dan', email: 'dan@driver.com', role: UserRole.DRIVER, credits: 0, referralCode: 'DAN123', loyaltyPoints: 0, dailyReturnTotal: 0 }
  ]);
  
  const [settings, setSettings] = useState<AppSettings>({
    deliveryFee: 2.99,
    referralBonus: 5.00,
    michiganDepositValue: 0.10,
    processingFeePercent: 0.20,
    glassHandlingFee: 0.15,
    dailyReturnLimit: 25.00,
    maintenanceMode: false,
  });

  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);

  // Simulation: Update driver locations every 5 seconds for orders in transit
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

  // Action: Add to Bag
  const addToCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        return prev.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { productId, quantity: 1 }];
    });
  };

  // Action: Checkout
  const createOrder = () => {
    if (cart.length === 0) return;
    const total = cart.reduce((sum, item) => {
      const p = products.find(prod => prod.id === item.productId);
      return sum + (p ? (p.price + p.deposit) * item.quantity : 0);
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
    alert("Order Received! Our ninjas are on it.");
  };

  // Action: Status Override (Driver/God Mode)
  const updateOrderStatus = (orderId: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
  };

  // Action: Order Purge (God Mode only)
  const deleteOrder = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
  };

  // Action: Credit Adjustment (Global)
  const adjustUserCredits = (userId: string, amount: number) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, credits: Math.max(0, u.credits + amount) } : u));
    if (currentUser.id === userId) {
      setCurrentUser(prev => ({ ...prev, credits: Math.max(0, prev.credits + amount) }));
    }
  };

  // Render Strategy
  const renderView = () => {
    // Lockdown Logic
    if (settings.maintenanceMode && currentUser.role !== UserRole.OWNER) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 animate-in fade-in duration-700">
          <Zap className="w-16 h-16 text-lime-500 mb-6 animate-pulse" />
          <h1 className="text-3xl font-black uppercase tracking-tighter">Ninpo Lockdown</h1>
          <p className="text-slate-500 mt-4 max-w-sm font-bold uppercase text-[10px] tracking-[0.2em]">The system is undergoing ritual maintenance. Expected return in T-minus 20 mins.</p>
        </div>
      );
    }

    switch (currentUser.role) {
      case UserRole.CUSTOMER:
        return <CustomerView 
          products={products} cart={cart} addToCart={addToCart} createOrder={createOrder}
          orders={orders.filter(o => o.customerId === currentUser.id)}
          user={currentUser} settings={settings} onCreditUpdate={(amt) => adjustUserCredits(currentUser.id, amt)}
        />;
      case UserRole.DRIVER:
        return <DriverView 
          orders={orders} updateOrderStatus={updateOrderStatus} user={currentUser}
        />;
      case UserRole.ADMIN:
        return <AdminView 
          products={products} orders={orders} users={users} settings={settings} setSettings={setSettings}
        />;
      case UserRole.OWNER:
        return <OwnerView 
          orders={orders} users={users} settings={settings} setSettings={setSettings}
          currentUser={currentUser} setCurrentUser={setCurrentUser}
          updateOrder={updateOrderStatus} deleteOrder={deleteOrder} adjustCredits={adjustUserCredits}
        />;
      default:
        return <div className="p-10 text-center font-black uppercase text-slate-400">Restricted Sector</div>;
    }
  };

  return (
    <div className="min-h-screen pb-24 md:pb-0 bg-slate-50 selection:bg-lime-500 selection:text-white transition-colors duration-500">
      <Navbar currentUser={currentUser} setCurrentUser={setCurrentUser} cartCount={cart.length} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderView()}
      </main>
      
      {/* Role Switcher - Deployment Utility */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 md:hidden flex justify-around p-3 z-50 shadow-2xl">
        {[
          { role: UserRole.CUSTOMER, icon: ShoppingCart, label: 'CUSTO' },
          { role: UserRole.DRIVER, icon: Truck, label: 'DRIVE' },
          { role: UserRole.OWNER, icon: ShieldCheck, label: 'GOD' }
        ].map(btn => (
          <button 
            key={btn.role}
            onClick={() => setCurrentUser(users.find(u => u.role === btn.role) || { ...currentUser, role: btn.role })} 
            className={`flex flex-col items-center gap-1 transition-all ${currentUser.role === btn.role ? 'text-lime-600 scale-110' : 'text-slate-400'}`}
          >
            <btn.icon className="w-5 h-5" />
            <span className="text-[9px] font-black uppercase tracking-widest">{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
