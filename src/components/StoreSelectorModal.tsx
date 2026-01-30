import React, { useCallback, useMemo, useState } from 'react';
import { Check, MapPin, Loader2 } from 'lucide-react';
import { StoreRecord } from '../types';
import { formatStoreAddress, formatStoreCityStateZip } from '../utils/address';

interface StoreSelectorModalProps {
  stores: StoreRecord[];
  activeStoreId: string;
  isOpen: boolean;
  isLoading?: boolean;
  onStoreChange?: (storeId: string) => void;
  onConfirm: (storeId: string) => void;
  onConfirmWithoutStore?: () => void;
  onCancel: () => void;
  selectedStoreIsPrimary?: boolean;
  onPrimarySupplierToggle?: (storeId: string, nextValue: boolean) => void;
}

const formatStoreType = (storeType?: string) => {
  if (!storeType) return 'Other';
  return storeType.charAt(0).toUpperCase() + storeType.slice(1);
};

const formatStoreLocation = (store: StoreRecord) => formatStoreCityStateZip(store.address, '');

const formatStoreCoordinates = (store: StoreRecord) => {
  if (!store.location?.lat || !store.location?.lng) return '';
  return `${store.location.lat.toFixed(4)}, ${store.location.lng.toFixed(4)}`;
};

const StoreSelectorModal: React.FC<StoreSelectorModalProps> = (props) => {
  const {
    stores,
    activeStoreId,
    isOpen,
    isLoading = false,
    onStoreChange,
    onConfirm,
    onCancel,
    selectedStoreIsPrimary,
    onPrimarySupplierToggle
  } = props;
  const onConfirmWithoutStore = props.onConfirmWithoutStore;
  const [filterText, setFilterText] = useState('');

  const activeStore = useMemo(
    () => stores.find(store => store.id === activeStoreId) || null,
    [stores, activeStoreId]
  );

  const filteredStores = useMemo(() => {
    if (!filterText) return stores;
    const lc = filterText.toLowerCase();
    return stores.filter(
      s => {
        const addressText = formatStoreAddress(s.address, '').toLowerCase();
        const typeText = s.storeType ? s.storeType.toLowerCase() : '';
        return (
          s.name.toLowerCase().includes(lc) ||
          (typeText && typeText.includes(lc)) ||
          (addressText && addressText.includes(lc))
        );
      }
    );
  }, [stores, filterText]);

  const handleSelectStore = useCallback(
    (storeId: string) => {
      onStoreChange?.(storeId);
    },
    [onStoreChange]
  );

  const handleConfirm = useCallback(() => {
    if (!activeStoreId) return;
    onConfirm(activeStoreId);
    setFilterText('');
  }, [activeStoreId, onConfirm]);

  const handleCancel = useCallback(() => {
    setFilterText('');
    onCancel();
  }, [onCancel]);

  const handleConfirmWithoutStore = useCallback(() => {
    setFilterText('');
    if (onConfirmWithoutStore) {
      onConfirmWithoutStore();
    }
  }, [onConfirmWithoutStore]);

  const handlePrimarySupplierToggle = useCallback(() => {
    if (!activeStore || !onPrimarySupplierToggle) return;
    const nextValue = !(selectedStoreIsPrimary ?? false);
    onPrimarySupplierToggle(activeStore.id, nextValue);
  }, [activeStore, onPrimarySupplierToggle, selectedStoreIsPrimary]);

  if (!isOpen) return null;

  React.useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md h-[100dvh] sm:h-auto sm:max-h-[90dvh] bg-ninpo-black border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-ninpo-black border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-ninpo-lime" />
            <h2 className="text-lg font-black text-white uppercase tracking-widest">Select Store</h2>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        {/* Search input */}
        <div className="px-4 py-3 border-b border-white/10 bg-ninpo-black sticky top-[56px] z-9">
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Search by name, brand, or location..."
            autoFocus
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-ninpo-lime/50"
          />
        </div>
        {/* Body */}
        <div className="modal-body overflow-y-auto flex-1 px-4 py-4" style={{ maxHeight: 'calc(100dvh - 140px)' }}>
          {filteredStores.length > 0 ? (
            filteredStores.map(store => {
              const locationLine = formatStoreLocation(store);
              const coordinates = formatStoreCoordinates(store);
              const brandLabel = formatStoreType(store.storeType);
              const fullAddress = formatStoreAddress(store.address, '');
              return (
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
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-white text-sm truncate">{store.name}</p>
                      {store.isPrimarySupplier && (
                        <span className="text-[10px] uppercase tracking-widest bg-ninpo-lime/20 text-ninpo-lime px-2 py-0.5 rounded-full">
                          Primary supplier
                        </span>
                      )}
                    </div>
                    <div className="grid gap-1 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Brand</span>
                        <span className="text-slate-200 font-semibold truncate">{brandLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Location</span>
                        <span className="text-slate-300 truncate">{locationLine || 'No location'}</span>
                      </div>
                      {fullAddress && (
                        <p className="text-xs text-slate-500 truncate">{fullAddress}</p>
                      )}
                      {coordinates && (
                        <p className="text-[11px] text-slate-500">Coords: {coordinates}</p>
                      )}
                    </div>
                  </div>
                  {activeStoreId === store.id && (
                    <Check className="w-5 h-5 text-ninpo-lime flex-shrink-0 mt-1" />
                  )}
                </button>
              );
            })
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400">No stores found</p>
              <p className="text-xs text-slate-500 mt-1">Create a store in the Stores tab first</p>
            </div>
          )}
        </div>
        {/* Primary supplier toggle */}
        {activeStore && onPrimarySupplierToggle && (
          <div className="px-4 py-4 border-t border-white/10 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-widest text-slate-400">Primary supplier</p>
              <p className="text-sm text-white font-semibold truncate">{activeStore.name}</p>
            </div>
            <button
              type="button"
              onClick={handlePrimarySupplierToggle}
              aria-pressed={selectedStoreIsPrimary}
              aria-label={`Primary supplier ${selectedStoreIsPrimary ? 'on' : 'off'}`}
              className={`h-6 w-12 rounded-full border border-white/10 transition relative ${
                selectedStoreIsPrimary ? 'bg-ninpo-lime/80' : 'bg-white/10'
              }`}
            >
              <span
                className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                  selectedStoreIsPrimary ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </div>
        )}
        {/* Footer */}
        <div className="sticky bottom-0 z-10 bg-ninpo-black border-t border-white/10 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          {onConfirmWithoutStore && (
            <div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg mb-2">
              <p className="text-xs text-amber-200 mb-2">
                ⚠️ Proceeding without a store will reduce AI matching accuracy for receipt items.
              </p>
              <button
                onClick={handleConfirmWithoutStore}
                disabled={isLoading}
                className="w-full px-4 py-2 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue Anyway
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isLoading || !activeStoreId}
              className="flex-1 px-4 py-2 rounded-lg bg-ninpo-lime hover:bg-ninpo-lime/90 text-ninpo-black font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Confirm Store
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreSelectorModal;
