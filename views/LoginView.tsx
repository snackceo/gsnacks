
import React, { useState, useEffect, useRef } from 'react';
import { User, UserRole } from '../types';
import { Shield, Lock, Cpu, Fingerprint, AlertCircle, ChevronRight, Binary } from 'lucide-react';

interface LoginViewProps {
  users: User[];
  onLogin: (user: User) => void;
  onCancel?: () => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin, onCancel }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setError(null);
    setTimeout(() => {
      let authenticatedUser: User | null = null;
      if (username.toLowerCase() === 'admin' && password === '123') {
        authenticatedUser = {
          id: 'owner_001',
          name: 'Executive Admin',
          email: 'eve@owner.com',
          role: UserRole.OWNER,
          credits: 1000.00,
          referralCode: 'BOSS_ONE',
          loyaltyPoints: 9999,
          dailyReturnTotal: 0
        };
      } else if (username.toLowerCase() === 'guest' && password === '123') {
        authenticatedUser = {
          id: 'custo_001',
          name: 'Alex Johnson',
          email: 'alex@customail.com',
          role: UserRole.CUSTOMER,
          credits: 24.50,
          referralCode: 'CUSTO77',
          loyaltyPoints: 1250,
          dailyReturnTotal: 0,
        };
      }
      if (authenticatedUser) {
        onLogin(authenticatedUser);
      } else {
        setError('Invalid login credentials.');
        setIsAuthenticating(false);
      }
    }, 1200);
  };

  return (
    <div 
      className="max-w-md w-full relative z-10 animate-in fade-in zoom-in duration-500"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-ninpo-lime rounded-3xl mb-6 shadow-xl relative group">
           <Cpu className="w-10 h-10 text-ninpo-black" />
        </div>
        <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-2">Login</h2>
        <div className="flex items-center justify-center gap-2 opacity-40">
          <Binary className="w-3 h-3 text-ninpo-lime" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detroit S88</p>
        </div>
      </div>

      <div className="bg-ninpo-midnight/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden">
        {isAuthenticating ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-8">
             <Fingerprint className="w-12 h-12 text-ninpo-lime animate-pulse" />
             <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Verifying details...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-8">
            <input 
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Username"
              className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime transition-all"
            />
            <input 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Password"
              className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime transition-all"
            />
            {error && <p className="text-[10px] font-black text-ninpo-red uppercase text-center">{error}</p>}
            <button type="submit" className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl flex items-center justify-center gap-4 group transition-all shadow-xl">
              <span className="text-[11px] font-black uppercase tracking-widest">Sign In</span>
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginView;
