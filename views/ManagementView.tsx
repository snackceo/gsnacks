
import React, { useState } from 'react';
import { User, Product, Order, OrderStatus, AppSettings, ApprovalRequest, AuditLog, UserRole, UserTier } from '../types';
import { 
  Truck, Package, Users, Settings, BarChart3, ShieldCheck, 
  CheckCircle2, XCircle, FileText, BrainCircuit, Loader2, Plus, Trash2, Edit3, Save, Lock, Unlock, UserCircle,
  Wallet, Activity, Terminal, Database, Sliders, AlertTriangle, ShieldAlert
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getAdvancedInventoryInsights } from '../services/geminiService';

interface ManagementViewProps {
  user: User;
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  orders: Order[];
  users: User[];
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  approvals: ApprovalRequest[];
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  auditLogs: AuditLog[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
  adjustCredits: (userId: string, amount: number, reason: string) => void;
  updateUserProfile: (id: string, updates: Partial<User>) => void;
}

const ManagementView: React.FC<ManagementViewProps> = ({ 
  products, setProducts, orders, users, settings, setSettings, approvals, setApprovals, auditLogs, updateOrder, adjustCredits, updateUserProfile
}) => {
  const [activeModule, setActiveModule] = useState<string>('analytics');
  const [isAuditing, setIsAuditing] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);

  const chartData = orders.slice(0, 15).map(o => ({
    name: o.id.slice(-4),
    revenue: o.total
  })).reverse();

  const handleApprove = (approval: ApprovalRequest) => {
    adjustCredits(approval.userId, approval.amount, `AUTH: ${approval.type}`);
    setApprovals(prev => prev.map(a => a.id === approval.id ? {...a, status: 'APPROVED', processedAt: new Date().toISOString()} : a));
    if (approval.type === 'REFUND' && approval.orderId) {
      updateOrder(approval.orderId, OrderStatus.REFUNDED);
    }
  };

  const handleRestock = (pid: string) => {
    setProducts(prev => prev.map(p => p.id === pid ? {...p, stock: p.stock + 10} : p));
  };

