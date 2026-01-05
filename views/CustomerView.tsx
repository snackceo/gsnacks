
import React, { useState } from 'react';
import { Product, Order, User, AppSettings } from '../types';
import { Package, Recycle, History, Star, ShoppingBag, CreditCard, MessageCircle, X, Send, Zap, Clock, ChevronRight } from 'lucide-react';
import { getAgentSupportResponse } from '../services/geminiService';

interface CustomerViewProps {
  products: Product[];
  cart: { productId: string; quantity: number }[];
  addToCart: (id: string) => void;
  createOrder: () => void;
  orders: Order[];
  user: User;
  settings: AppSettings;
  onCreditUpdate: (amount: number) => void;
}

const CustomerView: React.FC<CustomerViewProps> = ({ products, cart, addToCart, createOrder, orders, user, settings, onCreditUpdate }) => {
  const [activeTab, setActiveTab] = useState<'shop' | 'orders' | 'loyalty'>('shop');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    {role: 'bot', text: 'Welcome to the Ninpo Dojo! How can I assist with your snacks or bottle returns today?'}
  ]);

  const cartItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const cartTotal = cart.reduce((acc, item) => {
    const p = products.find(prod => prod.id === item.productId);
    return acc + (p ? (p.price + p.deposit) * item.quantity : 0);
  }, 0);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages(prev => [...prev, {role: 'user', text: userMsg}]);
    setChatInput("");
    const response = await getAgentSupportResponse(userMsg, user);
    setChatMessages(prev => [...prev, {role: 'bot', text: response || ''}]);
  };

  const handleStartScan = () => {
    alert("Activating Ninpo Scanner... Please grant camera permissions in the metadata settings if prompt appears.");
  };

  return (
    <div className="space-y-8 relative animate-in fade-in duration-500">
      {/* Custo Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-3xl border shadow-sm flex items-center justify-between group hover:border-lime-500/50 transition-all">
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">NINPO BALANCE</p>
            <h3 className="text-3xl font-black text-lime-600">${user.credits.toFixed(2)}</h3>
          </div>
          <div className="bg-lime-50 p-3 rounded-2xl group-hover:scale-110 transition-transform"><CreditCard className="text-lime-600 w-6 h-6" /></div>
        </div>
        <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl flex items-center justify-between cursor-pointer group hover:bg-slate-800 transition-all" onClick={handleStartScan}>
          <div>
            <p className="text-lime-500 text-[10px] font-black uppercase tracking-widest">MI BOTTLE SCANNER</p>
            <h3 className="text-3xl font-black text-white flex items-center gap-2">
              RECYCLE <Zap className="w-5 h-5 text-lime-500 fill-lime-500 animate-pulse" />
            </h3>
          </div>
          <div className="bg-lime-500 p-3 rounded-2xl shadow-lg shadow-lime-500/20"><Recycle className="text-slate-900 w-6 h-6" /></div>
        </div>
        <div className="bg-white p-6 rounded-3xl border shadow-sm flex items-center justify-between group hover:border-amber-500/50 transition-all">
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">LOYALTY XP</p>
            <h3 className="text-3xl font-black text-slate-800">{user.loyaltyPoints}</h3>
          </div>
          <div className="bg-amber-50 p-3 rounded-2xl group-hover:scale-110 transition-transform"><Star className="text-amber-500 w-6 h-6" /></div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex space-x-2 bg-slate-100 p-1.5 rounded-2xl w-full max-w-md border border-slate-200">
        {(['shop', 'orders', 'loyalty'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab ? 'bg-white text-lime-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'shop' && (
        <div className="space-y-6">
          <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
            <Package className="text-lime-500" />
            NINPO INVENTORY
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map(product => (
              <div key={product.id} className="bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col hover:shadow-xl transition-all group hover:-translate-y-1">
                <div className="aspect-square w-full mb-5 overflow-hidden rounded-[2rem] shadow-md relative">
                  <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  {product.deposit > 0 && (
                    <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur-md text-lime-500 text-[8px] font-black px-3 py-1.5 rounded-full border border-white/10 uppercase tracking-widest">
                      MI DEP
                    </div>
                  )}
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="font-black text-slate-900 leading-tight uppercase text-sm tracking-tight">{product.name}</h4>
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
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="max-w-3xl space-y-5 animate-in slide-in-from-left-2">
          <h2 className="text-2xl font-black flex items-center gap-3 uppercase tracking-tighter text-slate-900">
            <History className="text-lime-500" /> PAST MISSIONS
          </h2>
          {orders.length === 0 ? (
             <div className="p-16 text-center bg-white rounded-[2.5rem] border border-dashed border-slate-200">
                <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest italic">No previous operations detected...</p>
             </div>
          ) : orders.map(order => (
            <div key={order.id} className="bg-white p-8 rounded-[2.5rem] border shadow-sm group hover:border-lime-500/30 transition-all">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">{order.id}</span>
                  <h4 className="font-black text-slate-900 text-lg mt-1 uppercase tracking-tight">{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</h4>
                </div>
                <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm ${
                  order.status === 'DELIVERED' ? 'bg-lime-500 text-white' : 'bg-slate-900 text-white'
                }`}>
                  {order.status}
                </span>
              </div>
              <div className="flex justify-between items-center pt-5 border-t border-slate-50">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{order.items.length} ITEMS DEPLOYED</p>
                <p className="text-xl font-black text-lime-600">${order.total.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating UI Components */}
      
      {/* 1. Floating Cart Action Button */}
      <button 
        onClick={() => setIsCartOpen(true)}
        className="fixed bottom-24 left-6 md:bottom-8 md:left-auto md:right-32 z-50 w-16 h-16 bg-lime-500 text-slate-900 rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all border-4 border-white neon-glow"
      >
        <ShoppingBag className="w-7 h-7" />
        {cartItemCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-slate-900 text-white text-[10px] font-black w-7 h-7 rounded-full flex items-center justify-center border-2 border-white animate-in zoom-in">
            {cartItemCount}
          </span>
        )}
      </button>

      {/* 2. Floating Cart Drawer Overlay */}
      {isCartOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in" onClick={() => setIsCartOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-500">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                  <ShoppingBag className="text-lime-500" />
                  YOUR BAG
                </h3>
                <p className="text-[10px] font-black text-lime-400 uppercase tracking-[0.2em] mt-1">Operational Summary</p>
              </div>
              <button onClick={() => setIsCartOpen(false)} className="p-3 bg-white/10 hover:bg-white/20 rounded-2xl transition-all"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 border-dashed">
                    <ShoppingBag className="text-slate-300 w-10 h-10" />
                  </div>
                  <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest">No gear assigned yet...</p>
                </div>
              ) : (
                <>
                  {cart.map(item => {
                    const p = products.find(prod => prod.id === item.productId);
                    return (
                      <div key={item.productId} className="flex justify-between items-center group animate-in slide-in-from-right-4">
                        <div className="flex items-center gap-4">
                           <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm border border-slate-100">
                             <img src={p?.image} className="w-full h-full object-cover" />
                           </div>
                           <div>
                             <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">{p?.name}</h4>
                             <p className="text-[10px] font-bold text-slate-400">UNIT: ${(p?.price || 0).toFixed(2)}</p>
                           </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-slate-900">${((p?.price || 0) + (p?.deposit || 0) * item.quantity).toFixed(2)}</p>
                          <p className="text-[10px] font-black text-lime-600 uppercase">x{item.quantity}</p>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-8 bg-slate-50 border-t border-slate-200 space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Tactical Items</span>
                    <span className="text-slate-900">${cartTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Ninja Delivery</span>
                    <span className="text-slate-900">${settings.deliveryFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-end pt-4 border-t border-slate-200">
                    <span className="text-xl font-black text-slate-900 uppercase tracking-tighter">TOTAL DEP</span>
                    <span className="text-3xl font-black text-lime-600">${(cartTotal + settings.deliveryFee).toFixed(2)}</span>
                  </div>
                </div>
                <button 
                  onClick={() => { createOrder(); setIsCartOpen(false); }}
                  className="w-full bg-slate-900 text-white py-6 rounded-3xl font-black text-xs hover:bg-lime-500 hover:text-slate-900 shadow-2xl shadow-slate-200 transition-all uppercase tracking-[0.2em] flex items-center justify-center gap-3"
                >
                  Initiate Drop <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Support Chat Component */}
      <div className="fixed bottom-24 right-6 md:bottom-8 md:right-8 z-50">
        {!isChatOpen ? (
          <button 
            onClick={() => setIsChatOpen(true)}
            className="w-16 h-16 bg-slate-900 text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all border-4 border-white neon-glow"
          >
            <MessageCircle className="w-7 h-7 text-lime-500" />
          </button>
        ) : (
          <div className="bg-white w-96 rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col animate-in slide-in-from-bottom-6">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-lime-500 flex items-center justify-center font-black text-slate-900 border-2 border-slate-800">NS</div>
                <div>
                  <span className="font-black text-sm tracking-tight block uppercase">Ninja Support</span>
                  <span className="text-[9px] text-lime-400 font-black uppercase tracking-[0.2em]">Operational</span>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="h-80 p-6 overflow-y-auto space-y-5 bg-slate-50">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-5 py-3 rounded-2xl text-[11px] font-bold leading-relaxed shadow-sm ${
                    msg.role === 'user' ? 'bg-lime-500 text-white rounded-tr-none' : 'bg-white text-slate-700 border rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 bg-white border-t border-slate-100 flex gap-3">
              <input 
                type="text" 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask your Sensei..." 
                className="flex-1 text-xs font-bold border-slate-200 border-2 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-lime-500/10 focus:border-lime-500 transition-all"
              />
              <button onClick={handleSendMessage} className="bg-slate-900 text-white p-4 rounded-2xl hover:bg-lime-500 hover:text-slate-900 transition-all shadow-xl">
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default CustomerView;
