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

  return (
    <header className="px-6 pt-8 max-w-[1600px] w-full mx-auto z-50">
      <div className="bg-ninpo-midnight/80 backdrop-blur-xl rounded-[2.5rem] p-5 border border-white/10 flex items-center justify-between">

        {/* Logo */}
        <div
          className="flex items-center gap-4 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <div className="w-10 h-10 bg-ninpo-lime rounded-xl flex items-center justify-center">
            <span className="text-ninpo-black font-black text-xl">N</span>
          </div>
          <span className="hidden sm:block text-lg font-black uppercase">
            Ninpo <span className="text-ninpo-red">Snacks</span>
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
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

          <button
            onClick={isLoggedIn ? onLogout : onLogin}
            className="px-5 py-2 rounded-full bg-ninpo-red text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-ninpo-red/30 hover:bg-ninpo-red/90 transition"
          >
            {isLoggedIn ? 'Logout' : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
