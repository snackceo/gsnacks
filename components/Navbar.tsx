
import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { Box, Hammer, LayoutGrid, ShoppingBag, LogOut } from 'lucide-react';

interface NavbarProps {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  cartCount: number;
  isDevMode: boolean;
  setIsDevMode: (active: boolean) => void;
  onHomeClick?: () => void;
  viewMode?: 'market' | 'management';
  setViewMode?: (mode: 'market' | 'management') => void;
  onLogout: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ 
  currentUser, setCurrentUser, cartCount, isDevMode, setIsDevMode, onHomeClick, viewMode, setViewMode, onLogout 
}) => {
  const [logoTaps, setLogoTaps] = useState(0);
  const isStaff = currentUser.role !== UserRole.CUSTOMER;

  const handleLogoClick = () => {
    if (onHomeClick) onHomeClick();
    const nextTaps = logoTaps + 1;
    setLogoTaps(nextTaps);
    if (nextTaps >= 5) {
      setIsDevMode(!isDevMode);
      setLogoTaps(0);
    }
    setTimeout(() => {
      setLogoTaps(0);
    }, 2000);
  };

  return (
    <nav className="bg-white/80 backdrop-blur-md shadow-sm border-b sticky top-0 z-40 h-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full">
        <div className="flex justify-between h-full items-center">
          <div 
            onClick={handleLogoClick}
            className="flex items-center gap-2 group cursor-pointer select-none active:scale-95 transition-transform"
          >
            <div className={`p-2 rounded-lg shadow-lg transition-all ${isDevMode ? 'bg-slate-900 scale-110' : 'bg-lime-500 group-hover:scale-110'}`}>
              <Box className="text-white w-5 h-5" />
            </div>
            <span className="text-lg font-black tracking-tighter text-slate-900 uppercase">
              NINPO<span className="text-lime-500">SNACKS</span>
            </span>
          </div>

          <div className="flex items-center space-x-6">
            {isStaff && setViewMode && (
              <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl gap-1">
                <button 
                  onClick={() => setViewMode('market')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${viewMode === 'market' ? 'bg-white text-lime-600 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <ShoppingBag className="w-3 h-3" /> Store
                </button>
                <button 
                  onClick={() => setViewMode('management')}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${viewMode === 'management' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <LayoutGrid className="w-3 h-3" /> Control
                </button>
              </div>
            )}

            <div className="flex items-center space-x-3 pl-4 border-l border-slate-100">
              <div className="text-right hidden xs:block">
                <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{currentUser.name}</p>
                <p className="text-[9px] text-lime-600 font-black uppercase tracking-widest">
                  {currentUser.role}
                </p>
              </div>
              <button 
                onClick={onLogout}
                className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-white hover:bg-red-500 transition-colors group"
              >
                <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
