import React from 'react';
import { Plus, Loader2, ScanLine, X } from 'lucide-react';
import { Product, SizeUnit, UpcItem } from '../../types';
import { ScannerMode } from '../../types';

interface ManagementReturnsProps {
  scannerMode: ScannerMode;
  scannerModalOpen: boolean;
  setScannerModalOpen: (open: boolean) => void;
  openUnifiedScannerModal: (mode: ScannerMode) => void;
  lastBlockedUpc: string | null;
  lastBlockedReason: 'cooldown' | 'duplicate' | null;
  handleScannerScan: (upc: string) => void;
  setLastBlockedUpc: (upc: string | null) => void;
  setLastBlockedReason: (reason: 'cooldown' | 'duplicate' | null) => void;
  scannedUpcForCreation: string;
  handleManualUpcChange: (value: string) => void;
  fetchOffLookup: (upc: string) => void;
  offLookupStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error';
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
  apiCreateProduct: (upcOverride?: string) => Promise<any>;
  isCreating: boolean;
  inventorySort: 'alpha' | 'price' | 'brand' | 'type' | 'storage-zone' | 'storage-bin';
  setInventorySort: (
    sort: 'alpha' | 'price' | 'brand' | 'type' | 'storage-zone' | 'storage-bin'
  ) => void;
  sortedProducts: Product[];
  startEditProduct: (product: Product) => void;
  apiRestockPlus10: (id: string, currentStock: number) => void;
  apiDeleteProduct: (id: string) => void;
  formatSize: (value: number, unit?: SizeUnit) => string;
}

const ManagementReturns: React.FC<ManagementReturnsProps> = ({
  scannerMode,
  scannerModalOpen,
  setScannerModalOpen,
  openUnifiedScannerModal,
  lastBlockedUpc,
  lastBlockedReason,
  handleScannerScan,
  setLastBlockedUpc,
  setLastBlockedReason,
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
  inventorySort,
  setInventorySort,
  sortedProducts,
  startEditProduct,
  apiRestockPlus10,
  apiDeleteProduct,
  formatSize
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black uppercase text-white tracking-widest">
          Return Reviews
        </h2>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
          Review driver-submitted container verifications and approve settlements.
        </p>
      </div>

      <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Scanner controls
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => openUnifiedScannerModal(ScannerMode.UPC_LOOKUP)}
              className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-neon"
            >
              <ScanLine className="w-4 h-4" />
              Scan
            </button>
            {lastBlockedUpc && lastBlockedReason === 'duplicate' && (
              <button
                onClick={() => handleScannerScan(lastBlockedUpc)}
                className="px-4 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-white/10"
              >
                Add anyway
              </button>
            )}
            {scannerModalOpen && scannerMode === ScannerMode.UPC_LOOKUP && (
              <button
                onClick={() => {
                  setScannerModalOpen(false);
                  setLastBlockedUpc(null);
                  setLastBlockedReason(null);
                }}
                className="px-4 py-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-ninpo-red/20 hover:bg-ninpo-red/20 transition"
              >
                <X className="w-4 h-4" />
                Close
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Scanned UPC:{' '}
            <span className="text-white">{scannedUpcForCreation || 'No UPC scanned'}</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end gap-2">
            <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 flex-1">
              <span>UPC (editable)</span>
              <input
                id="scannedUpcForCreation"
                name="scannedUpcForCreation"
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
          </div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Tip: Use Clear UPC to restart without reopening the scanner.
          </div>
          {offLookupMessage && (
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {offLookupMessage}
            </div>
          )}
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

            {createError && (
              <div className="bg-ninpo-card p-4 rounded-2xl border border-ninpo-red/20 text-[11px] text-ninpo-red">
                {createError}
              </div>
            )}

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
                  onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
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
                  placeholder="Auto-calculated"
                  value={upcDraft.isEligible ? '0.10' : '0.00'}
                  disabled
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
                  onChange={e => setNewProduct({ ...newProduct, brand: e.target.value })}
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
                  onChange={e => setNewProduct({ ...newProduct, storageBin: e.target.value })}
                />
              </label>
              <label className="space-y-2 text-[10px] font-black uppercase tracking-widest text-slate-600 md:col-span-2">
                <span>Image URL</span>
                <input
                  className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white w-full"
                  placeholder="https://"
                  value={newProduct.image}
                  onChange={e => setNewProduct({ ...newProduct, image: e.target.value })}
                />
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <input
                  type="checkbox"
                  checked={upcDraft.isEligible}
                  onChange={e => setUpcDraft({ ...upcDraft, isEligible: e.target.checked })}
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
                Create
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-6 border-t border-white/5 text-[10px] text-slate-500 uppercase tracking-widest">
            Scan a UPC to open the product details before creating.
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
            Inventory List
          </p>
          <label className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-600">
            <span>Sort</span>
            <select
              value={inventorySort}
              onChange={e =>
                setInventorySort(
                  e.target.value as
                    | 'alpha'
                    | 'price'
                    | 'brand'
                    | 'type'
                    | 'storage-zone'
                    | 'storage-bin'
                )
              }
              className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white"
            >
              <option value="alpha">Alphabetical (A-Z)</option>
              <option value="price">Price</option>
              <option value="brand">Brand (A-Z)</option>
              <option value="type">Product Type</option>
              <option value="storage-zone">Storage Zone</option>
              <option value="storage-bin">Storage Bin</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {sortedProducts.map(p => (
            <div
              key={p.id}
              className="bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
            >
              <div>
                <p className="text-white font-black">{p.name}</p>
                <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                  SKU: {p.sku || p.id} • Stock: {p.stock} • {formatSize(p.sizeOz, p.sizeUnit)} • $
                  {Number(p.price || 0).toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-1">
                  {p.brand || 'No Brand'} • {p.productType || 'No Type'} •{' '}
                  {p.storageZone || 'No Zone'} / {p.storageBin || 'No Bin'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => startEditProduct(p)}
                  className="px-6 py-3 rounded-2xl bg-white/5 text-white/70 text-[10px] font-black uppercase tracking-widest border border-white/10"
                >
                  Edit
                </button>
                <button
                  onClick={() => apiRestockPlus10(p.id, p.stock)}
                  className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                >
                  +10 Stock
                </button>
                <button
                  onClick={() => apiDeleteProduct(p.id)}
                  className="px-6 py-3 rounded-2xl bg-ninpo-red/10 text-ninpo-red text-[10px] font-black uppercase tracking-widest border border-ninpo-red/20"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ManagementReturns;
