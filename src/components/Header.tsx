import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRole } from '../types';

interface Props {
  currentUserRole?: UserRole;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

const Header = ({
  currentUserRole,
  isLoggedIn,
  onLogin,
  onLogout
}: Props) => {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const handleNavigate = (path: string) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="px-4 pt-6 sm:px-6 sm:pt-8 max-w-[1600px] w-full mx-auto z-50">
      <div className="bg-ninpo-midnight/80 backdrop-blur-xl rounded-[2.5rem] p-5 border border-white/10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        {/* Logo */}
        <div
          className="flex items-center justify-between gap-3 sm:gap-4 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 bg-ninpo-lime rounded-xl flex items-center justify-center">
              <span className="text-ninpo-black font-black text-xl">N</span>
            </div>
            <span className="block text-sm sm:text-lg font-black uppercase">
              Ninpo <span className="text-ninpo-red">Snacks</span>
            </span>
          </div>
          <button
            type="button"
            className="sm:hidden ml-auto px-3 py-2 rounded-full bg-white/10 text-white text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/20 transition"
            onClick={(event) => {
              event.stopPropagation();
              setIsMobileMenuOpen((prev) => !prev);
            }}
          >
            {isMobileMenuOpen ? 'Close' : 'Menu'}
          </button>
        </div>

        {/* Actions */}
        <div className="hidden sm:flex gap-2 w-full sm:w-auto sm:justify-end">
          {currentUserRole === UserRole.OWNER && (
            <>
              <button
                onClick={() => navigate('/management')}
                className="px-5 py-2 rounded-full bg-ninpo-lime text-ninpo-black text-xs font-black uppercase tracking-widest shadow-neon hover:bg-white transition"
              >
                Management
              </button>
              <button
                onClick={() => navigate('/driver')}
                className="px-5 py-2 rounded-full bg-white/10 text-white text-xs font-black uppercase tracking-widest border border-white/10 hover:bg-white/20 transition"
              >
                Logistics
              </button>
            </>
          )}
          {currentUserRole === UserRole.DRIVER && (
            <button
              onClick={() => navigate('/driver')}
              className="px-5 py-2 rounded-full bg-white/10 text-white text-xs font-black uppercase tracking-widest border border-white/10 hover:bg-white/20 transition"
            >
              Logistics
            </button>
          )}

          <button
            onClick={isLoggedIn ? onLogout : onLogin}
            className="px-5 py-2 rounded-full bg-ninpo-red text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-ninpo-red/30 hover:bg-ninpo-red/90 transition"
          >
            {isLoggedIn ? 'Logout' : 'Sign In'}
          </button>
        </div>
        {isMobileMenuOpen && (
          <div className="sm:hidden w-full rounded-3xl border border-white/10 bg-ninpo-midnight/95 p-4 flex flex-col gap-2">
            {currentUserRole === UserRole.OWNER && (
              <>
                <button
                  onClick={() => handleNavigate('/management')}
                  className="w-full px-4 py-3 rounded-full bg-ninpo-lime text-ninpo-black text-xs font-black uppercase tracking-widest shadow-neon hover:bg-white transition"
                >
                  Management
                </button>
                <button
                  onClick={() => handleNavigate('/driver')}
                  className="w-full px-4 py-3 rounded-full bg-white/10 text-white text-xs font-black uppercase tracking-widest border border-white/10 hover:bg-white/20 transition"
                >
                  Logistics
                </button>
              </>
            )}
            {currentUserRole === UserRole.DRIVER && (
              <button
                onClick={() => handleNavigate('/driver')}
                className="w-full px-4 py-3 rounded-full bg-white/10 text-white text-xs font-black uppercase tracking-widest border border-white/10 hover:bg-white/20 transition"
              >
                Logistics
              </button>
            )}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                if (isLoggedIn) {
                  onLogout();
                } else {
                  onLogin();
                }
              }}
              className="w-full px-4 py-3 rounded-full bg-ninpo-red text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-ninpo-red/30 hover:bg-ninpo-red/90 transition"
            >
              {isLoggedIn ? 'Logout' : 'Sign In'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
