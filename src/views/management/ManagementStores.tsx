import React, { useCallback, useMemo, useState } from 'react';
import { Wand2, MapPin, RefreshCw, Loader2, CheckCircle2, Camera, Check } from 'lucide-react';
import { BACKEND_URL } from '../../constants';
import { StoreRecord, ScannerMode, ClassifiedReceiptItem, ReceiptItemClassification } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import ReceiptCaptureFlow from '../../components/ReceiptCaptureFlow';
import ReceiptItemBucket from '../../components/ReceiptItemBucket';
import { uploadReceiptPhoto } from '../../utils/cloudinaryUtils';
import { classifyItems } from '../../utils/classificationUtils';

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
  const [showReceiptScanner, setShowReceiptScanner] = useState(false);
  const [classifiedItems, setClassifiedItems] = useState<ClassifiedReceiptItem[]>([]);
  const [showReceiptReview, setShowReceiptReview] = useState(false);
  const [selectedItemsForCommit, setSelectedItemsForCommit] = useState<Map<string, boolean>>(new Map());
  const [isCommitting, setIsCommitting] = useState(false);
  const [primarySupplierUpdatingId, setPrimarySupplierUpdatingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreRecord>({
    id: '',
    name: '',
    address: { ...emptyAddress },
    storeType: 'other'
  });

  const activeStore = useMemo(() => stores.find(s => s.id === activeStoreId) || null, [stores, activeStoreId]);

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
      addToast({ title: 'Enriched', description: 'Gemini filled the address.', tone: 'success' });
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
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      await refreshStores();
      if (data.store?.id) {
        setActiveStoreId(data.store.id);
      }
      addToast({ title: 'Saved', description: `${name} saved`, tone: 'success' });
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [addToast, draft.address, draft.phone, draft.location, draft.storeType, draft.name, refreshStores, setActiveStoreId, setError]);

  const handleOpenReceiptScanner = useCallback(() => {
    if (!activeStoreId) {
      setError('Please set an active store before capturing receipts');
      return;
    }
    setShowReceiptScanner(true);
  }, [activeStoreId, setError]);

  const handleCloseReceiptScanner = useCallback(() => {
    setShowReceiptScanner(false);
  }, []);

  const handlePhotoCaptured = useCallback(async (photoDataUrl: string, _mime: string) => {
    if (!activeStoreId || !activeStore) return;

    try {
      // Upload to Cloudinary
      const uploadResult = await uploadReceiptPhoto(photoDataUrl, activeStoreId, activeStore.name);

      if (!uploadResult) {
        setError('Cloudinary not configured. Please set up image uploads.');
        return;
      }

      addToast({ title: 'Uploaded', description: 'Receipt image uploaded to Cloudinary', tone: 'success' });

      // Send to backend for Gemini parsing
      const parseRes = await fetch(`${BACKEND_URL}/api/driver/receipt-parse-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          image: photoDataUrl,
          storeId: activeStoreId,
          storeName: activeStore.name,
          receiptImageUrl: uploadResult.secureUrl,
          receiptPublicId: uploadResult.publicId
        })
      });

      const parseData = await parseRes.json().catch(() => ({}));

      if (!parseRes.ok) {
        throw new Error(parseData?.error || 'Receipt parsing failed');
      }

      if (!parseData.items || parseData.items.length === 0) {
        addToast({
          title: 'No items',
          description: 'No items were found in this receipt',
          tone: 'info'
        });
        setShowReceiptScanner(false);
        return;
      }

      // Classify items into buckets
      const { items: classified, bucketCounts } = classifyItems(parseData.items);
      setClassifiedItems(classified);

      addToast({
        title: 'Parsed & Classified',
        description: `Found ${parseData.items.length} items: ${bucketCounts.A} auto-update, ${bucketCounts.B} review, ${bucketCounts.C} no-match, ${bucketCounts.D} noise`,
        tone: 'success'
      });

      // Show review screen
      setShowReceiptScanner(false);
      setShowReceiptReview(true);
    } catch (err: any) {
      console.error('Receipt capture error:', err);
      setError(err?.message || 'Failed to process receipt');
    }
  }, [activeStoreId, activeStore, addToast, setError]);

  const handleStoreSelected = useCallback(
    (storeId: string) => {
      setActiveStoreId(storeId);
    },
    [setActiveStoreId]
  );

  const handleItemToggle = useCallback(
    (item: ClassifiedReceiptItem, _classification: ReceiptItemClassification, checked: boolean) => {
      const key = JSON.stringify(item);
      const newSelected = new Map(selectedItemsForCommit);
      if (checked) {
        newSelected.set(key, true);
      } else {
        newSelected.delete(key);
      }
      setSelectedItemsForCommit(newSelected);
    },
    [selectedItemsForCommit]
  );

  const handleItemReclassify = useCallback(
    (item: ClassifiedReceiptItem, classification: ReceiptItemClassification) => {
      setClassifiedItems(prev =>
        prev.map(prevItem => (prevItem === item ? { ...prevItem, classification } : prevItem))
      );
      setSelectedItemsForCommit(prev => {
        const newSelected = new Map(prev);
        const oldKey = JSON.stringify(item);
        const wasSelected = newSelected.has(oldKey);
        if (wasSelected) {
          newSelected.delete(oldKey);
        }
        const updatedItem = { ...item, classification };
        const newKey = JSON.stringify(updatedItem);
        if (wasSelected) {
          newSelected.set(newKey, true);
        }
        return newSelected;
      });
    },
    [setClassifiedItems, setSelectedItemsForCommit]
  );

  const handleCommitReceipt = useCallback(async () => {
    if (!activeStoreId || selectedItemsForCommit.size === 0) {
      setError('No items selected for commit');
      return;
    }

    setIsCommitting(true);
    try {
      // Collect selected items
      const itemsToCommit = classifiedItems.filter(item =>
        selectedItemsForCommit.has(JSON.stringify(item))
      );

      // Send to backend for two-phase commit
      const commitRes = await fetch(`${BACKEND_URL}/api/stores/${activeStoreId}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: itemsToCommit.map(item => ({
            receiptName: item.receiptName,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            unitPrice: item.unitPrice,
            classification: item.classification
          }))
        })
      });

      const commitData = await commitRes.json().catch(() => ({}));

      if (!commitRes.ok) {
        throw new Error(commitData?.error || 'Commit failed');
      }

      addToast({
        title: 'Committed',
        description: `${itemsToCommit.length} items added to ${activeStore?.name} inventory`,
        tone: 'success'
      });

      // Close review and reset
      setShowReceiptReview(false);
      setClassifiedItems([]);
      setSelectedItemsForCommit(new Map());
    } catch (err: any) {
      console.error('Commit error:', err);
      setError(err?.message || 'Failed to commit items');
    } finally {
      setIsCommitting(false);
    }
  }, [activeStoreId, activeStore, classifiedItems, selectedItemsForCommit, addToast, setError]);

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
      if (!res.ok) throw new Error(data?.error || 'Failed to update primary supplier');

      await refreshStores();
      addToast({
        title: 'Updated',
        description: `${store.name} ${store.isPrimarySupplier ? 'removed from' : 'set as'} primary supplier`,
        tone: 'success'
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to update primary supplier');
    } finally {
      setPrimarySupplierUpdatingId(null);
    }
  }, [addToast, refreshStores, setError]);

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
                      disabled={isUpdating}
                      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        store.isPrimarySupplier
                          ? 'bg-ninpo-lime/20 text-ninpo-lime border-ninpo-lime/40'
                          : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                      } ${isUpdating ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      <span className={isUpdating ? 'ml-2' : ''}>
                        {store.isPrimarySupplier ? 'Primary supplier' : 'Set primary'}
                      </span>
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

          {activeStore && (
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-slate-300">
              Active store: <span className="text-white font-semibold">{activeStore.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Receipt Capture Section */}
      {activeStore && (
        <div className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-black uppercase text-xs tracking-widest">
              <Camera className="w-4 h-4" /> Capture Receipt
            </div>
          </div>
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">
            Capture and scan receipts for <span className="text-ninpo-lime">{activeStore.name}</span>. Items will be automatically classified for review.
          </p>
          <button
            onClick={handleOpenReceiptScanner}
            className="w-full px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-ninpo-lime/90 shadow-neon"
          >
            <Camera className="w-4 h-4" />
            Open Receipt Scanner
          </button>
        </div>
      )}

      {/* Receipt Capture Flow Modal */}
      {showReceiptScanner && (
        <ReceiptCaptureFlow
          isOpen={showReceiptScanner}
          mode={ScannerMode.RECEIPT_PARSE_LIVE}
          stores={stores}
          defaultStoreId={activeStoreId}
          title="Receipt Scanner"
          subtitle="Capture receipt with barcode"
          onPhotoCaptured={handlePhotoCaptured}
          onClose={handleCloseReceiptScanner}
          showClose={true}
          onStoreSelected={handleStoreSelected}
        />
      )}

      {/* Receipt Review Section */}
      {showReceiptReview && classifiedItems.length > 0 && (
        <div className="fixed inset-0 z-50 bg-ninpo-black/95 backdrop-blur-sm p-4 flex items-center justify-center overflow-y-auto">
          <div className="bg-ninpo-card rounded-[2.5rem] border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="border-b border-white/10 p-6 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase text-white tracking-widest">Receipt Review</h2>
                <button
                  onClick={() => setShowReceiptReview(false)}
                  className="text-slate-400 hover:text-white transition p-2"
                >
                  ✕
                </button>
              </div>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                Items from <span className="text-ninpo-lime">{activeStore?.name}</span> classified into four buckets
              </p>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-6">
              <ReceiptItemBucket
                items={classifiedItems}
                selectedItems={selectedItemsForCommit}
                onItemToggle={handleItemToggle}
                onItemReclassify={handleItemReclassify}
                isReadOnly={false}
              />
            </div>

            {/* Summary */}
            <div className="border-t border-white/10 px-6 py-4 bg-white/5">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                Selected {selectedItemsForCommit.size} of {classifiedItems.length} items for commit
              </p>
            </div>

            {/* Actions */}
            <div className="border-t border-white/10 px-6 py-4 flex gap-3">
              <button
                onClick={() => setShowReceiptReview(false)}
                className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                onClick={handleCommitReceipt}
                disabled={isCommitting || selectedItemsForCommit.size === 0}
                className={`flex-1 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                  selectedItemsForCommit.size === 0
                    ? 'bg-white/5 text-slate-500 border border-white/10'
                    : 'bg-ninpo-lime text-ninpo-black'
                } ${isCommitting ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {isCommitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {isCommitting ? 'Committing…' : 'Commit Selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagementStores;
