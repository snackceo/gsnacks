import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Cpu, Fingerprint, Binary, UserPlus, LogIn } from 'lucide-react';

interface LoginViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

const runtimeBackendUrl = () => {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'ninposnacks.com' || host.endsWith('.ninposnacks.com')) {
      return 'https://api.ninposnacks.com';
    }
  }

  return 'http://localhost:5000';
};

const BACKEND_URL = runtimeBackendUrl();

const LoginView: React.FC<LoginViewProps> = ({ onSuccess, onCancel }) => {
  const navigate = useNavigate();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAuthenticating(true);

    try {
      const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || data?.message || 'Authentication failed');
        setIsAuthenticating(false);
        return;
      }

      onSuccess();
    } catch {
      setError('Network error while authenticating');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6">
      <div className="max-w-md w-full relative z-10 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-ninpo-lime rounded-3xl mb-6 shadow-xl relative group">
            <Cpu className="w-10 h-10 text-ninpo-black" />
          </div>

          <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-2">
            {isRegisterMode ? 'Create Account' : 'Sign In'}
          </h2>

          <div className="flex items-center justify-center gap-2 opacity-40">
            <Binary className="w-3 h-3 text-ninpo-lime" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Secure Delivery System
            </p>
          </div>
        </div>

        <div className="bg-ninpo-midnight/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden">
          {isAuthenticating ? (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-8">
              <Fingerprint className="w-12 h-12 text-ninpo-lime animate-pulse" />
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Verifying Identity...
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-6">
              <input
                ref={usernameRef}
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="Username"
                className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
              />

              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Password"
                className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
              />

              {error && (
                <p className="text-[10px] font-black text-ninpo-red uppercase text-center">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl flex items-center justify-center gap-4 group transition-all shadow-xl active:scale-95"
              >
                <span className="text-[11px] font-black uppercase tracking-widest">
                  {isRegisterMode ? 'Complete Sign Up' : 'Authorize Access'}
                </span>
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setIsRegisterMode(!isRegisterMode)}
                  className="text-[10px] font-black text-slate-500 hover:text-ninpo-lime uppercase tracking-widest transition-colors flex items-center gap-2"
                >
                  {isRegisterMode ? (
                    <>
                      <LogIn className="w-4 h-4" /> Already registered? Log in
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" /> New? Create account
                    </>
                  )}
                </button>

                {!isRegisterMode && (
                  <button
                    type="button"
                    onClick={() => {
                      onCancel?.();
                      navigate('/reset-password');
                    }}
                    className="text-[10px] font-black text-slate-500 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
                  >
                    Forgot password?
                  </button>
                )}

                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-2 rounded-xl bg-ninpo-red/10 text-ninpo-red border border-ninpo-red/20 text-[10px] font-black uppercase tracking-widest hover:bg-ninpo-red/20 transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
