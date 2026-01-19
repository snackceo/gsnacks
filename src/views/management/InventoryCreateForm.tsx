import React from 'react';
import { Plus, Loader2, ScanLine, X } from 'lucide-react';
import { Product, SizeUnit, UpcItem } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';
import { BACKEND_URL } from '../../constants';

interface InventoryCreateFormProps {
  scannedUpcForCreation: string;
  setScannedUpcForCreation?: (upc: string) => void;
  handleManualUpcChange: (value: string) => void;
  fetchOffLookup: (upc: string) => void;
  offLookupStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error';
  handleAddToUpcRegistry: () => void;
  offLookupMessage: string;
  createError: string | null;
  newProduct: Product;
  setNewProduct: (product: Product) => void;
  upcDraft: UpcItem;
  setUpcDraft: (draft: UpcItem) => void;
  sizeUnitOptions: SizeUnit[];
  offLookupIngredients: string;
  offNutritionEntries: Array<{ label: string; value: string }>;
  handleCancelCreate: () => void;
  apiCreateProduct: () => Promise<any>;
  isCreating: boolean;
  // Draft state management
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  pendingUpc: string | null;
  setPendingUpc: (upc: string | null) => void;
  draftStatus: 'idle' | 'scanned' | 'editing' | 'savingUpc' | 'savingInventory' | 'saved' | 'error';
  setDraftStatus: (status: any) => void;
  batchMode: boolean;
  toggleBatchMode: (on: boolean) => void;
  batchQueue: Array<{ id: string; upc: string; status: 'queued' | 'saved' | 'failed'; containerType: 'plastic' | 'aluminum' | 'glass'; error?: string }>;
  setBatchQueue: React.Dispatch<
    React.SetStateAction<
      Array<{ id: string; upc: string; status: 'queued' | 'saved' | 'failed'; containerType: 'plastic' | 'aluminum' | 'glass'; error?: string }>
    >
  >;
  addBatchQueueToRegistry: () => Promise<{ successCount: number; failCount: number }>;
}

