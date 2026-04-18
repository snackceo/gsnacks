import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  MapPin,
  Package,
  DollarSign,
  Clock,
  Store,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Home,
  Eye,
  SkipForward,
  X
} from 'lucide-react';
import ItemNotFoundTracker from './ItemNotFoundTracker';
import ReceiptCapture from './ReceiptCapture';
import ReceiptCaptureFlow from './ReceiptCaptureFlow';
import ScannerModal from './ScannerModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

interface ShoppingListItem {
  name: string;
  sku: string;
  quantity: number;
  price: number;
  store: string;
  storeId: string;
}

interface NotFoundItem {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  originalStore: string;
  attemptedStores: string[];
  foundAt?: string;
}

interface OrderDetail {
  orderId: string;
  customerId: string;
  address: string;
  total: number;
  status: string;
  items: any[];
  routeFee: number;
  distanceFee: number;
  largeOrderFee: number;
  heavyItemFee: number;
  driverId?: string;
  assignedAt?: string;
  createdAt: string;
}

interface DriverOrderDetailProps {
  order: OrderDetail;
  onBack: () => void;
}

const DriverOrderDetail: React.FC<DriverOrderDetailProps> = ({ order, onBack }) => {
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [notFoundItems, setNotFoundItems] = useState<NotFoundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupedByStore, setGroupedByStore] = useState<Record<string, ShoppingListItem[]>>({});
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [showReceiptCapture, setShowReceiptCapture] = useState(false);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);

  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };


  // Use ReceiptCaptureFlow for all receipt capture/parse

  useEffect(() => {
    fetchShoppingList();
    fetchNotFoundItemsFromBackend();
  }, [order?.orderId]);

  // Periodic backend refresh for items-not-found while view is open
  useEffect(() => {
    const id = setInterval(() => {
      fetchNotFoundItemsFromBackend();
    }, 30000);
    return () => clearInterval(id);
  }, [order?.orderId]);

  const fetchNotFoundItemsFromBackend = async () => {
    try {
      const orderId = order?.orderId || order?.id;
      const storageKey = `notFoundItems_${orderId}`;
      const token = localStorage.getItem('token');

      // Load local first (for immediate UI), then merge with backend
      const localRaw = localStorage.getItem(storageKey);
      const localItems: NotFoundItem[] = localRaw ? JSON.parse(localRaw) : [];
      if (localItems.length > 0) {
        setNotFoundItems(localItems);
      }

      const res = await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/items-not-found`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        // Keep local data and surface a warning
        showToast('Failed to refresh not-found items from server', 'error');
        return;
      }
      const data = await res.json();
      const serverItems: NotFoundItem[] = Array.isArray(data.itemsNotFound)
        ? data.itemsNotFound
        : [];

      // Merge: prefer local entries on conflict (offline-first), include new server items
      const bySku = new Map<string, NotFoundItem>();
      for (const it of serverItems) bySku.set(it.sku, it);
      for (const it of localItems) bySku.set(it.sku, it);
      const merged = Array.from(bySku.values());

      setNotFoundItems(merged);
      localStorage.setItem(storageKey, JSON.stringify(merged));

      // Push merged state back to server to reconcile
      try {
        await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/items-not-found`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ items: merged })
        });
      } catch (e) {
        // Non-fatal: retain local cache
        console.warn('Post-merge sync failed:', e);
      }
    } catch (err) {
      console.warn('Failed to fetch not-found items from backend:', err);
      // Fallback to local-only load
      loadNotFoundItemsFromStorage();
    }
  };

  const fetchShoppingList = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      const orderId = order?.orderId || order?.id;
      
      const res = await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/shopping-list`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        const items = data.shoppingList || [];
        setShoppingList(items);
        
        // Group by store
        const grouped: Record<string, ShoppingListItem[]> = {};
        items.forEach((item: ShoppingListItem) => {
          const storeKey = item.storeId || item.store;
          if (!grouped[storeKey]) {
            grouped[storeKey] = [];
          }
          grouped[storeKey].push(item);
        });
        setGroupedByStore(grouped);
      } else {
        setError('Failed to fetch shopping list');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading shopping list');
    } finally {
      setLoading(false);
    }
  };

  const handleItemNotFound = (item: ShoppingListItem, storeId: string) => {
    const existing = notFoundItems.find(n => n.sku === item.sku);
    const storeName = groupedByStore[storeId]?.[0]?.store || `Store ${storeId}`;
    
    let updated: NotFoundItem[];
    if (existing) {
      if (!existing.attemptedStores.includes(storeName)) {
        updated = notFoundItems.map(n =>
          n.sku === item.sku
            ? { ...n, attemptedStores: [...n.attemptedStores, storeName] }
            : n
        );
      } else {
        return;
      }
    } else {
      updated = [
        ...notFoundItems,
        {
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          originalStore: storeName,
          attemptedStores: [storeName]
        }
      ];
    }
    setNotFoundItems(updated);
    saveNotFoundItemsToStorage(updated);
  };

  const handleUpdateNotFound = (item: NotFoundItem) => {
    const updated = notFoundItems.map(n => (n.sku === item.sku ? item : n));
    setNotFoundItems(updated);
    saveNotFoundItemsToStorage(updated);
  };

  const handleMarkFoundAt = async (sku: string, storeName: string) => {
    const orderId = order?.orderId || order?.id;
    const token = localStorage.getItem('token');
    const existing = notFoundItems.find(n => n.sku === sku);
    if (!existing) return;
    const attempted = existing.attemptedStores.includes(storeName)
      ? existing.attemptedStores
      : [...existing.attemptedStores, storeName];
    const updatedItem: NotFoundItem = { ...existing, foundAt: storeName, attemptedStores: attempted };
    const updated = notFoundItems.map(n => (n.sku === sku ? updatedItem : n));
    setNotFoundItems(updated);
    saveNotFoundItemsToStorage(updated);
    try {
      await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/items-not-found/${encodeURIComponent(sku)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'found', foundAt: storeName })
      });
    } catch (e) {
      console.warn('Failed to mark found on server:', e);
      showToast('Could not sync found item to server', 'error');
    }
  };

  const handleRemoveNotFound = (sku: string) => {
    const updated = notFoundItems.filter(n => n.sku !== sku);
    setNotFoundItems(updated);
    saveNotFoundItemsToStorage(updated);
  };

  const getStoreNameFromId = (storeId: string): string => {
    const items = groupedByStore[storeId];
    if (items && items.length > 0) {
      return items[0].store || `Store ${storeId}`;
    }
    return `Store ${storeId}`;
  };

  const loadNotFoundItemsFromStorage = () => {
    try {
      const orderId = order?.orderId || order?.id;
      const storageKey = `notFoundItems_${orderId}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setNotFoundItems(JSON.parse(stored));
      }
    } catch (err) {
      console.warn('Failed to load items from storage:', err);
    }
  };

  const saveNotFoundItemsToStorage = async (items: NotFoundItem[]) => {
    try {
      const orderId = order?.orderId || order?.id;
      const storageKey = `notFoundItems_${orderId}`;
      localStorage.setItem(storageKey, JSON.stringify(items));

      // Sync to backend
      const token = localStorage.getItem('token');
      await fetch(`${BACKEND_URL}/api/driver/order/${orderId}/items-not-found`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ items })
      }).catch(err => console.warn('Backend sync failed:', err));
    } catch (err) {
      showToast('Failed to sync items not found', 'error');
      console.error(err);
    }
  };

  const getTotalItems = () => shoppingList.reduce((sum, item) => sum + item.quantity, 0);
  
  const getSubtotal = () => shoppingList.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const getStoreName = (storeId: string) => {
    // Extract store name from grouped data or use ID
    const items = groupedByStore[storeId];
    if (items && items.length > 0) {
      return items[0].store || `Store ${storeId}`;
    }
    return `Store ${storeId}`;
  };

  const totalFees = (order?.routeFee || 0) + (order?.distanceFee || 0) + (order?.largeOrderFee || 0) + (order?.heavyItemFee || 0);

  return (
    <div className="fixed inset-0 bg-ninpo-black text-white overflow-y-auto z-40">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 pt-4 sticky top-0 bg-ninpo-black z-10">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/10 rounded-lg transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-ninpo-lime">Order Details</h1>
            <p className="text-white/60">{order?.orderId?.slice(0, 12)}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-600 rounded-xl text-red-300 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 p-4 rounded-xl shadow-2xl flex items-center gap-3 min-w-[320px] ${
            toast.type === 'error' 
              ? 'bg-red-900/95 border border-red-600 text-red-200'
              : toast.type === 'success'
              ? 'bg-green-900/95 border border-green-600 text-green-200'
              : 'bg-blue-900/95 border border-blue-600 text-blue-200'
          }`}>
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="flex-1 text-sm font-bold">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="p-1 hover:bg-white/10 rounded transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Order Summary */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-xs text-white/60 uppercase font-bold mb-1">Order Total</p>
              <p className="text-3xl font-black text-ninpo-lime">${order?.total?.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-white/60 uppercase font-bold mb-1">Items</p>
              <p className="text-3xl font-black text-white">{getTotalItems()}</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* Delivery Address */}
            <div className="flex items-start gap-3">
              <Home className="w-5 h-5 text-ninpo-lime mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-white/60 uppercase font-bold">Delivery Address</p>
                <p className="text-sm">{order?.address}</p>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-ninpo-lime mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-white/60 uppercase font-bold">Status</p>
                <p className="text-sm capitalize">{order?.status?.toLowerCase().replace(/_/g, ' ')}</p>
              </div>
            </div>

            {/* Time */}
            {order?.assignedAt && (
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-ninpo-lime mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-white/60 uppercase font-bold">Assigned</p>
                  <p className="text-sm">
                    {new Date(order.assignedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fee Breakdown */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-black text-ninpo-lime mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Fee Breakdown
          </h2>
          <div className="space-y-2 text-sm">
            {order?.routeFee > 0 && (
              <div className="flex justify-between">
                <span className="text-white/70">Route Fee</span>
                <span className="font-bold">${order.routeFee.toFixed(2)}</span>
              </div>
            )}
            {order?.distanceFee > 0 && (
              <div className="flex justify-between">
                <span className="text-white/70">Distance Fee</span>
                <span className="font-bold">${order.distanceFee.toFixed(2)}</span>
              </div>
            )}
            {order?.largeOrderFee > 0 && (
              <div className="flex justify-between">
                <span className="text-white/70">Large Order Fee</span>
                <span className="font-bold">${order.largeOrderFee.toFixed(2)}</span>
              </div>
            )}
            {order?.heavyItemFee > 0 && (
              <div className="flex justify-between">
                <span className="text-white/70">Heavy Item Fee</span>
                <span className="font-bold">${order.heavyItemFee.toFixed(2)}</span>
              </div>
            )}
            <div className="border-t border-white/10 pt-2 mt-2 flex justify-between font-black">
              <span>Total Fees</span>
              <span className="text-ninpo-lime">${totalFees.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Shopping List by Store */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-ninpo-lime" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Items Not Found Tracker */}
            <ItemNotFoundTracker
              notFoundItems={notFoundItems}
              onItemNotFound={handleUpdateNotFound}
              onRemoveNotFound={handleRemoveNotFound}
              currentStore={currentStoreId ? getStoreNameFromId(currentStoreId) : 'N/A'}
              onMarkFound={(sku, store) => handleMarkFoundAt(sku, store)}
            />

            {/* Shopping List by Store */}
            {(Object.entries(groupedByStore) as Array<[string, ShoppingListItem[]]>).map(([storeId, storeItems]) => (
              <div
                key={storeId}
                className={`bg-white/5 border rounded-xl p-6 cursor-pointer transition-all ${
                  currentStoreId === storeId
                    ? 'border-ninpo-lime/50 bg-ninpo-lime/10'
                    : 'border-white/10 hover:border-ninpo-lime/30'
                }`}
                onClick={() => setCurrentStoreId(storeId)}
              >
                <h3 className="text-lg font-black text-ninpo-lime mb-4 flex items-center gap-2">
                  <Store className="w-5 h-5" />
                  {getStoreName(storeId)}
                </h3>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {storeItems.map((item: ShoppingListItem, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5"
                    >
                      <div className="flex-1">
                        <p className="font-bold text-sm">{item.name}</p>
                        <p className="text-xs text-white/50">SKU: {item.sku}</p>
                      </div>
                      <div className="text-right mr-3">
                        <p className="text-sm font-bold text-ninpo-lime">
                          x{item.quantity}
                        </p>
                        <p className="text-xs text-white/60">
                          ${(item.price * item.quantity).toFixed(2)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleItemNotFound(item, storeId)}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all text-white/70 hover:text-white"
                        title="Mark as not found"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
                  <span className="font-bold text-white/70">Store Subtotal</span>
                  <span className="font-black text-ninpo-lime">
                    ${storeItems.reduce((sum: number, item: ShoppingListItem) => sum + (item.price * item.quantity), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}

            {/* Total Summary */}
            <div className="bg-gradient-to-br from-ninpo-lime/20 to-ninpo-lime/5 border border-ninpo-lime/30 rounded-xl p-6">
              <div className="space-y-2">
                <div className="flex justify-between text-white/70">
                  <span>Items Subtotal</span>
                  <span>${getSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-white/70">
                  <span>Delivery Fees</span>
                  <span>${totalFees.toFixed(2)}</span>
                </div>
                <div className="border-t border-ninpo-lime/20 pt-2 mt-2 flex justify-between font-black text-lg">
                  <span>Order Total</span>
                  <span className="text-ninpo-lime">${order?.total?.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-8 pb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowPhotoCapture(true)}
              className="py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 text-sm"
            >
              <DollarSign className="w-5 h-5" />
              Auto Receipt
            </button>
            <button
              onClick={() => setShowReceiptCapture(true)}
              className="py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 text-sm"
            >
              <DollarSign className="w-5 h-5" />
              Manual Entry
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-black uppercase tracking-widest transition-all"
            >
              Close
            </button>
            <button
              onClick={fetchShoppingList}
              disabled={loading}
              className="flex-1 py-3 bg-ninpo-lime text-ninpo-black hover:bg-white rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>


        {/* Canonical Receipt Capture Flow */}
        {showPhotoCapture && (
          <ReceiptCaptureFlow
            stores={[]}
            isOpen={showPhotoCapture}
            defaultStoreId={currentStoreId || undefined}
            onReceiptCreated={() => {
              setShowPhotoCapture(false);
              showToast('Receipt auto-uploaded & parse started! Check management to review.', 'success');
            }}
            onCancel={() => setShowPhotoCapture(false)}
          />
        )}

        {/* Manual Receipt Entry Modal */}
        {showReceiptCapture && (
          <ReceiptCapture
            orderId={order?.orderId || order?.id || ''}
            storeId={currentStoreId || undefined}
            storeName={currentStoreId ? getStoreNameFromId(currentStoreId) : undefined}
            onComplete={() => {
              setShowReceiptCapture(false);
              showToast('Prices updated from receipt!', 'success');
            }}
            onCancel={() => setShowReceiptCapture(false)}
          />
        )}
      </div>
    </div>
  );
};

export default DriverOrderDetail;
