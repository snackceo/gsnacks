
import React from 'react';
import { User, UserRole } from '../types';
import { Shield } from 'lucide-react';

interface NavbarProps {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  cartCount: number;
}

const Navbar: React.FC<NavbarProps> = ({ currentUser, setCurrentUser, cartCount }) => {
  const roles = Object.values(UserRole);

  return (
    <nav className="bg-white/80 backdrop-blur-md shadow-sm border-b sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-2 group cursor-pointer">
            <div className="bg-lime-500 p-2 rounded-lg shadow-lg shadow-lime-500/20 group-hover:scale-110 transition-transform">
              <Shield className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-black tracking-tighter text-slate-900 uppercase">
              NINPO<span className="text-lime-500">SNACKS</span>
            </span>
          </div>

          <div className="hidden md:flex items-center space-x-6">
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/50">
              {roles.map((role) => (
                <button
                  key={role}
                  onClick={() => setCurrentUser({ ...currentUser, role })}
                  className={`px-4 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all ${
                    currentUser.role === role 
                    ? 'bg-white text-lime-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
            
            <div className="h-6 w-px bg-slate-200"></div>

            <div className="flex items-center space-x-3">
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">{currentUser.name}</p>
                <p className="text-[10px] text-lime-600 font-black uppercase tracking-wider">${currentUser.credits.toFixed(2)} Balance</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black border-2 border-slate-800 shadow-lg">
                {currentUser.name.charAt(0)}
              </div>
            </div>
          </div>

          <div className="md:hidden flex items-center">
             <span className="text-[10px] font-black bg-lime-500 text-white px-3 py-1.5 rounded-lg shadow-lg shadow-lime-500/20 uppercase tracking-widest">{currentUser.role}</span>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
