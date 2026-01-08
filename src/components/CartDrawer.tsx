import {
  ShoppingBag,
  X,
  Trash2,
  Loader2,
  Zap,
  Landmark
} from 'lucide-react';

import { Product } from '../types';

interface CartItem {
  productId: string;
  quantity: number;
}

interface Props {
  isOpen: boolean;
  cart: CartItem[];
  products: Product[];
  address: string;
  acceptedPolicies: boolean;
  isProcessing: boolean;
  onClose: () => void;
  onAddressChange: (v: string) => void;
  onPolicyChange: (v: boolean) => void;
  onRemoveItem: (id: string) => void;
  onPayCredits: () => void;
  onPayExternal: (type: 'STRIPE' | 'GPAY') => void;
}

const CartDrawer = ({
  isOpen,
  cart,
  products,
  address,
  acceptedPolicies,
  isProcessing,
  onClose,
  onAddressChange,
  onPolicyChange,
  onRemoveItem,
  onPayCredits,
  onPayExternal
}: Props) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex justify-end">
      <div
        className="absolute inset-0 bg-ninpo-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-ninpo-midnight border-l border-white/10 h-full flex flex-col p-8 animate-in slide-in-right">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-xl font-black uppercase text-white">
            Cargo manifest
          </h3>
          <button onClick={onClose}>
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20">
              <ShoppingBag className="w-20 h-20 mb-4" />
              <p className="font-black uppercase text-xs">Manifest Empty</p>
            </div>
          ) : (
            cart.map(item => {
              const p = products.find(prod => prod.id === item.productId);
              const price = (p as any)?.price ?? 0;

              return (
                <div
                  key={item.productId}
                  className="flex gap-4 bg-ninpo-card p-4 rounded-2xl border border-white/5"
                >
                  <img
                    src={p?.image}
                    className="w-12 h-12 rounded-xl object-cover grayscale"
                    alt={p?.name ?? 'Product'}
                  />

                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase">
                      {p?.name ?? item.productId}
                    </p>
                    <p className="text-[9px] font-bold text-ninpo-lime mt-1">
                      {item.quantity} x ${(price as number).toFixed(2)}
                    </p>
                  </div>

                  <button
                    onClick={() => onRemoveItem(item.productId)}
                    className="text-slate-600 hover:text-ninpo-red"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-8 border-t border-white/5 space-y-4">
          <input
            type="text"
            placeholder="Drop Location..."
            value={address}
            onChange={e => onAddressChange(e.target.value)}
            className="w-full bg-white/5 border border-white/5 rounded-2xl p-5 text-white text-xs outline-none focus:border-ninpo-lime"
          />

          <label className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedPolicies}
              onChange={e => onPolicyChange(e.target.checked)}
              className="accent-ninpo-lime"
            />
            Accept Hub Protocol
          </label>

          <div className="grid gap-2">
            <button
              disabled={
                !address ||
                !acceptedPolicies ||
                isProcessing ||
                cart.length === 0
              }
              onClick={onPayCredits}
              className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-xl font-black uppercase text-[10px] shadow-neon flex items-center justify-center gap-2 disabled:opacity-30"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Pay with Credits'
              )}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onPayExternal('GPAY')}
                disabled={
                  !address ||
                  !acceptedPolicies ||
                  isProcessing ||
                  cart.length === 0
                }
                className="py-4 bg-white/5 rounded-xl text-[9px] font-black uppercase flex items-center justify-center gap-2 disabled:opacity-30"
              >
                <Zap className="w-3 h-3" /> Google Pay
              </button>

              <button
                onClick={() => onPayExternal('STRIPE')}
                disabled={
                  !address ||
                  !acceptedPolicies ||
                  isProcessing ||
                  cart.length === 0
                }
                className="py-4 bg-white/5 rounded-xl text-[9px] font-black uppercase flex items-center justify-center gap-2 disabled:opacity-30"
              >
                <Landmark className="w-3 h-3" /> Stripe
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CartDrawer;
