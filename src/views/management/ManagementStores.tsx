import React, { useCallback, useState } from 'react';
import { Wand2, MapPin, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { BACKEND_URL } from '../../constants';
import { StoreRecord } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';

interface ManagementStoresProps {
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  refreshStores: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  setError: (err: string | null) => void;
}

const emptyAddress = { street: '', city: '', state: '', zip: '', country: '' };

const formatStoreType = (storeType?: string) => {
  if (!storeType) return 'Other';
  return storeType.charAt(0).toUpperCase() + storeType.slice(1);
};

const formatLocation = (store: StoreRecord) =>
  [store.address?.street, store.address?.city, store.address?.state, store.address?.zip, store.address?.country]
    .filter(Boolean)
    .join(', ');

const ManagementStores: React.FC<ManagementStoresProps> = ({
  stores,
  activeStoreId,
  setActiveStoreId,
  refreshStores,
  isLoading,
  error,
  setError
}) => {
  const { addToast } = useNinpoCore();
  const [rawInput, setRawInput] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [primarySupplierUpdatingId, setPrimarySupplierUpdatingId] = useState<string | null>(null);
  const [deletingStoreId, setDeletingStoreId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreRecord>({
    id: '',
    name: '',
    address: { ...emptyAddress },
    storeType: 'other'
  });

  const handleEnrich = useCallback(async () => {
    setError(null);
    setIsEnriching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: rawInput, name: draft.name, address: draft.address || emptyAddress })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Enrich failed');
      setDraft(prev => ({
        ...prev,
        name: data.store?.name || prev.name,
        storeType: data.store?.storeType || prev.storeType,
        address: {
          street: data.store?.address?.street || '',
          city: data.store?.address?.city || '',
          state: data.store?.address?.state || '',
          zip: data.store?.address?.zip || '',
          country: data.store?.address?.country || ''
        },
        location: data.store?.location
      }));
      addToast('Gemini filled the address.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Enrich failed');
    } finally {
      setIsEnriching(false);
    }
  }, [addToast, draft.address, draft.name, rawInput, setError]);

  const handleSave = useCallback(async () => {
    setError(null);
    const name = draft.name?.trim();
    if (!name) {
      setError('Store name required');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          phone: draft.phone || '',
          address: draft.address || emptyAddress,
          storeType: draft.storeType || 'other',
          location: draft.location
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error('manager or owner required');
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      await refreshStores();
      if (data.store?.id) {
        setActiveStoreId(data.store.id);
      }
      addToast(`${name} saved`, 'success');
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [addToast, draft.address, draft.phone, draft.location, draft.storeType, draft.name, refreshStores, setActiveStoreId, setError]);

  const handlePrimarySupplierToggle = useCallback(async (store: StoreRecord) => {
    setPrimarySupplierUpdatingId(store.id);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/stores/${store.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isPrimarySupplier: !store.isPrimarySupplier })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error('manager or owner required');
      if (!res.ok) throw new Error(data?.error || 'Failed to update primary supplier');

      await refreshStores();
      addToast(
        `${store.name} ${store.isPrimarySupplier ? 'removed from' : 'set as'} primary supplier`,
        'success'
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to update primary supplier');
    } finally {
      setPrimarySupplierUpdatingId(null);
    }
  }, [addToast, refreshStores, setError]);

  const handleDeleteStore = useCallback(async (store: StoreRecord) => {
    const confirmed = window.confirm(`Delete ${store.name}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingStoreId(store.id);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/stores/${store.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error('manager or owner required');
      if (!res.ok) throw new Error(data?.error || 'Delete failed');

      if (activeStoreId === store.id) {
        setActiveStoreId('');
      }

      await refreshStores();
      addToast(`${store.name} deleted`, 'success');
    } catch (err: any) {
      const message = err?.message || 'Delete failed';
      setError(message);
      addToast(message, 'error');
    } finally {
      setDeletingStoreId(null);
    }
  }, [activeStoreId, addToast, refreshStores, setActiveStoreId, setError]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase text-white tracking-widest">Stores</h2>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
          Use Gemini to normalize store addresses, then save and pick your active store for pricing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <Wand2 className="w-4 h-4" /> Gemini Fill
            </div>
            {isEnriching && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <textarea
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white min-h-[100px]"
            placeholder="Paste store name + address"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={draft.name}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Store Name"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <select
              value={draft.storeType || 'other'}
              onChange={e => setDraft(prev => ({ ...prev, storeType: e.target.value }))}
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            >
              <option value="walmart">Walmart</option>
              <option value="kroger">Kroger</option>
              <option value="aldi">Aldi</option>
              <option value="target">Target</option>
              <option value="meijer">Meijer</option>
              <option value="hub">Hub</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={draft.address?.street || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), street: e.target.value } }))
              }
              placeholder="Street"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.city || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), city: e.target.value } }))
              }
              placeholder="City"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.state || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), state: e.target.value } }))
              }
              placeholder="State"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.zip || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), zip: e.target.value } }))
              }
              placeholder="ZIP"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.address?.country || ''}
              onChange={e =>
                setDraft(prev => ({ ...prev, address: { ...(prev.address || emptyAddress), country: e.target.value } }))
              }
              placeholder="Country"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
            <input
              value={draft.phone || ''}
              onChange={e => setDraft(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="Phone (optional)"
              className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
            />
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleEnrich}
              disabled={isEnriching}
              className={`px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-white/10 ${
                isEnriching ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/15'
              }`}
            >
              <Wand2 className="w-4 h-4" />
              {isEnriching ? 'Enriching…' : 'Fill with Gemini'}
            </button>
            <button
              onClick={() => setDraft({
                id: '',
                name: '',
                address: { ...emptyAddress },
                storeType: 'other'
              })}
              className="px-6 py-3 rounded-2xl bg-white/5 text-white text-[10px] font-black uppercase tracking-widest border border-white/10"
            >
              Clear
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-neon ${
                isSaving ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isSaving ? 'Saving…' : 'Save Store'}
            </button>
          </div>

          {error && <p className="text-xs text-ninpo-red font-semibold uppercase tracking-widest">{error}</p>}
        </div>

        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <MapPin className="w-4 h-4" /> Store List
            </div>
            <button
              onClick={() => void refreshStores()}
              disabled={isLoading}
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {stores.map(store => {
              const location = formatLocation(store);
              const isUpdating = primarySupplierUpdatingId === store.id;
              const isDeleting = deletingStoreId === store.id;

              return (
                <div
                  key={store.id}
                  className={`p-4 rounded-2xl border text-sm text-white flex items-start justify-between gap-3 ${
                    activeStoreId === store.id
                      ? 'border-ninpo-lime/60 bg-ninpo-lime/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-black text-white">{store.name}</p>
                      {store.isPrimarySupplier && (
                        <span className="text-[10px] uppercase tracking-widest bg-ninpo-lime/20 text-ninpo-lime px-2 py-0.5 rounded-full">
                          Primary supplier
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{formatStoreType(store.storeType)}</p>
                    <p className="text-xs text-slate-400 mt-1">{location || 'No location metadata'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={() => setActiveStoreId(store.id)}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        activeStoreId === store.id
                          ? 'bg-ninpo-lime text-ninpo-black border-ninpo-lime'
                          : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {activeStoreId === store.id ? 'Active' : 'Set Active'}
                    </button>
                    <button
                      onClick={() => void handlePrimarySupplierToggle(store)}
                      disabled={isUpdating || isDeleting}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        store.isPrimarySupplier
                          ? 'bg-ninpo-lime/20 text-ninpo-lime border-ninpo-lime/40'
                          : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                      } ${isUpdating || isDeleting ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      <span className={isUpdating ? 'ml-2' : ''}>
                        {store.isPrimarySupplier ? 'Primary supplier' : 'Set primary'}
                      </span>
                    </button>
                    <button
                      onClick={() => void handleDeleteStore(store)}
                      disabled={isDeleting}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border flex items-center gap-2 ${
                        isDeleting
                          ? 'opacity-60 cursor-not-allowed'
                          : 'bg-red-500/20 text-red-200 border-red-500/40 hover:bg-red-500/30'
                      }`}
                    >
                      {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                    {store.createdFrom && (
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{store.createdFrom}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!stores.length && !isLoading && (
              <div className="text-xs text-slate-400">No stores yet. Create your first store above.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManagementStores;
