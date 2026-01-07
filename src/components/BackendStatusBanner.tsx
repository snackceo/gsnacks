import { WifiOff, RefreshCcw } from 'lucide-react';

interface BackendStatusBannerProps {
  isOnline: boolean;
  onReconnect: () => void;
}

function BackendStatusBanner({
  isOnline,
  onReconnect
}: BackendStatusBannerProps) {
  if (isOnline) return null;

  return (
    <div className="bg-ninpo-red text-white py-2 text-center text-[9px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4 z-[12000] sticky top-0">
      <WifiOff className="w-3 h-3" />
      Mainframe Disconnected – Operating in Offline Buffer
      <button
        onClick={onReconnect}
        className="bg-white/20 px-3 py-1 rounded hover:bg-white/30 transition-all flex items-center gap-1"
      >
        <RefreshCcw className="w-2 h-2" />
        Reconnect
      </button>
    </div>
  );
}

export default BackendStatusBanner;
