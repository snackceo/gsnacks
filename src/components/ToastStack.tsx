import { Binary } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface Props {
  toasts: Toast[];
}

function ToastStack({ toasts }: Props) {
  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[11000] flex flex-col gap-2 w-full max-w-xs px-4 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-6 py-4 rounded-full border backdrop-blur-xl pointer-events-auto
            ${
              t.type === 'success'
                ? 'bg-ninpo-lime/10 border-ninpo-lime text-ninpo-lime'
                : t.type === 'warning'
                ? 'bg-ninpo-red/10 border-ninpo-red text-ninpo-red'
                : 'bg-white/10 border-white/20 text-white'
            }`}
        >
          <Binary className="w-4 h-4" />
          <span className="text-[10px] font-black uppercase tracking-widest">
            {t.message}
          </span>
        </div>
      ))}
    </div>
  );
}

export default ToastStack;