const InventoryCreateForm: React.FC<InventoryCreateFormProps> = ({
  scannedUpcForCreation,
  setScannedUpcForCreation,
  handleManualUpcChange,
  fetchOffLookup,
  offLookupStatus,
  offLookupMessage,
  createError,
  newProduct,
  setNewProduct,
  upcDraft,
  setUpcDraft,
  sizeUnitOptions,
  offLookupIngredients,
  offNutritionEntries,
  handleCancelCreate,
  apiCreateProduct,
  isCreating,
  isDirty,
  setIsDirty,
  pendingUpc,
  setPendingUpc,
  draftStatus,
  setDraftStatus,
  batchMode,
  toggleBatchMode,
  batchQueue,
  setBatchQueue,
  addBatchQueueToRegistry,
}) => {
  const { addToast } = useNinpoCore();
  const [isAddingUpc, setIsAddingUpc] = React.useState(false);

  React.useEffect(() => {
    if (createError) {
      addToast(createError, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createError]);

  React.useEffect(() => {
    if (pendingUpc) {
      addToast(`New UPC scanned: ${pendingUpc}. Tap "Use New Scan" to switch.`, 'info');
    }
  }, [pendingUpc, addToast]);

  React.useEffect(() => {
    if (draftStatus === 'saved') {
      addToast('Inventory item saved successfully!', 'success');
    }
  }, [draftStatus, addToast]);

  const handleUseNewScan = () => {
    if (!pendingUpc) return;
    setScannedUpcForCreation?.(pendingUpc);
    handleManualUpcChange(pendingUpc);
    setPendingUpc(null);
    setIsDirty(false);
    setDraftStatus('scanned');
    setNewProduct(prev => ({
      ...prev,
      name: '',
      brand: '',
      productType: '',
      nutritionNote: '',
      storageZone: '',
      storageBin: '',
      image: '',
      stock: 0,
      price: 0,
      sizeOz: 0,
      sizeUnit: 'oz',
      isGlass: false
    }));
    setUpcDraft(prev => ({
      ...prev,
      upc: pendingUpc,
      name: '',
      price: 0,
      depositValue: 0.1,
      containerType: 'plastic',
      sizeOz: 0,
      sizeUnit: 'oz',
      isEligible: true
    }));
  };

  const handleFieldChange = (onChange: () => void) => {
    setIsDirty(true);
    setDraftStatus('editing');
    onChange();
  };

  const handleBatchCommit = async () => {
    const result = await addBatchQueueToRegistry();
    if (result.successCount && result.failCount) {
      addToast(`Added ${result.successCount}, failed ${result.failCount}`, 'warning');
    } else if (result.successCount) {
      addToast(`Added ${result.successCount} UPCs`, 'success');
    } else if (result.failCount) {
      addToast(`Failed ${result.failCount} UPCs`, 'error');
    }
  };

  const handleRemoveQueued = (id: string) => {
    setBatchQueue(batchQueue.filter(item => item.id !== id));
  };

  const handleContainerChange = (id: string, value: 'plastic' | 'aluminum' | 'glass') => {
    setBatchQueue(
      batchQueue.map(item => (item.id === id ? { ...item, containerType: value, error: undefined } : item))
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          Scanned UPC: <span className="text-white">{scannedUpcForCreation || 'No UPC scanned'}</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-end gap-2">
          <div className="flex items-center justify-between w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Batch UPC capture
            </div>
            <button
              type="button"
              onClick={() => toggleBatchMode(!batchMode)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition ${
                batchMode ? 'bg-ninpo-lime' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-black shadow transition ${
                  batchMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 flex-1">
            <span>UPC (editable)</span>
            <input
              className="bg-black/40 border border-white/10 rounded-2xl p-3 text-sm text-white w-full"
              placeholder="Scan or type UPC"
              value={scannedUpcForCreation}
              onChange={e => handleManualUpcChange(e.target.value)}
              disabled={batchMode}
            />
          </label>
          <button
            onClick={() => {
              if (scannedUpcForCreation) {
                void fetchOffLookup(scannedUpcForCreation);
              }
            }}
            disabled={batchMode || !scannedUpcForCreation || offLookupStatus === 'loading'}
            className="px-4 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {offLookupStatus === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ScanLine className="w-4 h-4" />
            )}
            Lookup OFF
          </button>
          <button
            onClick={() => handleManualUpcChange('')}
            disabled={batchMode}
            className="px-4 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
            Clear UPC
          </button>
          <button
            onClick={async () => {
              if (batchMode) {
                setIsAddingUpc(true);
                await handleBatchCommit();
                setIsAddingUpc(false);
                return;
              }
              setIsAddingUpc(true);
              try {
                const res = await fetch(`${BACKEND_URL}/api/upc`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    upc: scannedUpcForCreation,
                    name: upcDraft.name || newProduct.name,
                    brand: newProduct.brand,
                    productType: newProduct.productType,
                    depositValue: upcDraft.depositValue ?? (upcDraft.isEligible ? 0.1 : 0),
                    price: Number(newProduct.price),
                    sizeOz: Number(newProduct.sizeOz),
                    sizeUnit: newProduct.sizeUnit,
                    isEligible: upcDraft.isEligible,
                    containerType: upcDraft.containerType
                  })
                });
                let data: any = {};
                try {
                  data = await res.json();
                } catch {}
                if (res.status === 409) {
                  addToast('UPC already in registry', 'error');
                } else if (!res.ok) {
                  addToast((typeof data === 'object' && data !== null && 'error' in data ? data.error : undefined) || 'Failed to add to registry', 'error');
                } else if (typeof data === 'object' && data !== null && 'ok' in data && data.ok) {
                  addToast('Successfully added to registry', 'success');
                  handleManualUpcChange('');
                } else {
                  addToast('Unexpected response from server', 'error');
                }
              } catch (err) {
                addToast(err?.message || 'Failed to add to registry', 'error');
              } finally {
                setIsAddingUpc(false);
              }
            }}
            disabled={isAddingUpc || (batchMode ? batchQueue.length === 0 : !scannedUpcForCreation)}
            className="px-4 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ScanLine className="w-4 h-4" /> {batchMode ? 'Add All to UPC Registry' : 'Add to UPC Registry'}
          </button>
        </div>
        {/* Remove inline messages, rely on toast only */}
        {offLookupMessage && (
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {offLookupMessage}
          </div>
        )}
        {/* Error toast handled by useEffect, not inline */}
      </div>

      {batchMode && (
        <div className="space-y-3 bg-black/40 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-black uppercase tracking-widest text-white">
              Queued UPCs ({batchQueue.length})
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Scan to add • Select container • Commit all
            </div>
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
            {batchQueue.length === 0 && (
              <div className="text-center py-8 text-[11px] text-slate-500 uppercase tracking-widest">
                Scan barcodes to add UPCs to the queue.
              </div>
            )}
            {batchQueue.map(item => (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-2xl p-4 border-2 ${
                  item.status === 'saved'
                    ? 'bg-ninpo-lime/10 border-ninpo-lime/30'
                    : item.status === 'failed'
                    ? 'bg-ninpo-red/10 border-ninpo-red/30'
                    : 'bg-black/50 border-white/10'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-black">{item.upc}</p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 truncate">
                    {item.status === 'saved' ? '✓ Saved' : item.status === 'failed' ? '✗ Failed' : 'Queued'}
                    {item.error ? ` • ${item.error}` : ''}
                  </p>
                </div>
                <select
                  className="bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-xs text-white font-bold uppercase tracking-widest"
                  value={item.containerType}
                  onChange={e =>
                    handleContainerChange(item.id, e.target.value as 'plastic' | 'aluminum' | 'glass')
                  }
                  disabled={item.status !== 'queued'}
                >
                  <option value="plastic">Plastic</option>
                  <option value="aluminum">Aluminum</option>
                  <option value="glass">Glass</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleRemoveQueued(item.id)}
                  disabled={item.status !== 'queued'}
                  className="p-2 rounded-xl bg-ninpo-red/20 text-ninpo-red hover:bg-ninpo-red/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 text-[10px] text-slate-500 uppercase tracking-widest">
          {batchMode
            ? 'Batch mode enabled: scan multiple UPCs, select containers, then commit all at once.'
            : 'Scan a UPC to auto-fill product details from Open Food Facts, then review and edit before creating.'}
        </div>
      </div>

      {scannedUpcForCreation ? (
        <div className={`pt-6 border-t border-white/5 space-y-6 ${batchMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                Create Product
              </p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                Storage zone/bin describe where the item sits (e.g., Fridge / Shelf A).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>SKU</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full disabled:opacity-50"
                placeholder="Auto-generated on creation"
                value=""
                disabled
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Name</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="Product name"
                value={newProduct.name}
                onChange={e =>
                  handleFieldChange(() => setNewProduct({ ...newProduct, name: e.target.value }))
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Price</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="0.00"
                type="number"
                value={newProduct.price}
                onChange={e =>
                  handleFieldChange(() => setNewProduct({ ...newProduct, price: Number(e.target.value) }))
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Deposit</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="0.00"
                type="number"
                value={upcDraft.depositValue ?? (upcDraft.isEligible ? 0.1 : 0)}
                onChange={e => {
                  const val = Number(e.target.value);
                  handleFieldChange(() => setUpcDraft({ ...upcDraft, depositValue: val }));
                }}
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Stock</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="0"
                type="number"
                value={newProduct.stock}
                onChange={e =>
                  setNewProduct({ ...newProduct, stock: Number(e.target.value) })
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Size</span>
              <div className="flex gap-2">
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                  placeholder="0"
                  type="number"
                  step="0.1"
                  value={newProduct.sizeOz}
                  onChange={e =>
                    setNewProduct({ ...newProduct, sizeOz: Number(e.target.value) })
                  }
                />
                <select
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white"
                  value={newProduct.sizeUnit}
                  onChange={e =>
                    setNewProduct({
                      ...newProduct,
                      sizeUnit: e.target.value as SizeUnit
                    })
                  }
                >
                  {sizeUnitOptions.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Brand</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="Brand"
                value={newProduct.brand}
                onChange={e =>
                  setNewProduct({ ...newProduct, brand: e.target.value })
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Product Type</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="Type"
                value={newProduct.productType}
                onChange={e =>
                  setNewProduct({ ...newProduct, productType: e.target.value })
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
              <span>Nutrition Note (Customer Info)</span>
              <textarea
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full min-h-[96px]"
                placeholder="e.g. 12g protein • 220 calories • contains peanuts"
                value={newProduct.nutritionNote}
                onChange={e =>
                  setNewProduct({
                    ...newProduct,
                    nutritionNote: e.target.value
                  })
                }
              />
            </label>
            {(offLookupIngredients || offNutritionEntries.length > 0) && (
              <div className="md:col-span-2 bg-black/30 border border-white/10 rounded-2xl p-4 space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Open Food Facts (read-only)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Ingredients
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed">
                      {offLookupIngredients || 'No ingredients provided.'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Nutrition (per 100g)
                    </div>
                    {offNutritionEntries.length > 0 ? (
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-200">
                        {offNutritionEntries.map(entry => (
                          <div key={entry.label} className="flex items-center justify-between gap-4">
                            <dt className="text-slate-400">{entry.label}</dt>
                            <dd className="text-slate-200">{entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-slate-200">No nutrition values provided.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Storage Zone</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="Zone"
                value={newProduct.storageZone}
                onChange={e =>
                  setNewProduct({
                    ...newProduct,
                    storageZone: e.target.value
                  })
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
              <span>Storage Bin</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="Bin"
                value={newProduct.storageBin}
                onChange={e =>
                  setNewProduct({ ...newProduct, storageBin: e.target.value })
                }
              />
            </label>
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
              <span>Image URL</span>
              <input
                className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                placeholder="https://"
                value={newProduct.image}
                onChange={e =>
                  setNewProduct({ ...newProduct, image: e.target.value })
                }
              />
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <input
                type="checkbox"
                checked={upcDraft.isEligible}
                onChange={e =>
                  setUpcDraft({ ...upcDraft, isEligible: e.target.checked })
                }
              />
              Eligible for Michigan Deposit Refund
            </label>
          </div>

          {/* Show pending UPC notification and button */}
          {pendingUpc && (
            <div className="bg-ninpo-red/20 border border-ninpo-red/40 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-ninpo-red">
                New UPC Scanned: {pendingUpc}
              </p>
              <button
                onClick={handleUseNewScan}
                className="w-full py-3 bg-ninpo-red/40 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-ninpo-red/60 transition border border-ninpo-red/40"
              >
                <ScanLine className="w-4 h-4" />
                Use New Scan
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCancelCreate}
              className="w-full py-5 bg-ninpo-red/10 text-ninpo-red rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
            >
              <X className="w-5 h-5" />
              Cancel
            </button>
            <button
              onClick={apiCreateProduct}
              disabled={isCreating || batchMode}
              className="w-full py-5 bg-ninpo-lime text-ninpo-black rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.01] transition-all shadow-neon"
            >
              {isCreating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Plus className="w-5 h-5" />
              )}
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-6 border-t border-white/5 text-[10px] text-slate-500 uppercase tracking-widest">
          Scan a UPC to open the product details before creating.
        </div>
      )}
    </div>
  );
}

export default InventoryCreateForm;
