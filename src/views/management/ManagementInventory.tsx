import React from 'react';
import { Plus, Loader2, ScanLine, X } from 'lucide-react';
import { Product, SizeUnit, UpcItem } from '../../types';
import { ScannerMode } from '../../types';

interface ManagementInventoryProps {
  scannerMode: ScannerMode;
  setScannerMode: (mode: ScannerMode) => void;
  scannerModalOpen: boolean;
  setScannerModalOpen: (open: boolean) => void;
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

const ManagementInventory: React.FC<ManagementInventoryProps> = ({
  scannerMode,
  setScannerMode,
  scannerModalOpen,
  setScannerModalOpen,
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
          Inventory
        </h2>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
          Manage products, stock, and create new items.
        </p>
      </div>

      <div className="bg-ninpo-card p-8 rounded-[3rem] border border-white/5 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Scanner controls
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setScannerMode(ScannerMode.INVENTORY_CREATE);
                setScannerModalOpen(true);
              }}
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
            {scannerModalOpen && scannerMode === ScannerMode.INVENTORY_CREATE && (
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



        <div className="flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 text-[10px] text-slate-500 uppercase tracking-widest">
            Scan a UPC to create products via the bottom sheet scanner interface. All product creation now happens in the scanner modal.
          </div>
        </div>

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

export default ManagementInventory;
