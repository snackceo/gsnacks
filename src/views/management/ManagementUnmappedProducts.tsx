import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, EyeOff, Search, XCircle } from 'lucide-react';
import { apiFetch } from '../../utils/apiFetch';
import {
  PriceObservation,
  Product,
  StoreRecord,
  UnmappedProduct,
  UnmappedProductStatus
} from '../../types';

interface MappingHistoryEntry {
  _id: string;
  action: 'MAPPED' | 'IGNORED';
  productName?: string;
  productSku?: string;
  user?: string;
  at: string;
}

interface ManagementUnmappedProductsProps {
  stores: StoreRecord[];
  activeStoreId: string;
  setActiveStoreId: (id: string) => void;
  products: Product[];
  fmtTime: (iso?: string) => string;
}

const statusOptions: Array<{ value: UnmappedProductStatus | 'ALL'; label: string }> = [
  { value: 'NEW', label: 'Needs Review' },
  { value: 'MAPPED', label: 'Mapped' },
  { value: 'IGNORED', label: 'Ignored' },
  { value: 'ALL', label: 'All' }
];

const ManagementUnmappedProducts: React.FC<ManagementUnmappedProductsProps> = ({
  stores,
  activeStoreId,
  setActiveStoreId,
  products,
  fmtTime
}) => {
  // ✅ These MUST be inside the component (hooks can’t be at module scope)
  const [statusFilter, setStatusFilter] = useState<UnmappedProductStatus | 'ALL'>('NEW');
  const [search, setSearch] = useState('');

  // Toast state (fallback if no global toast)
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const showToast = (message: string, type: 'error' | 'success' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [mappingHistory, setMappingHistory] = useState<MappingHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Load mapping/audit history for selected unmapped product
  const loadMappingHistory = useCallback(async () => {
    if (!selectedId) return;
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await apiFetch<{ items: MappingHistoryEntry[]; error?: string }>(
        `/api/unmapped-products/${selectedId}/history`
      );
      if (data && data.error) throw new Error(data.error);
      setMappingHistory(Array.isArray(data?.items) ? data.items : []);
    } catch (err: any) {
      setHistoryError(err?.message || 'Failed to load mapping history');
    } finally {
      setIsHistoryLoading(false);
    }
  }, [selectedId]);

  const [unmappedProducts, setUnmappedProducts] = useState<UnmappedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [priceHistory, setPriceHistory] = useState<PriceObservation[]>([]);
  const [priceSort, setPriceSort] = useState<'desc' | 'asc'>('desc');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [migrateObservations, setMigrateObservations] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showConfirmMap, setShowConfirmMap] = useState(false);

  const selectedItem = useMemo(
    () => unmappedProducts.find(item => item._id === selectedId) || null,
    [unmappedProducts, selectedId]
  );

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 20);
    const term = productSearch.toLowerCase();
    return products
      .filter(product =>
        [product.name, product.sku, product.id || (product as any)._id]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(term))
      )
      .slice(0, 20);
  }, [products, productSearch]);

  const loadUnmappedProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeStoreId) params.append('storeId', activeStoreId);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (search.trim()) params.append('q', search.trim());

      const data = await apiFetch<{ items: UnmappedProduct[]; error?: string }>(
        `/api/unmapped-products?${params.toString()}`
      );
      if (data && data.error) throw new Error(data.error);

      const items = Array.isArray(data?.items) ? data.items : [];
      setUnmappedProducts(items);

      if (items.length && !items.find(item => item._id === selectedId)) {
        setSelectedId(items[0]._id);
      }
      if (!items.length) {
        setSelectedId(null);
        setPriceHistory([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load unmapped products');
    } finally {
      setIsLoading(false);
    }
  }, [activeStoreId, search, selectedId, statusFilter]);

  const loadPriceHistory = useCallback(async () => {
    if (!selectedId) return;
    setIsPriceLoading(true);
    setPriceHistoryError(null);
    try {
      const params = new URLSearchParams();
      params.append('unmappedProductId', selectedId);
      if (activeStoreId) params.append('storeId', activeStoreId);

      const data = await apiFetch<{ items: PriceObservation[]; error?: string }>(
        `/api/price-observations?${params.toString()}`
      );
      if (data && data.error) throw new Error(data.error);

      setPriceHistory(Array.isArray(data?.items) ? data.items : []);
    } catch (err: any) {
      setPriceHistoryError(err?.message || 'Failed to load price history');
    } finally {
      setIsPriceLoading(false);
    }
  }, [selectedId, activeStoreId]);

  const handleMap = useCallback(async () => {
    if (!selectedId || !selectedProductId) return;
    setIsUpdating(true);
    try {
      const data = await apiFetch<{ error?: string }>(`/api/unmapped-products/${selectedId}/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProductId,
          migrateObservations
        })
      });
      if (data && data.error) throw new Error(data.error);

      await loadUnmappedProducts();
      setSelectedProductId('');
      setProductSearch('');
      setMigrateObservations(false);
      setShowConfirmMap(false);
      showToast('Product mapped successfully', 'success');
    } catch (err: any) {
      setError(err?.message || 'Failed to map unmapped product');
      showToast(err?.message || 'Failed to map unmapped product', 'error');
    } finally {
      setIsUpdating(false);
    }
  }, [loadUnmappedProducts, migrateObservations, selectedId, selectedProductId]);

  const handleIgnore = useCallback(async () => {
    if (!selectedId) return;
    setIsUpdating(true);
    try {
      const data = await apiFetch<{ error?: string }>(
        `/api/unmapped-products/${selectedId}/ignore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      );
      if (data && data.error) throw new Error(data.error);

      await loadUnmappedProducts();
      showToast('Unmapped product ignored', 'success');
    } catch (err: any) {
      setError(err?.message || 'Failed to ignore unmapped product');
      showToast(err?.message || 'Failed to ignore unmapped product', 'error');
    } finally {
      setIsUpdating(false);
    }
  }, [loadUnmappedProducts, selectedId]);

  useEffect(() => {
    loadUnmappedProducts();
  }, [loadUnmappedProducts]);

  useEffect(() => {
    loadPriceHistory();
    loadMappingHistory();
  }, [loadPriceHistory, loadMappingHistory]);

  // Filter and sort price history
  const filteredPriceHistory = useMemo(() => {
    let arr = [...priceHistory];
    if (minPrice) arr = arr.filter(e => e.price >= parseFloat(minPrice));
    if (maxPrice) arr = arr.filter(e => e.price <= parseFloat(maxPrice));
    arr.sort((a, b) =>
      priceSort === 'desc'
        ? b.observedAt.localeCompare(a.observedAt)
        : a.observedAt.localeCompare(b.observedAt)
    );
    return arr;
  }, [priceHistory, priceSort, minPrice, maxPrice]);

  return (
    <div className="space-y-8">
      <div className="bg-ninpo-card border border-white/10 rounded-[2rem] p-6 space-y-6">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Receipt Seeding</p>
            <h2 className="text-2xl font-black text-white">Unmapped Products</h2>
            <p className="text-sm text-slate-400">
              Review unmatched receipt lines, inspect price history, and map them to catalog products.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={activeStoreId}
              onChange={e => setActiveStoreId(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white"
            >
              <option value="">All stores</option>
              {stores.map(store => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as UnmappedProductStatus | 'ALL')}
              className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white"
            >
              {statusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search receipt names"
                className="bg-black/40 border border-white/10 rounded-2xl pl-9 pr-4 py-2 text-sm text-white"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-200 px-4 py-3 rounded-2xl text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
              <span>Unmapped items</span>
              <span>{unmappedProducts.length} total</span>
            </div>

            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {isLoading && <div className="text-sm text-slate-400">Loading unmapped products...</div>}

              {!isLoading && unmappedProducts.length === 0 && (
                <div className="text-sm text-slate-500">No unmapped products for this filter.</div>
              )}

              {unmappedProducts.map(item => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => setSelectedId(item._id)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    selectedId === item._id
                      ? 'border-ninpo-lime bg-ninpo-lime/10 text-white'
                      : 'border-white/10 bg-black/30 text-slate-200 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.rawName}</p>
                      <p className="text-xs text-slate-400">{item.normalizedName}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-slate-500 flex flex-wrap gap-4">
                    <span>First seen: {fmtTime(item.firstSeenAt)}</span>
                    <span>Last seen: {fmtTime(item.lastSeenAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mapping history</p>

              {historyError && <div className="text-xs text-red-300">{historyError}</div>}
              {isHistoryLoading && (
                <div className="text-xs text-slate-400">Loading mapping history...</div>
              )}
              {!isHistoryLoading && mappingHistory.length === 0 && (
                <div className="text-xs text-slate-500">No mapping or ignore actions yet.</div>
              )}

              <div className="space-y-2 max-h-[120px] overflow-y-auto">
                {mappingHistory.map(entry => (
                  <div
                    key={entry._id}
                    className="flex items-center justify-between text-xs text-slate-200"
                  >
                    <span>
                      {entry.action === 'MAPPED' ? (
                        <>
                          <span className="text-ninpo-lime font-bold">Mapped</span>
                          {entry.productSku && (
                            <>
                              {' '}
                              to <span className="font-semibold">{entry.productSku}</span>
                            </>
                          )}
                          {entry.productName && <> – {entry.productName}</>}
                        </>
                      ) : (
                        <span className="text-slate-400 font-bold">Ignored</span>
                      )}
                      {entry.user && <span className="ml-2 text-slate-500">by {entry.user}</span>}
                    </span>
                    <span className="text-slate-400">{fmtTime(entry.at)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Selected</p>
                <h3 className="text-lg font-black text-white">
                  {selectedItem?.rawName || 'No selection'}
                </h3>
                <p className="text-xs text-slate-500">{selectedItem?.normalizedName}</p>
              </div>
              {selectedItem?.status === 'IGNORED' && (
                <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                  <EyeOff className="w-4 h-4" /> Ignored
                </span>
              )}
            </div>

            <div className="bg-black/30 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Map to product</p>

              <input
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder="Search products by name or SKU"
                className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white w-full"
              />

              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white w-full"
              >
                <option value="">Select a product</option>
                {filteredProducts.map(product => {
                  const productValue = product.id || (product as any)._id;
                  return (
                    <option key={productValue} value={productValue}>
                      {product.sku ? `${product.sku} · ` : ''}
                      {product.name}
                    </option>
                  );
                })}
              </select>

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={migrateObservations}
                  onChange={e => setMigrateObservations(e.target.checked)}
                />
                Migrate price history to mapped product
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmMap(true)}
                  disabled={!selectedId || !selectedProductId || isUpdating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-ninpo-lime text-ninpo-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Map
                </button>

                {showConfirmMap && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-ninpo-card border border-white/10 rounded-2xl p-8 max-w-sm w-full space-y-4">
                      <h4 className="text-lg font-bold text-white">Confirm Mapping</h4>
                      <p className="text-slate-300 text-sm">
                        Are you sure you want to map{' '}
                        <span className="font-semibold">{selectedItem?.rawName}</span> to{' '}
                        <span className="font-semibold">
                          {
                            filteredProducts.find(
                              p => (p.id || (p as any)._id) === selectedProductId
                            )?.name
                          }
                        </span>
                        ?
                      </p>
                      <div className="flex gap-3 mt-4">
                        <button
                          type="button"
                          onClick={handleMap}
                          disabled={isUpdating}
                          className="px-4 py-2 rounded-2xl bg-ninpo-lime text-ninpo-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowConfirmMap(false)}
                          className="px-4 py-2 rounded-2xl border border-white/10 text-xs text-slate-200 uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Toast notification */}
                {toast && (
                  <div
                    className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-lg text-sm font-bold ${
                      toast.type === 'success'
                        ? 'bg-ninpo-lime text-ninpo-black'
                        : 'bg-red-600 text-white'
                    }`}
                  >
                    {toast.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleIgnore}
                  disabled={!selectedId || isUpdating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-white/10 text-xs text-slate-200 uppercase tracking-widest disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Ignore
                </button>
              </div>
            </div>

            <div className="bg-black/30 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Price history</p>
                <span className="text-xs text-slate-500">{filteredPriceHistory.length} obs.</span>
              </div>

              <div className="flex flex-wrap gap-2 mb-2">
                <select
                  value={priceSort}
                  onChange={e => setPriceSort(e.target.value as 'asc' | 'desc')}
                  className="bg-black/40 border border-white/10 rounded-2xl px-2 py-1 text-xs text-white"
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minPrice}
                  onChange={e => setMinPrice(e.target.value)}
                  placeholder="Min $"
                  className="bg-black/40 border border-white/10 rounded-2xl px-2 py-1 text-xs text-white w-20"
                />

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)}
                  placeholder="Max $"
                  className="bg-black/40 border border-white/10 rounded-2xl px-2 py-1 text-xs text-white w-20"
                />
              </div>

              {priceHistoryError && <div className="text-xs text-red-300">{priceHistoryError}</div>}
              {isPriceLoading && (
                <div className="text-xs text-slate-400">Loading price observations...</div>
              )}
              {!isPriceLoading && filteredPriceHistory.length === 0 && (
                <div className="text-xs text-slate-500">No price observations yet.</div>
              )}

              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {filteredPriceHistory.map(entry => (
                  <div
                    key={entry._id}
                    className="flex items-center justify-between text-sm text-slate-200"
                  >
                    <span>${entry.price.toFixed(2)}</span>
                    <span className="text-xs text-slate-400">{fmtTime(entry.observedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManagementUnmappedProducts;
