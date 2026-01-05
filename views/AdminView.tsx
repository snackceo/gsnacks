
import React, { useState } from 'react';
import { Product, Order, AppSettings, OrderStatus } from '../types';
import { LayoutDashboard, Box, Settings, Search, Edit2, Plus } from 'lucide-react';

interface AdminViewProps {
  products: Product[];
  orders: Order[];
  users: any[];
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}

const AdminView: React.FC<AdminViewProps> = ({ products, orders, users, settings, setSettings }) => {
  const [activePanel, setActivePanel] = useState<'inventory' | 'orders' | 'settings'>('inventory');

  return (
    <div className="flex flex-col lg:flex-row gap-10">
      <aside className="lg:w-72 space-y-2">
        <h2 className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Control Center</h2>
        <button 
          onClick={() => setActivePanel('inventory')}
          className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-black transition-all ${activePanel === 'inventory' ? 'bg-lime-500 text-white shadow-xl shadow-lime-100' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          <Box className="w-5 h-5" /> Inventory
        </button>
        <button 
          onClick={() => setActivePanel('orders')}
          className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-black transition-all ${activePanel === 'orders' ? 'bg-lime-500 text-white shadow-xl shadow-lime-100' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          <LayoutDashboard className="w-5 h-5" /> Live Orders
        </button>
        <button 
          onClick={() => setActivePanel('settings')}
          className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-sm font-black transition-all ${activePanel === 'settings' ? 'bg-lime-500 text-white shadow-xl shadow-lime-100' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          <Settings className="w-5 h-5" /> Configuration
        </button>
      </aside>

      <div className="flex-1 space-y-8">
        {activePanel === 'inventory' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black text-slate-900 tracking-tighter">INVENTORY</h2>
              <button className="flex items-center gap-3 px-6 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-lime-500 shadow-xl shadow-slate-200 transition-all">
                <Plus className="w-4 h-4" /> New Product
              </button>
            </div>
            
            <div className="bg-white rounded-[2rem] border shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Product</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Price</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Stock</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {products.map(product => (
                    <tr key={product.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <img src={product.image} className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                          <span className="font-black text-slate-900">{product.name}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-sm font-bold text-slate-600">${product.price.toFixed(2)}</td>
                      <td className="px-8 py-6 text-sm font-bold text-slate-600">{product.stock}</td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${product.stock > 10 ? 'bg-lime-100 text-lime-700' : 'bg-red-100 text-red-700'}`}>
                          {product.stock > 10 ? 'Active' : 'Low Stock'}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <button className="p-3 text-slate-300 hover:text-lime-500 transition-colors bg-slate-50 rounded-xl"><Edit2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activePanel === 'orders' && (
          <div className="space-y-8">
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">ORDER LOG</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {orders.map(order => (
                <div key={order.id} className="bg-white p-8 rounded-[2rem] border shadow-sm hover:border-lime-200 hover:shadow-xl transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black text-lime-600 uppercase tracking-widest">{order.id}</span>
                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                      order.status === OrderStatus.PENDING ? 'bg-amber-100 text-amber-700' : 'bg-lime-100 text-lime-700'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <p className="text-lg font-black text-slate-900">{order.items.length} Items • ${order.total.toFixed(2)}</p>
                  <p className="text-xs font-bold text-slate-400 mt-2 uppercase tracking-widest">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activePanel === 'settings' && (
          <div className="space-y-8">
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">GLOBAL CONFIG</h2>
            <div className="bg-white p-10 rounded-[2.5rem] border shadow-sm space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Delivery Surcharge ($)</label>
                  <input 
                    type="number" 
                    value={settings.deliveryFee} 
                    onChange={(e) => setSettings({...settings, deliveryFee: parseFloat(e.target.value)})}
                    className="w-full px-5 py-4 bg-slate-50 border-0 rounded-2xl focus:ring-2 focus:ring-lime-500 outline-none font-bold" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">MI Return Proc. Fee (%)</label>
                  <input 
                    type="number" 
                    value={settings.processingFeePercent * 100} 
                    onChange={(e) => setSettings({...settings, processingFeePercent: parseFloat(e.target.value)/100})}
                    className="w-full px-5 py-4 bg-slate-50 border-0 rounded-2xl focus:ring-2 focus:ring-lime-500 outline-none font-bold" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                 <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Glass Handling Fee ($)</label>
                  <input 
                    type="number" 
                    value={settings.glassHandlingFee} 
                    onChange={(e) => setSettings({...settings, glassHandlingFee: parseFloat(e.target.value)})}
                    className="w-full px-5 py-4 bg-slate-50 border-0 rounded-2xl focus:ring-2 focus:ring-lime-500 outline-none font-bold" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Daily Return Limit ($)</label>
                  <input 
                    type="number" 
                    value={settings.dailyReturnLimit} 
                    onChange={(e) => setSettings({...settings, dailyReturnLimit: parseFloat(e.target.value)})}
                    className="w-full px-5 py-4 bg-slate-50 border-0 rounded-2xl focus:ring-2 focus:ring-lime-500 outline-none font-bold" 
                  />
                </div>
              </div>
              <div className="flex items-center justify-between p-6 bg-red-50 rounded-3xl border border-red-100">
                <div>
                  <h4 className="font-black text-red-800 uppercase text-xs tracking-widest">Emergency Lockdown</h4>
                  <p className="text-[10px] text-red-600 font-bold mt-1">Suspend all custo services immediately.</p>
                </div>
                <button 
                  onClick={() => setSettings({...settings, maintenanceMode: !settings.maintenanceMode})}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${settings.maintenanceMode ? 'bg-red-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${settings.maintenanceMode ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminView;
