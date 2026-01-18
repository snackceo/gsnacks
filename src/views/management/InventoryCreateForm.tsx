import React from 'react';
import { Plus, Loader2, ScanLine, X } from 'lucide-react';
import { Product, SizeUnit, UpcItem } from '../../types';
import { useNinpoCore } from '../../hooks/useNinpoCore';

interface InventoryCreateFormProps {
  scannedUpcForCreation: string;
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
}

const InventoryCreateForm: React.FC<InventoryCreateFormProps> = ({
  scannedUpcForCreation,
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
}) => {
  const { addToast } = useNinpoCore();
  const [isAddingUpc, setIsAddingUpc] = React.useState(false);
  const [addUpcError, setAddUpcError] = React.useState<string | null>(null);
  const [addUpcSuccess, setAddUpcSuccess] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          Scanned UPC: <span className="text-white">{scannedUpcForCreation || 'No UPC scanned'}</span>
        </div>
        <div className="flex flex-col md:flex-row md:items-end gap-2">
          <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 flex-1">
            <span>UPC (editable)</span>
            <input
              className="bg-black/40 border border-white/10 rounded-2xl p-3 text-sm text-white w-full"
              placeholder="Scan or type UPC"
              value={scannedUpcForCreation}
              onChange={e => handleManualUpcChange(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              if (scannedUpcForCreation) {
                void fetchOffLookup(scannedUpcForCreation);
              }
            }}
            disabled={!scannedUpcForCreation || offLookupStatus === 'loading'}
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
            className="px-4 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Clear UPC
          </button>
          <button
            onClick={async () => {
              setIsAddingUpc(true);
              setAddUpcError(null);
              setAddUpcSuccess(null);
              try {
                const res = await fetch('/api/upc', {
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
                if (res.status === 409) {
                  setAddUpcError('UPC already in registry');
                  addToast('UPC already in registry', 'error');
                } else if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  setAddUpcError(data?.error || 'Failed to add to registry');
                  addToast(data?.error || 'Failed to add to registry', 'error');
                } else {
                  setAddUpcSuccess('Added to UPC Registry!');
                  addToast('Added to UPC Registry!', 'success');
                }
              } catch (err: any) {
                setAddUpcError(err?.message || 'Failed to add to registry');
                addToast(err?.message || 'Failed to add to registry', 'error');
              } finally {
                setIsAddingUpc(false);
              }
            }}
            disabled={isAddingUpc || !scannedUpcForCreation}
            className="px-4 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ScanLine className="w-4 h-4" /> Add to UPC Registry
          </button>
        </div>
        {addUpcSuccess && addToast(addUpcSuccess, 'success')}
        {addUpcError && addToast(addUpcError, 'error')}
        {/* Remove inline messages, rely on toast only */}
        {offLookupMessage && (
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {offLookupMessage}
          </div>
        )}
        {createError && addToast(createError, 'error')}
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 text-[10px] text-slate-500 uppercase tracking-widest">
          Scan a UPC to auto-fill product details from Open Food Facts, then review and edit before
          creating.
        </div>
      </div>

      {scannedUpcForCreation ? (
        <div className="pt-6 border-t border-white/5 space-y-6">
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
                  setNewProduct({ ...newProduct, name: e.target.value })
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
                  setNewProduct({ ...newProduct, price: Number(e.target.value) })
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
                  setUpcDraft({ ...upcDraft, depositValue: val });
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
              disabled={isCreating}
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
