
import React, { useState, useEffect } from 'react';
import { UserRole, User, Product, Order, OrderStatus, AppSettings } from './types';
import { MOCK_USER, MOCK_PRODUCTS } from './constants';
import CustomerView from './views/CustomerView';
import ManagementView from './views/ManagementView';
import LoginView from './views/LoginView';
import LegalFooter from './components/LegalFooter';
import { FileText, Clock, ShoppingCart, RotateCcw, XCircle } from 'lucide-react';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('ninpo_user');
    return saved ? JSON.parse(saved) : null;
  });
  
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('ninpo_all_users');
    if (saved) return JSON.parse(saved);
    // Default system users
    return [
      { id: 'custo_001', name: 'Alex Johnson', email: 'alex@customail.com', role: UserRole.CUSTOMER, credits: 24.50, referralCode: 'CUSTO77', loyaltyPoints: 1250, dailyReturnTotal: 0 },
      { id: 'owner_001', name: 'Executive Admin', email: 'eve@owner.com', role: UserRole.OWNER, credits: 1000.00, referralCode: 'BOSS_ONE', loyaltyPoints: 9999, dailyReturnTotal: 0 }
    ];
  });

  const [viewMode, setViewMode] = useState<'market' | 'management' | 'history'>('market');
  const [isLoginViewOpen, setIsLoginViewOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('ninpo_orders');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(() => {
    const saved = localStorage.getItem('ninpo_cart');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('ninpo_settings');
    return saved ? JSON.parse(saved) : {
      deliveryFee: 2.99,
      referralBonus: 5.00,
      michiganDepositValue: 0.10,
      processingFeePercent: 0.20,
      glassHandlingFeePercent: 0.05, 
      dailyReturnLimit: 25.00,
      maintenanceMode: false,
    };
  });

  // Persistence logic
  useEffect(() => {
    localStorage.setItem('ninpo_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('ninpo_orders', JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem('ninpo_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('ninpo_all_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('ninpo_user', JSON.stringify(currentUser));
      // Sync currentUser changes back to the main users list
      setUsers(prev => prev.map(u => u.id === currentUser.id ? currentUser : u));
    } else {
      localStorage.removeItem('ninpo_user');
    }
  }, [currentUser]);

  const handleLogin = (user: User) => {
    // Ensure user exists in our local database
    setUsers(prev => {
      if (!prev.find(u => u.id === user.id)) return [...prev, user];
      return prev;
    });
    setCurrentUser(user);
    setIsLoginViewOpen(false);
    setViewMode(user.role === UserRole.OWNER || user.role === UserRole.ADMIN ? 'management' : 'market');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setViewMode('market');
    setCart([]);
  };

  const goHome = () => {
    setIsLoginViewOpen(false);
    setViewMode('market');
  };

  const toggleAuth = () => {
    if (currentUser) {
      handleLogout();
    } else {
      setIsLoginViewOpen(true);
    }
  };

  const handleCreateOrder = (newOrder: Order) => {
    setOrders(prev => [newOrder, ...prev]);
    setCart([]);
    
    // Update stock levels
    setProducts(prevProducts => {
      return prevProducts.map(p => {
        const cartItem = newOrder.items.find(item => item.productId === p.id);
        if (cartItem) {
          return { ...p, stock: Math.max(0, p.stock - cartItem.quantity) };
        }
        return p;
      });
    });

    // Award Loyalty Points: 10 points per $1 spent
    if (currentUser) {
      const pointsEarned = Math.floor(newOrder.total * 10);
      const updatedUser = {
        ...currentUser,
        loyaltyPoints: currentUser.loyaltyPoints + pointsEarned
      };
      setCurrentUser(updatedUser);
    }
  };

  const handleCreditUpdate = (amount: number) => {
    if (!currentUser) return;
    const updatedUser = {
      ...currentUser,
      credits: currentUser.credits + amount,
      dailyReturnTotal: currentUser.dailyReturnTotal + Math.abs(amount)
    };
    setCurrentUser(updatedUser);
  };

  const handleAdjustCredits = (userId: string, amount: number) => {
    if (currentUser && currentUser.id === userId) {
      handleCreditUpdate(amount);
    } else {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, credits: u.credits + amount } : u));
    }
  };

  const handleCancelOrder = (orderId: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: OrderStatus.CANCELLED } : o));
    alert("Order cancelled.");
  };

  const handleReorder = (order: Order) => {
    setCart(order.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
    setViewMode('market');
    alert("Items added to cart from previous order.");
  };

  const handleDeleteOrder = (id: string) => {
    if (window.confirm("Delete this order record permanently?")) {
      setOrders(prev => prev.filter(o => o.id !== id));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-ninpo-black font-sans selection:bg-ninpo-lime selection:text-ninpo-black text-white">
      <header className="w-full pt-6 px-4 sm:px-6 lg:px-8">
        <div className="container mx-auto">
          <div className="bg-ninpo-midnight rounded-[2rem] p-6 lg:p-8 border border-white/5 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-2xl">
            <button 
              onClick={goHome}
              className="flex items-center gap-4 lg:gap-6 hover:opacity-80 transition-opacity text-left active:scale-95 duration-200"
            >
              <div className="w-16 h-16 lg:w-20 lg:h-20 bg-ninpo-lime rounded-2xl flex items-center justify-center neon-glow flex-shrink-0">
                <span className="text-ninpo-black font-black text-4xl lg:text-5xl">N</span>
              </div>
              <div>
                <h1 className="text-white text-3xl lg:text-4xl font-black leading-none tracking-tight uppercase">Ninpo</h1>
                <h1 className="text-ninpo-lime text-3xl lg:text-4xl font-black leading-none tracking-tight uppercase">Snacks</h1>
              </div>
            </button>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex items-stretch gap-4">
              <div className="bg-ninpo-grey rounded-xl p-4 flex flex-col items-center justify-center text-center lg:min-w-[160px]">
                <span className="text-[10px] font-black text-ninpo-lime uppercase tracking-widest mb-1">
                  {currentUser ? 'Balance' : 'Session'}
                </span>
                <span className="text-white font-black text-[11px] uppercase truncate w-full">
                  {currentUser ? `$${currentUser.credits.toFixed(2)}` : 'Guest'}
                </span>
              </div>
              
              <button 
                onClick={toggleAuth}
                className={`text-white rounded-xl font-black text-sm uppercase tracking-widest hover:brightness-110 transition-all active:scale-95 flex items-center justify-center py-4 lg:px-12 ${currentUser ? 'bg-ninpo-grey border border-white/10' : 'bg-ninpo-red'}`}
              >
                {currentUser ? 'Logout' : 'Login'}
              </button>

              <button 
                onClick={() => setViewMode(viewMode === 'history' ? 'market' : 'history')}
                className={`hidden sm:flex rounded-xl p-4 flex-col items-center justify-center text-center lg:min-w-[120px] transition-all border ${viewMode === 'history' ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime' : 'bg-ninpo-grey text-white border-white/5'}`}
              >
                <Clock className={`w-5 h-5 mb-1 ${viewMode === 'history' ? 'text-ninpo-black' : 'text-slate-400'}`} />
                <span className="font-black text-[11px] uppercase">History</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8">
        <div className="container mx-auto">
          {viewMode === 'market' ? (
            <CustomerView 
              products={products} 
              cart={cart} 
              addToCart={(id) => setCart(prev => {
                const existing = prev.find(i => i.productId === id);
                if (existing) {
                  return prev.map(i => i.productId === id ? { ...i, quantity: i.quantity + 1 } : i);
                }
                return [...prev, { productId: id, quantity: 1 }];
              })}
              removeFromCart={(id) => setCart(prev => prev.filter(i => i.productId !== id))}
              updateCartQuantity={(id, q) => setCart(prev => prev.map(i => i.productId === id ? { ...i, quantity: Math.max(1, q) } : i))}
              createOrder={handleCreateOrder}
              orders={orders.filter(o => o.customerId === (currentUser?.id || 'custo_001'))}
              user={currentUser || (MOCK_USER as User)} 
              settings={settings} 
              onCreditUpdate={handleCreditUpdate}
            />
          ) : viewMode === 'history' ? (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-bottom">
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Your Orders</h2>
                <button onClick={() => setViewMode('market')} className="text-xs font-black text-ninpo-lime uppercase tracking-widest hover:underline flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> Back to Market
                </button>
              </div>
              {orders.filter(o => o.customerId === (currentUser?.id || 'custo_001')).length === 0 ? (
                <div className="py-20 text-center bg-ninpo-midnight rounded-[3rem] border border-white/5">
                  <FileText className="w-16 h-16 text-slate-800 mx-auto mb-4" />
                  <p className="text-slate-500 font-bold uppercase tracking-widest">No past orders found.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {orders.filter(o => o.customerId === (currentUser?.id || 'custo_001')).map(order => (
                    <div key={order.id} className="bg-ninpo-midnight p-8 rounded-[2rem] border border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{order.id}</p>
                        <h4 className="text-white font-bold uppercase text-lg">{order.address}</h4>
                        <p className="text-slate-400 text-xs mt-1">{new Date(order.createdAt).toLocaleDateString()} • {order.items.length} items</p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-3">
                        <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${order.status === OrderStatus.DELIVERED ? 'bg-ninpo-lime/10 text-ninpo-lime' : order.status === OrderStatus.CANCELLED ? 'bg-ninpo-red/10 text-ninpo-red' : 'bg-amber-400/10 text-amber-400'}`}>
                          {order.status.replace(/_/g, ' ')}
                        </span>
                        <p className="text-white font-black text-xl">${order.total.toFixed(2)}</p>
                        <div className="flex gap-4">
                          {order.status === OrderStatus.PENDING && (
                            <button onClick={() => handleCancelOrder(order.id)} className="text-ninpo-red text-[10px] font-black uppercase tracking-widest flex items-center gap-1 hover:opacity-50"><XCircle className="w-4 h-4" /> Cancel</button>
                          )}
                          <button onClick={() => handleReorder(order)} className="text-ninpo-lime text-[10px] font-black uppercase tracking-widest flex items-center gap-1 hover:opacity-50"><RotateCcw className="w-4 h-4" /> Reorder</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ManagementView 
              user={currentUser as User} 
              products={products} 
              setProducts={setProducts}
              orders={orders} 
              users={users} 
              settings={settings} 
              setSettings={setSettings}
              updateOrder={(id, status) => {
                setOrders(prev => prev.map(o => o.id === id ? {...o, status} : o));
              }} 
              deleteOrder={handleDeleteOrder} 
              adjustCredits={handleAdjustCredits}
            />
          )}
        </div>
      </main>

      <LegalFooter />

      {isLoginViewOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ninpo-black/95 backdrop-blur-2xl" onClick={goHome} />
          <LoginView users={users} onLogin={handleLogin} onCancel={goHome} />
        </div>
      )}

      <footer className="w-full bg-ninpo-black/90 backdrop-blur-md border-t border-white/5 p-6 lg:p-10 z-40">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.4em] text-center md:text-left">
            © 2025 Ninpo Snacks LLC • Detroit Area
          </p>
          <div className="flex gap-8">
            <span className="text-[9px] font-black text-slate-700 uppercase tracking-widest">v1.4.2 (Stable)</span>
            <span className="text-[9px] font-black text-ninpo-lime uppercase tracking-widest">AI Core Online</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
