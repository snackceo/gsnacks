import React from 'react';
import { BACKEND_URL } from '../constants';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, KeyRound, Mail } from 'lucide-react';


type ResetStatus = 'idle' | 'submitting' | 'success' | 'error';

export default function ResetPasswordView() {
  const [params] = useSearchParams();
  const tokenParam = useMemo(() => String(params.get('token') || ''), [params]);

  const [token, setToken] = useState(tokenParam);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ResetStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(tokenParam);
  }, [tokenParam]);

  const isTokenMode = token.trim().length > 0;

  const handleRequestSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (!username.trim()) {
      setStatus('error');
      setMessage('Enter your username to continue.');
      return;
    }

    setStatus('submitting');

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim() })
      });

      if (!res.ok) throw new Error('Reset request failed');

      setStatus('success');
      setMessage(
        'If an account exists for that username, a reset link will be sent.'
      );
    } catch {
      setStatus('error');
      setMessage('Unable to start reset. Please try again.');
    }
  };

  const handleResetSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (!password.trim()) {
      setStatus('error');
      setMessage('Enter a new password to continue.');
      return;
    }

    setStatus('submitting');

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/reset-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password })
      });

      if (!res.ok) throw new Error('Reset confirmation failed');

      setStatus('success');
      setMessage('Password reset complete. You can sign in again.');
    } catch {
      setStatus('error');
      setMessage('Unable to reset password. Request a new link.');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6 bg-ninpo-black text-white">
      <div className="max-w-md w-full relative z-10 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-ninpo-lime rounded-3xl mb-6 shadow-xl">
            <KeyRound className="w-10 h-10 text-ninpo-black" />
          </div>

          <h2 className="text-3xl font-black text-white tracking-widest uppercase mb-2">
            Reset Access
          </h2>

          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Secure recovery channel
          </p>
        </div>

        <div className="bg-ninpo-midnight/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
          {isTokenMode ? (
            <form onSubmit={handleResetSubmit} className="space-y-6">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-slate-400">
                <KeyRound className="w-4 h-4 text-ninpo-lime" />
                <span>Reset token loaded</span>
              </div>

              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                placeholder="New password"
                className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
              />

              {message && (
                <p
                  className={`text-[10px] font-black uppercase text-center ${
                    status === 'success' ? 'text-ninpo-lime' : 'text-ninpo-red'
                  }`}
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl flex items-center justify-center gap-4 group transition-all shadow-xl active:scale-95 disabled:opacity-60"
              >
                <span className="text-[11px] font-black uppercase tracking-widest">
                  Confirm Reset
                </span>
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleRequestSubmit} className="space-y-6">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-slate-400">
                <Mail className="w-4 h-4 text-ninpo-lime" />
                <span>Request a reset link</span>
              </div>

              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                placeholder="Username"
                className="w-full bg-white/5 border border-white/5 rounded-2xl py-5 px-6 text-white font-bold uppercase tracking-widest text-sm focus:border-ninpo-lime outline-none transition-all placeholder:text-slate-500"
              />

              {message && (
                <p
                  className={`text-[10px] font-black uppercase text-center ${
                    status === 'success' ? 'text-ninpo-lime' : 'text-ninpo-red'
                  }`}
                >
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full py-6 bg-ninpo-lime text-ninpo-black rounded-2xl flex items-center justify-center gap-4 group transition-all shadow-xl active:scale-95 disabled:opacity-60"
              >
                <span className="text-[11px] font-black uppercase tracking-widest">
                  Send Reset Link
                </span>
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          )}

          <div className="pt-6 text-center">
            <Link
              to="/"
              className="text-[10px] font-black text-slate-500 hover:text-ninpo-lime uppercase tracking-widest transition-colors"
            >
              Return to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
