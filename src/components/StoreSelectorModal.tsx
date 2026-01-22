import React, { useCallback, useState, useMemo } from 'react';
import { Check, MapPin, Loader2 } from 'lucide-react';
import { StoreRecord } from '../types';

interface StoreSelectorModalProps {
  stores: StoreRecord[];
  activeStoreId: string;
  isOpen: boolean;
  isLoading?: boolean;
  onSelect: (storeId: string) => void;
  onCancel: () => void;
}

const StoreSelectorModal: React.FC<StoreSelectorModalProps> = ({
  stores,
  activeStoreId,
  isOpen,
  isLoading = false,
  onSelect,
  onCancel
}) => {
  const [filterText, setFilterText] = useState('');

  const filteredStores = useMemo(() => {
    if (!filterText) return stores;
    const lc = filterText.toLowerCase();
    return stores.filter(
      s =>
        s.name.toLowerCase().includes(lc) ||
        s.address?.city?.toLowerCase().includes(lc) ||
        s.address?.state?.toLowerCase().includes(lc)
    );
  }, [stores, filterText]);

  const handleSelectStore = useCallback(
    (storeId: string) => {
      onSelect(storeId);
      setFilterText('');
    },
    [onSelect]
  );

  const handleCancel = useCallback(() => {
    setFilterText('');
    onCancel();
  }, [onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ninpo-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-ninpo-black border border-white/10 rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-ninpo-lime" />
            <h2 className="text-lg font-black text-white uppercase tracking-widest">Select Store</h2>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>

        {/* Search input */}
        <div className="px-6 py-3 border-b border-white/10">
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Search by name or location..."
            autoFocus
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ninpo-lime/50"
          />
        </div>

        {/* Store list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2">
          {filteredStores.length > 0 ? (
            filteredStores.map(store => (
              <button
                key={store.id}
                onClick={() => handleSelectStore(store.id)}
                disabled={isLoading}
                className={`w-full text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 ${
                  activeStoreId === store.id
                    ? 'bg-ninpo-lime/20 border-ninpo-lime/50'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm truncate">{store.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {[store.address?.city, store.address?.state]
                      .filter(Boolean)
                      .join(', ') || 'No location'}
                  </p>
                  {store.address?.street && (
                    <p className="text-xs text-slate-500 truncate">{store.address.street}</p>
                  )}
                </div>
                {activeStoreId === store.id && (
                  <Check className="w-5 h-5 text-ninpo-lime flex-shrink-0 mt-1" />
                )}
              </button>
            ))
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">No stores found</p>
              <p className="text-xs text-slate-500 mt-1">Create a store in the Stores tab first</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex gap-3">
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (activeStoreId) handleSelectStore(activeStoreId);
            }}
            disabled={isLoading || !activeStoreId}
            className="flex-1 px-4 py-2 rounded-lg bg-ninpo-lime hover:bg-ninpo-lime/90 text-ninpo-black font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoreSelectorModal;