  return (
    <div className="flex flex-col xl:flex-row gap-12 animate-in fade-in pb-32">
      <aside className="w-full xl:w-72 space-y-2">
        {[
          {id: 'analytics', label: 'Dashboard', icon: BarChart3},
          {id: 'orders', label: 'Queue', icon: Truck},
          {id: 'approvals', label: 'Auth Hub', icon: ShieldCheck},
          {id: 'inventory', label: 'Inventory', icon: Package},
          {id: 'users', label: 'User Base', icon: Users},
          {id: 'logs', label: 'Audit Logs', icon: Terminal},
          {id: 'settings', label: 'Global Node', icon: Sliders}
        ].map(m => (
          <button 
            key={m.id} 
            onClick={() => setActiveModule(m.id)} 
            className={`w-full text-left p-5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-4 ${activeModule === m.id ? 'bg-ninpo-lime text-ninpo-black shadow-neon' : 'hover:bg-white/5 text-slate-500'}`}
          >
            <m.icon className="w-5 h-5" /> {m.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 space-y-8">
        {activeModule === 'analytics' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Net Revenue</p>
                <p className="text-3xl font-black text-white">${orders.reduce((s,o) => s+o.total, 0).toFixed(2)}</p>
              </div>
              <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Pending Auth</p>
                <p className="text-3xl font-black text-white">{approvals.filter(a => a.status === 'PENDING').length}</p>
              </div>
              <button 
                onClick={async () => {
                  setIsAuditing(true);
                  const res = await getAdvancedInventoryInsights(products, orders);
                  setAiInsights(res);
                  setIsAuditing(false);
                }}
                className="bg-ninpo-lime text-ninpo-black p-8 rounded-[2.5rem] flex items-center justify-center gap-4 uppercase font-black text-[11px] shadow-neon"
              >
                {isAuditing ? <Loader2 className="w-6 h-6 animate-spin" /> : <BrainCircuit className="w-6 h-6" />}
                Strategic Audit Run
              </button>
            </div>

            {aiInsights && (
              <div className="bg-ninpo-midnight p-8 rounded-[2rem] border border-ninpo-lime/20 text-xs text-slate-300 leading-relaxed shadow-xl">
                <p className="font-black text-ninpo-lime uppercase mb-4 tracking-widest flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Strategic Intelligence Report:</p>
                {aiInsights}
              </div>
            )}

            <div className="bg-ninpo-card p-8 rounded-[2.5rem] border border-white/5 h-80">
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="name" stroke="#555" fontSize={9} />
                    <YAxis stroke="#555" fontSize={9} />
                    <Tooltip contentStyle={{ backgroundColor: '#111', border: 'none', borderRadius: '1rem', fontSize: '10px' }} />
                    <Line type="monotone" dataKey="revenue" stroke="#00ff41" strokeWidth={3} dot={false} />
                  </LineChart>
               </ResponsiveContainer>
            </div>
          </div>
        )}

        {activeModule === 'users' && (
          <div className="space-y-6">
            <h2 className="text-xl font-black uppercase text-white tracking-widest">User Database Control</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {users.map(u => (
                <div key={u.id} className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex items-center justify-between group">
                   <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-ninpo-black rounded-xl flex items-center justify-center border border-white/10 group-hover:border-ninpo-lime/20 transition-all">
                        <UserCircle className="w-6 h-6 text-slate-500 group-hover:text-ninpo-lime" />
                      </div>
                      <div>
                        <p className="text-white font-black text-xs uppercase">{u.name}</p>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">{u.role} | {u.tier}</p>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-white font-black text-xs">${u.credits.toFixed(2)}</p>
                      <button onClick={() => adjustCredits(u.id, 5, "ADMIN_INCENTIVE")} className="text-[9px] font-black text-ninpo-lime uppercase hover:text-white transition-colors">+ Grant Credit</button>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeModule === 'logs' && (
            <div className="space-y-4">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">System Audit Terminal</h2>
                <div className="bg-ninpo-midnight rounded-[2rem] border border-white/5 p-6 overflow-hidden h-[35rem] flex flex-col shadow-inner">
                    <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 font-mono">
                        {auditLogs.slice().reverse().map(log => (
                            <div key={log.id} className="text-[9px] p-2 bg-white/5 rounded border border-white/5 text-slate-400">
                                <span className="text-ninpo-lime">[{log.timestamp}]</span> <span className="text-white uppercase font-black">{log.action}</span> - UID: {log.userId}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {activeModule === 'inventory' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map(p => (
              <div key={p.id} className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-6 group hover:border-ninpo-lime/20 transition-all">
                <div className="aspect-video bg-ninpo-black rounded-3xl overflow-hidden grayscale group-hover:grayscale-0 opacity-40 group-hover:opacity-100 transition-all">
                  <img src={p.image} className="w-full h-full object-cover" alt={p.name} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">{p.name}</span>
                  <span className={`text-[10px] font-black uppercase ${p.stock < 5 ? 'text-ninpo-red animate-pulse' : 'text-slate-500'}`}>QTY: {p.stock}</span>
                </div>
                <button onClick={() => handleRestock(p.id)} className="w-full py-4 bg-white/5 rounded-2xl text-[9px] font-black uppercase text-slate-400 hover:text-ninpo-lime border border-transparent hover:border-ninpo-lime/20 transition-all">Execute Restock Node +10</button>
              </div>
            ))}
          </div>
        )}

        {activeModule === 'settings' && (
            <div className="space-y-8 max-w-2xl">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">Logistics Configuration</h2>
                <div className="bg-ninpo-card p-8 rounded-[3.5rem] border border-white/5 space-y-8">
                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Delivery Node Fee ($)</label>
                        <input type="number" value={settings.deliveryFee} onChange={e => setSettings({...settings, deliveryFee: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white font-black" />
                    </div>
                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Referral Bonus Matrix ($)</label>
                        <input type="number" value={settings.referralBonus} onChange={e => setSettings({...settings, referralBonus: parseFloat(e.target.value)})} className="w-full bg-ninpo-black border border-white/10 rounded-2xl p-5 text-white font-black" />
                    </div>
                    <div className="flex items-center justify-between p-6 bg-ninpo-red/5 rounded-2xl border border-ninpo-red/10">
                        <div className="flex items-center gap-4">
                            <AlertTriangle className="w-5 h-5 text-ninpo-red" />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Mainframe Maintenance Lock</span>
                        </div>
                        <input type="checkbox" checked={settings.maintenanceMode} onChange={e => setSettings({...settings, maintenanceMode: e.target.checked})} className="w-7 h-7 accent-ninpo-red cursor-pointer" />
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default ManagementView;
