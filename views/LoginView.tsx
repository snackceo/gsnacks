
import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { ShieldCheck, Truck, ShoppingBag, Crown, Fingerprint, Lock, Zap } from 'lucide-react';

interface LoginViewProps {
  users: User[];
  onLogin: (user: User) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ users, onLogin }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleQuickLogin = (role: UserRole) => {
    setIsAuthenticating(true);
    const targetUser = users.find(u => u.role === role) || users[0];
    
    // Simulate biometric scan delay for aesthetic
    setTimeout(() => {
      onLogin(targetUser);
      setIsAuthenticating(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-lime-500/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        {/* Brand Side */}
        <div className="space-y-8 animate-in slide-in-from-left duration-700">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-lime-500 rounded-2xl shadow-[0_0_30px_rgba(163,230,53,0.3)]">
              <Zap className="w-8 h-8 text-slate-900 fill-slate-900" />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">
              Ninpo<span className="text-lime-500 block">Snacks</span>
            </h1>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
              Logistics Control Terminal <br />
              <span className="text-slate-600 text-sm">Authorized Personnel Only</span>
            </h2>
            <p className="text-slate-500 text-sm leading-relaxed max-w-sm">
              Michigan's elite snack and bottle return ecosystem. Synchronizing fleet operations and eco-friendly returns in real-time.
            </p>
          </div>
          <div className="flex items-center gap-4 pt-4">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-10 h-10 rounded-full border-2 border-slate-900 bg-slate-800" />
              ))}
            </div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              2,400+ Active Nodes
            </p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900/50 backdrop-blur-xl border border-white/5 p-10 rounded-[3rem] shadow-2xl animate-in zoom-in duration-500">
          {isAuthenticating ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-8 text-center">
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-lime-500/20 animate-ping absolute inset-0" />
                <div className="w-24 h-24 rounded-full border-4 border-t-lime-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                <Fingerprint className="w-10 h-10 text-lime-500 absolute inset-0 m-auto" />
              </div>
              <div>
                <h3 className="text-white font-black uppercase tracking-widest text-sm mb-2">Biometric Syncing</h3>
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em]">Establishing encrypted uplink...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex justify-between items-center border-b border-white/5 pb-6">
                <h3 className="text-white font-black uppercase tracking-widest text-xs">Security Clearance</h3>
                <Lock className="w-4 h-4 text-slate-500" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => handleQuickLogin(UserRole.OWNER)}
                  className="p-6 bg-white/5 border border-white/5 rounded-3xl hover:bg-lime-500 group transition-all text-left"
                >
                  <Crown className="w-6 h-6 text-lime-500 group-hover:text-slate-900 mb-4" />
                  <p className="text-[10px] font-black text-white group-hover:text-slate-900 uppercase tracking-widest">Executive</p>
                  <p className="text-[8px] text-slate-500 group-hover:text-slate-800 uppercase mt-1">Owner Account</p>
                </button>
                <button 
                  onClick={() => handleQuickLogin(UserRole.ADMIN)}
                  className="p-6 bg-white/5 border border-white/5 rounded-3xl hover:bg-white group transition-all text-left"
                >
                  <ShieldCheck className="w-6 h-6 text-slate-400 group-hover:text-slate-900 mb-4" />
                  <p className="text-[10px] font-black text-white group-hover:text-slate-900 uppercase tracking-widest">Operations</p>
                  <p className="text-[8px] text-slate-500 group-hover:text-slate-800 uppercase mt-1">Administrator</p>
                </button>
                <button 
                  onClick={() => handleQuickLogin(UserRole.DRIVER)}
                  className="p-6 bg-white/5 border border-white/5 rounded-3xl hover:bg-white group transition-all text-left"
                >
                  <Truck className="w-6 h-6 text-slate-400 group-hover:text-slate-900 mb-4" />
                  <p className="text-[10px] font-black text-white group-hover:text-slate-900 uppercase tracking-widest">Fleet</p>
                  <p className="text-[8px] text-slate-500 group-hover:text-slate-800 uppercase mt-1">Delivery Agent</p>
                </button>
                <button 
                  onClick={() => handleQuickLogin(UserRole.CUSTOMER)}
                  className="p-6 bg-white/5 border border-white/5 rounded-3xl hover:bg-lime-500 group transition-all text-left"
                >
                  <ShoppingBag className="w-6 h-6 text-lime-500 group-hover:text-slate-900 mb-4" />
                  <p className="text-[10px] font-black text-white group-hover:text-slate-900 uppercase tracking-widest">Market</p>
                  <p className="text-[8px] text-slate-500 group-hover:text-slate-800 uppercase mt-1">Customer Entry</p>
                </button>
              </div>

              <div className="pt-6 border-t border-white/5">
                <p className="text-center text-slate-600 text-[9px] font-bold uppercase tracking-[0.2em]">
                  Platform v1.0.4 • Detroit Sector Active
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
