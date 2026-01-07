import { UserRole } from '../types';

interface Props {
  currentUserRole?: UserRole;
  isLoggedIn: boolean;
  onLogoClick: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onSelectMarket: () => void;
  onSelectManagement: () => void;
  onSelectDriver: () => void;
}

const Header = ({
  currentUserRole,
  isLoggedIn,
  onLogoClick,
  onLogout,
  onLogin,
  onSelectMarket,
  onSelectManagement,
  onSelectDriver
}: Props) => {
  return (
    <header className="px-6 pt-8 max-w-[1600px] w-full mx-auto z-50">
      <div className="bg-ninpo-midnight/80 backdrop-blur-xl rounded-[2.5rem] p-5 border border-white/10 flex items-center justify-between">
        <div
          className="flex items-center gap-4 cursor-pointer"
          onClick={onLogoClick}
        >
          <div className="w-10 h-10 bg-ninpo-lime rounded-xl flex items-center justify-center">
            <span className="text-ninpo-black font-black text-xl">N</span>
          </div>
          <span className="hidden sm:block text-lg font-black uppercase">
            Ninpo <span className="text-ninpo-red">Snacks</span>
          </span>
        </div>

        <div className="flex gap-2">
          {currentUserRole === UserRole.OWNER && (
            <>
              <button onClick={onSelectManagement}>Management</button>
              <button onClick={onSelectDriver}>Logistics</button>
            </>
          )}

          <button onClick={isLoggedIn ? onLogout : onLogin}>
            {isLoggedIn ? 'Logout' : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
