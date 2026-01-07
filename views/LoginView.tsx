
import React, { useState, useEffect, useRef } from 'react';
import { User, UserRole, UserTier } from '../types';
import { Shield, Lock, Cpu, Fingerprint, AlertCircle, ChevronRight, Binary, UserPlus, LogIn, Gift, PartyPopper } from 'lucide-react';

interface LoginViewProps {
  users: User[];
  onLogin: (user: User) => void;
  onRegister: (user: User) => void;
  onCancel?: () => void;
}

const LoginView: React.FC<LoginViewProps> = ({ users, onLogin, onRegister, onCancel }) => {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setError(null);

    setTimeout(() => {
      if (isRegisterMode) {
        if (users.find(u => u.name.toLowerCase() === username.toLowerCase())) {
          setError('Username already taken.');
          setIsAuthenticating(false);
          return;
        }

        let startingCredits = 0;
        let referredBy: string | undefined = undefined;
        if (referralCodeInput.trim()) {
           const referrer = users.find(u => u.referralCode === referralCodeInput.toUpperCase());
           if (referrer) {
             startingCredits = 5.00;
             referredBy = referrer.referralCode;
           } else {
             setError('Invalid Referral Code.');
             setIsAuthenticating(false);
             return;
           }
        }

        const newUser: User = {
          id: `custo_${Math.floor(Math.random() * 100000)}`,
          name: fullName || username,
          email: email || `${username}@ninposnacks.com`,
          role: UserRole.CUSTOMER,
          tier: UserTier.BRONZE,
          credits: startingCredits,
          referredBy: referredBy,
          referralCode: `NINPO_${username.toUpperCase().slice(0, 3)}${Math.floor(Math.random()*100)}`,
          loyaltyPoints: 100, // Welcome points
          dailyReturnTotal: 0
        };
        
        setShowWelcome(true);
        setTimeout(() => onRegister(newUser), 1500);
      } else {
        const foundUser = users.find(u => u.name.toLowerCase() === username.toLowerCase());
        
        if (foundUser && foundUser.isLocked) {
           setError('Access Denied: Account Locked.');
           setIsAuthenticating(false);
           return;
        }

        if (username.toLowerCase() === 'admin' && password === '123') {
           const adminUser = users.find(u => u.role === UserRole.OWNER) || users[1];
           onLogin(adminUser);
        } else if (foundUser && password === '123') {
           onLogin(foundUser);
        } else {
           setError('Invalid credentials. (Try password: 123)');
           setIsAuthenticating(false);
        }
      }
    }, 1200);
  };

  if (showWelcome) {
    return (
      <div className="text-center space-y-8 p-12 bg-ninpo-midnight rounded-[3rem] border border-ninpo-lime/20 shadow-neon animate-in zoom-in">
        <div className="w-24 h-24 bg-ninpo-lime/10 rounded-full flex items-center justify-center mx-auto border border-ninpo-lime/20">
          <PartyPopper className="w-12 h-12 text-ninpo-lime animate-bounce" />
        </div>
        <div>
          <h2 className="text-2xl font-black uppercase text-white tracking-widest">Uplink Successful</h2>
          <p className="text-[10px] font-black text-slate-500 uppercase mt-2 tracking-widest">+100 Welcome Points Credited</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="max-w-md w-full relative z-10 animate-in fade-in zoom-in duration-500"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-ninpo-lime rounded-3xl mb-6 shadow-xl relative group">
           <Cpu className="w-10 h-10 text-ninpo-black" />
        </div>
        <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-2">
          {isRegisterMode ? 'Create Account' : 'Sign In'}
        </h2>
        <div className="flex items-center justify-center gap-2 opacity-40">
          <Binary className="w-3 h-3 text-ninpo-lime" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Secure Delivery System</p>
        </div>
      </div>

      <div className="bg-ninpo-midnight/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden">
        {isAuthenticating ? (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-8">
             <Fingerprint className="w-12 h-12 text-ninpo-lime animate-pulse" />
             <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Verifying Identity...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {isRegisterMode && (
              <>
                <input 
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="Your Full Name"
                  className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
                />
                <input 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="Email Address"
                  className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
                />
                <div className="relative">
                   <input 
                    type="text"
                    value={referralCodeInput}
                    onChange={(e) => setReferralCodeInput(e.target.value)}
                    placeholder="Referral Code (Optional)"
                    className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
                  />
                  <Gift className="absolute right-6 top-1/2 -translate-y-1/2 w-4 h-4 text-ninpo-lime opacity-40" />
                </div>
              </>
            )}
            <input 
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Username"
              className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
            />
            <input 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Password"
              className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
            />
            {error && <p className="text-[10px] font-black text-ninpo-red uppercase text-center">{error}</p>}
            
            <button type="submit" className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl flex items-center justify-center gap-4 group transition-all shadow-xl active:scale-95">
              <span className="text-[11px] font-black uppercase tracking-widest">
                {isRegisterMode ? 'Complete Sign Up' : 'Authorize Access'}
              </span>
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            <div className="pt-4 text-center">
              <button 
                type="button" 
                onClick={() => setIsRegisterMode(!isRegisterMode)}
                className="text-[10px] font-black text-slate-500 hover:text-ninpo-lime uppercase tracking-widest transition-colors flex items-center justify-center gap-2 mx-auto"
              >
                {isRegisterMode ? (
                  <><LogIn className="w-4 h-4" /> Already registered? Log in</>
                ) : (
                  <><UserPlus className="w-4 h-4" /> New to Ninpo? Create account</>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginView;
