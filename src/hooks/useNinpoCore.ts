import { useState, useEffect, useCallback, useRef } from 'react';

import {
  User,
  Product,
  Order,
  OrderStatus,
  AppSettings,
  ApprovalRequest,
  AuditLog,
  UserStatsSummary,
  ReturnVerification,
  ReturnSettlement
} from '../types';
import { MOCK_PRODUCTS, BACKEND_URL } from '../constants';
import { 
  connectSocket, 
  disconnectSocket, 
  onCartUpdate, 
  onDriverNotFoundUpdate,
  onDriverNotFoundDelete,
  onReturnUpcsUpdate,
  onReturnUpcsDelete,
  onOrderUpdate,
  onOrderCreated,
  onProductUpdate
} from '../services/socketService';
import { 
  registerServiceWorker, 
  requestNotificationPermission, 
  subscribeToPush 
} from '../services/pushService';

const allowPlatinumTier = (import.meta as any).env?.VITE_ALLOW_PLATINUM_TIER === 'true';
const SETTINGS_STORAGE_KEY = 'ninpo:settings';
const CART_STORAGE_KEY = 'ninpo:cart';

const normalizeStoredCart = (raw: unknown) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => ({
      productId: String((item as { productId?: string }).productId || '').trim(),
      quantity: Math.max(1, Number((item as { quantity?: number }).quantity || 1))
    }))
    .filter(item => item.productId);
};

const readStoredCart = () => {
  if (typeof window === 'undefined') return [];
  const stored = window.localStorage.getItem(CART_STORAGE_KEY);
  if (!stored) return [];
  try {
    return normalizeStoredCart(JSON.parse(stored));
  } catch {
    return [];
  }
};

const persistCart = (next: { productId: string; quantity: number }[]) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

const defaultSettings: AppSettings = {
  routeFee: 4.99,
  referralBonus: 5.0,
  pickupOnlyMultiplier: 0.5,
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0,
  hubLat: null,
  hubLng: null,
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier,
  platinumFreeDelivery: false,
  allowGreenTier: false,
  allowReceiptApprovalCreateProduct: false,
  priceLockDays: 7,
  storageZones: [],
  productTypes: [],

  // renamed: replaces legacy A/B/C/D
  scanningModesEnabled: {
    inventoryCreate: true,
    upcLookup: true,
    driverVerifyContainers: true,
    customerReturnScan: true
  },

  defaultIncrement: 1,
  cooldownMs: 1000,

  // required by UI
  beepEnabled: true,

  requireSkuForScanning: false,
  shelfGroupingEnabled: false,
  dailyReturnLimit: 0,
  glassHandlingFeePercent: 0,
  michiganDepositValue: 0,
  processingFeePercent: 0,
  returnProcessingFeePercent: 0,
  glassHandlingFeePerContainer: 0,
  returnHandlingFeePerContainer: 0,
  largeOrderIncludedItems: 10,
  largeOrderPerItemFee: 0.3,
  heavyItemFeePerUnit: 1.5
};

const parseOptionalNumber = (value: number | null | undefined, fallback: number | null) => {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number;
};

const coerceBool = (v: any, fallback: boolean) => {
  if (v === undefined || v === null) return fallback;
  return Boolean(v);
};

const resolveOrdersPayload = (data: any) => {
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.data?.orders)) return data.data.orders;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
};

const normalizeOrderTotal = (order: any) => {
  const direct =
    order?.total ??
    order?.totalAmount ??
    order?.amount ??
    order?.totalDollars ??
    order?.totalUSD ??
    order?.totalValue;
  if (direct !== undefined && direct !== null) {
    const numeric = Number(direct);
    if (Number.isFinite(numeric)) return numeric;
  }

  const cents =
    order?.totalCents ??
    order?.totalAmountCents ??
    order?.amountCents ??
    order?.amount_in_cents;
  if (cents !== undefined && cents !== null) {
    const numeric = Number(cents);
    if (Number.isFinite(numeric)) return numeric / 100;
  }

  return 0;
};

const normalizeOrders = (rawOrders: any[]) => {
  const normalized = rawOrders
    .map(order => {
      const idCandidate = order?.id ?? order?._id ?? order?.orderId;
      const id = typeof idCandidate === 'string' ? idCandidate : String(idCandidate || '');
      const trimmedId = id.trim();
      if (!trimmedId) return null;
      return {
        ...order,
        id: trimmedId,
        total: normalizeOrderTotal(order)
      } as Order;
    })
    .filter((order): order is Order => Boolean(order));

  if (normalized.length !== rawOrders.length) {
    console.warn('Orders payload contained entries without IDs.', {
      received: rawOrders.length,
      normalized: normalized.length
    });
  }

  return normalized;
};

/**
 * Legacy mapping:
 * old: scanningModesEnabled = { A,B,C,D }
 * new: scanningModesEnabled = {
 *   inventoryCreate, upcLookup, driverVerifyContainers, customerReturnScan
 * }
 *
 * Mapping choice (deterministic):
 *   A -> inventoryCreate
 *   B -> upcLookup
 *   C -> driverVerifyContainers
 *
 * customerReturnScan defaults true unless explicitly present in new schema
 */
const normalizeScanningModes = (raw: any) => {
  const fallback = defaultSettings.scanningModesEnabled as any;

  if (!raw || typeof raw !== 'object') return fallback;

  // If it already has the new keys, respect them.
  const hasNewKeys =
    'inventoryCreate' in raw ||
    'upcLookup' in raw ||
    'driverVerifyContainers' in raw ||
    'customerReturnScan' in raw;

  if (hasNewKeys) {
    return {
      inventoryCreate: coerceBool(raw.inventoryCreate, fallback.inventoryCreate),
      upcLookup: coerceBool(raw.upcLookup, fallback.upcLookup),
      driverVerifyContainers: coerceBool(
        raw.driverVerifyContainers,
        fallback.driverVerifyContainers
      ),
      customerReturnScan: coerceBool(raw.customerReturnScan, fallback.customerReturnScan)
    };
  }

  // Otherwise assume legacy A/B/C/D.
  return {
    inventoryCreate: coerceBool(raw.A, fallback.inventoryCreate),
    upcLookup: coerceBool(raw.B, fallback.upcLookup),
    driverVerifyContainers: coerceBool(raw.C, fallback.driverVerifyContainers),

    // legacy didn’t have this; default it on
    customerReturnScan: fallback.customerReturnScan
  };
};

const normalizeSettings = (raw?: Partial<AppSettings> | null): AppSettings => {
  const data: any = raw ?? {};

  const normalizedScanningModes = normalizeScanningModes(data.scanningModesEnabled);

  return {
    ...defaultSettings,
    ...data,

    routeFee: Number(data.routeFee ?? defaultSettings.routeFee),
    referralBonus: Number(data.referralBonus ?? defaultSettings.referralBonus),
    pickupOnlyMultiplier: Number(data.pickupOnlyMultiplier ?? defaultSettings.pickupOnlyMultiplier),
    distanceIncludedMiles: Number(
      data.distanceIncludedMiles ?? defaultSettings.distanceIncludedMiles
    ),
    distanceBand1MaxMiles: Number(
      data.distanceBand1MaxMiles ?? defaultSettings.distanceBand1MaxMiles
    ),
    distanceBand2MaxMiles: Number(
      data.distanceBand2MaxMiles ?? defaultSettings.distanceBand2MaxMiles
    ),
    distanceBand1Rate: Number(data.distanceBand1Rate ?? defaultSettings.distanceBand1Rate),
    distanceBand2Rate: Number(data.distanceBand2Rate ?? defaultSettings.distanceBand2Rate),
    distanceBand3Rate: Number(data.distanceBand3Rate ?? defaultSettings.distanceBand3Rate),

    hubLat: parseOptionalNumber(data.hubLat, defaultSettings.hubLat),
    hubLng: parseOptionalNumber(data.hubLng, defaultSettings.hubLng),

    maintenanceMode: Boolean(data.maintenanceMode ?? defaultSettings.maintenanceMode),
    requirePhotoForRefunds: Boolean(
      data.requirePhotoForRefunds ?? defaultSettings.requirePhotoForRefunds
    ),
    allowGuestCheckout: Boolean(data.allowGuestCheckout ?? defaultSettings.allowGuestCheckout),
    showAdvancedInventoryInsights: Boolean(
      data.showAdvancedInventoryInsights ?? defaultSettings.showAdvancedInventoryInsights
    ),

    allowPlatinumTier: Boolean(data.allowPlatinumTier ?? defaultSettings.allowPlatinumTier),
    platinumFreeDelivery: Boolean(
      data.platinumFreeDelivery ?? defaultSettings.platinumFreeDelivery
    ),
    allowReceiptApprovalCreateProduct: Boolean(
      data.allowReceiptApprovalCreateProduct ?? defaultSettings.allowReceiptApprovalCreateProduct
    ),
    priceLockDays: Number(data.priceLockDays ?? defaultSettings.priceLockDays),

    storageZones: Array.isArray(data.storageZones) ? data.storageZones : defaultSettings.storageZones,
    productTypes: Array.isArray(data.productTypes) ? data.productTypes : defaultSettings.productTypes,

    // normalized to new schema (and legacy-safe)
    scanningModesEnabled: normalizedScanningModes,

    defaultIncrement: Number(data.defaultIncrement ?? defaultSettings.defaultIncrement),
    cooldownMs: Number(data.cooldownMs ?? defaultSettings.cooldownMs),

    // keep it always present
    beepEnabled: Boolean(data.beepEnabled ?? defaultSettings.beepEnabled),

    requireSkuForScanning: Boolean(
      data.requireSkuForScanning ?? defaultSettings.requireSkuForScanning
    ),
    shelfGroupingEnabled: Boolean(
      data.shelfGroupingEnabled ?? defaultSettings.shelfGroupingEnabled
    ),
    dailyReturnLimit: Number(data.dailyReturnLimit ?? defaultSettings.dailyReturnLimit),
    glassHandlingFeePercent: Number(
      data.glassHandlingFeePercent ?? defaultSettings.glassHandlingFeePercent
    ),
    michiganDepositValue: Number(
      data.michiganDepositValue ?? defaultSettings.michiganDepositValue
    ),
    processingFeePercent: Number(
      data.processingFeePercent ?? defaultSettings.processingFeePercent
    ),
    returnProcessingFeePercent: Number(
      data.returnProcessingFeePercent ?? defaultSettings.returnProcessingFeePercent
    ),
    glassHandlingFeePerContainer: Number(
      data.glassHandlingFeePerContainer ?? defaultSettings.glassHandlingFeePerContainer
    ),
    returnHandlingFeePerContainer: Number(
      data.returnHandlingFeePerContainer ?? defaultSettings.returnHandlingFeePerContainer
    ),
    largeOrderIncludedItems: Number(
      data.largeOrderIncludedItems ?? defaultSettings.largeOrderIncludedItems
    ),
    largeOrderPerItemFee: Number(
      data.largeOrderPerItemFee ?? defaultSettings.largeOrderPerItemFee
    ),
    heavyItemFeePerUnit: Number(
      data.heavyItemFeePerUnit ?? defaultSettings.heavyItemFeePerUnit
    )
  };
};

const readStoredSettings = () => {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!stored) return null;
  try {
    return normalizeSettings(JSON.parse(stored));
  } catch {
    return null;
  }
};

const persistSettings = (next: AppSettings) => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

type Toast = { id: string; message: string; type: 'info' | 'success' | 'warning' };

export const useNinpoCore = () => {
  // --- State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [userStats, setUserStats] = useState<Record<string, UserStatsSummary>>({});
  const [settings, setSettings] = useState<AppSettings>(() => readStoredSettings() ?? normalizeSettings());
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [returnVerifications, setReturnVerifications] = useState<ReturnVerification[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(
    () => readStoredCart()
  );

  // --- Toast ---
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // --- Fetch Callbacks ---
  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load products');
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data?.products) ? data.products : [];
      setProducts(list);
      return list as Product[];
    } catch (e: any) {
      setProducts(MOCK_PRODUCTS as any);
      addToast(e?.message ?? 'Using fallback products', 'warning');
      return MOCK_PRODUCTS as any;
    }
  }, [addToast]);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Orders fetch failed.', { status: res.status, statusText: res.statusText, data });
        throw new Error(data?.error || 'Failed to load orders');
      }
      const rawOrders = resolveOrdersPayload(data);
      if (!Array.isArray(rawOrders)) {
        console.warn('Orders response did not include a list payload.', data);
      }
      const list = normalizeOrders(rawOrders);
      setOrders(list);
      return list;
    } catch (e: any) {
      console.error('Orders fetch error.', e);
      addToast(e?.message ?? 'Orders feed offline', 'warning');
      return [];
    }
  }, [addToast]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load settings');
      const payload = data?.settings ?? data;
      const normalized = normalizeSettings(payload as Partial<AppSettings>);
      setSettings(normalized);
      persistSettings(normalized);
      return normalized;
    } catch (e: any) {
      const stored = readStoredSettings();
      if (stored) {
        setSettings(stored);
        return stored;
      }
      addToast(e?.message ?? 'Using default settings', 'warning');
      return null;
    }
  }, [addToast]);

  const syncCartToServer = useCallback(async (items: { productId: string; quantity: number }[]) => {
    if (!currentUser) return;
    try {
      await fetch(`${BACKEND_URL}/api/cart`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items })
      });
    } catch (err) {
      console.warn('[syncCartToServer] Failed:', err);
    }
  }, [currentUser]);

  const loadCartFromServer = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/cart`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          const localCart = readStoredCart();
          const merged = [...localCart];
          data.items.forEach((serverItem: any) => {
            if (!merged.find(item => item.productId === serverItem.productId)) {
              merged.push({ productId: serverItem.productId, quantity: serverItem.quantity });
            }
          });
          setCart(merged);
          persistCart(merged);
        }
      }
    } catch (err) {
      console.warn('[loadCartFromServer] Failed:', err);
    }
  }, [currentUser]);

  const clearCart = useCallback(() => {
    setCart([]);
    persistCart([]);
    fetch(`${BACKEND_URL}/api/cart`, {
      method: 'DELETE',
      credentials: 'include'
    }).catch(err => console.warn('[clearCart] Failed to sync to server:', err));
  }, []);

  const syncWithBackend = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sync`);
      setIsBackendOnline(res.ok);
    } catch {
      setIsBackendOnline(false);
    }
  }, []);

  // --- Refresh Guards and Callbacks ---
  const refreshInFlightRef = useRef(false);
  const refreshDashboardData = useCallback(async () => {
    if (!currentUser) return;
    try {
      await Promise.all([
        fetchOrders().catch(() => {}),
        fetchProducts().catch(() => {})
      ]);
      setLastSyncTime(new Date());
    } catch (err) {
      console.debug('[refreshDashboardData] Background refresh failed:', err);
    }
  }, [currentUser, fetchOrders, fetchProducts]);
  const refreshDashboardDataSafe = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    refreshInFlightRef.current = true;
    try {
      await refreshDashboardData();
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [refreshDashboardData]);

  // --- Effects ---
  useEffect(() => {
    if (!currentUser) return;
    refreshDashboardDataSafe();
    const refreshInterval = setInterval(refreshDashboardDataSafe, 30000);
    return () => clearInterval(refreshInterval);
  }, [currentUser, refreshDashboardDataSafe]);

  useEffect(() => {
    persistCart(cart);
    // Debounce server sync (only sync after 1 second of no changes)
    const timeout = setTimeout(() => {
      if (currentUser) {
        syncCartToServer(cart);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [cart, currentUser, syncCartToServer]);

  // 🚀 WebSocket Real-Time Listeners
  useEffect(() => {
    if (!currentUser) return;

    // Cart updates from other devices
    const unsubCart = onCartUpdate((data) => {
      console.log('[Socket] Cart updated from another device');
      if (data.items) {
        setCart(data.items);
        setLastSyncTime(new Date());
      }
    });

    // Order updates (for dashboard)
    const unsubOrderUpdate = onOrderUpdate((order) => {
      console.log('[Socket] Order updated:', order._id);
      setOrders(prev => prev.map(o => o.id === order._id ? { ...o, ...order } : o));
      setLastSyncTime(new Date());
    });

    // New orders (for dashboard)
    const unsubOrderCreate = onOrderCreated((order) => {
      console.log('[Socket] New order created:', order._id);
      setOrders(prev => [order, ...prev]);
      setLastSyncTime(new Date());
    });

    // Product updates (for dashboard)
    const unsubProduct = onProductUpdate((product) => {
      console.log('[Socket] Product updated:', product._id);
      setProducts(prev => prev.map(p => p.id === product._id ? { ...p, ...product } : p));
      setLastSyncTime(new Date());
    });

    // Driver not-found items updates
    const unsubDriverNotFound = onDriverNotFoundUpdate((data) => {
      console.log('[Socket] Driver not-found items updated:', data.orderId);
      // Store in localStorage for now (could be moved to state if needed)
      localStorage.setItem(`driver-not-found:${data.orderId}`, JSON.stringify(data.items));
    });

    const unsubDriverNotFoundDelete = onDriverNotFoundDelete((data) => {
      console.log('[Socket] Driver not-found items deleted:', data.orderId);
      localStorage.removeItem(`driver-not-found:${data.orderId}`);
    });

    // Return UPCs updates
    const unsubReturnUpcs = onReturnUpcsUpdate((data) => {
      console.log('[Socket] Return UPCs updated');
      localStorage.setItem('return-upcs', JSON.stringify(data.upcs));
      localStorage.setItem('return-eligibility-cache', JSON.stringify(data.eligibilityCache));
    });

    const unsubReturnUpcsDelete = onReturnUpcsDelete(() => {
      console.log('[Socket] Return UPCs deleted');
      localStorage.removeItem('return-upcs');
      localStorage.removeItem('return-eligibility-cache');
    });

    // Cleanup all listeners
    return () => {
      unsubCart();
      unsubOrderUpdate();
      unsubOrderCreate();
      unsubProduct();
      unsubDriverNotFound();
      unsubDriverNotFoundDelete();
      unsubReturnUpcs();
      unsubReturnUpcsDelete();
    };
  }, [currentUser]);

  const restoreSession = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        credentials: 'include'
      });

      if (!res.ok) {
        setCurrentUser(null);
        return false;
      }

      const data = await res.json().catch(() => ({}));
      const u = data?.user;

      const normalizedTier = String(u?.membershipTier || 'COMMON').toUpperCase();
      const membershipTier = normalizedTier === 'NONE' ? 'COMMON' : normalizedTier;

      const mapped: any = {
        id: u?.id || u?.userId,
        name: u?.username || 'USER',
        username: u?.username,
        email: u?.username ? `${u.username}@ninposnacks.com` : undefined,
        role: u?.role || 'CUSTOMER',
        creditBalance: Number(u?.creditBalance || 0),
        loyaltyPoints: Number(u?.loyaltyPoints || 0),
        membershipTier,
        ordersCompleted: Number(u?.ordersCompleted || 0),
        phoneVerified: Boolean(u?.phoneVerified),
        photoIdVerified: Boolean(u?.photoIdVerified),
        createdAt: u?.createdAt
      };

      setCurrentUser(mapped as User);
      
      // 🚀 Connect WebSocket for real-time sync (async, non-blocking, deferred)
      if (mapped.id) {
        // Defer socket connection to next tick to ensure React hydration
        Promise.resolve().then(() => {
          connectSocket(mapped.id).catch(e => console.warn('[Socket] Connection failed:', e));
        });
        
        // Setup push notifications (optional, non-blocking)
        registerServiceWorker().then(() => {
          requestNotificationPermission().then(granted => {
            if (granted) {
              subscribeToPush().catch(e => console.warn('[Push] Subscription failed:', e));
            }
          });
        }).catch(e => console.warn('[SW] Registration failed:', e));
      }
      
      return true;
    } catch {
      setCurrentUser(null);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // ignore
    } finally {
      disconnectSocket(); // 🚀 Disconnect WebSocket on logout
      setCurrentUser(null);
      addToast('SIGNED OUT', 'info');
    }
  }, [addToast]);

  const createProduct = useCallback(
    async (p: Partial<Product>) => {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: p.id,
          name: p.name,
          price: p.price,
          deposit: (p as any).deposit ?? 0,
          stock: p.stock ?? 0,
          sizeOz: (p as any).sizeOz ?? 0,
          category: p.category ?? 'DRINK',
          image: p.image ?? '',
          isGlass: (p as any).isGlass ?? false,
          upc: p.upc
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Create product failed');

      const created = data.product as Product;
      setProducts(prev => [created, ...prev]);
      addToast('PRODUCT CREATED', 'success');
      return created;
    },
    [addToast]
  );

  const updateProduct = useCallback(
    async (id: string, updates: Partial<Product>) => {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update product failed');

      const updated = data.product as Product;
      setProducts(prev => prev.map(p => (p.id === id ? updated : p)));
      addToast('PRODUCT UPDATED', 'success');
      return updated;
    },
    [addToast]
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Delete product failed');

      setProducts(prev => prev.filter(p => p.id !== id));
      addToast('PRODUCT REMOVED', 'success');
      return true;
    },
    [addToast]
  );

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/approvals`, {
        credentials: 'include'
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load approvals');

      const list = Array.isArray(data?.approvals) ? data.approvals : [];
      setApprovals(list);
      return list as ApprovalRequest[];
    } catch (e: any) {
      addToast(e?.message ?? 'Approvals feed offline', 'warning');
      return [];
    }
  }, [addToast]);

  const fetchAuditLogs = useCallback(async () => {
    const res = await fetch(`${BACKEND_URL}/api/audit-logs`, {
      credentials: 'include'
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to load audit logs');

    const list = Array.isArray(data?.auditLogs)
      ? data.auditLogs
      : Array.isArray(data?.logs)
        ? data.logs
        : [];
    setAuditLogs(list);
    return list as AuditLog[];
  }, []);

  const fetchReturnVerifications = useCallback(async () => {
    const res = await fetch(`${BACKEND_URL}/api/returns/verifications`, {
      credentials: 'include'
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to load return verifications');

    const list = Array.isArray(data?.verifications) ? data.verifications : [];
    setReturnVerifications(list);
    return list as ReturnVerification[];
  }, []);

  const settleReturnVerification = useCallback(
    async (
      verificationId: string,
      finalAcceptedCount: number,
      creditAmount: number,
      cashAmount: number
    ) => {
      const res = await fetch(
        `${BACKEND_URL}/api/returns/verifications/${verificationId}/settle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ finalAcceptedCount, creditAmount, cashAmount })
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to settle return verification');

      await fetchReturnVerifications();
      addToast('Return verification settled successfully', 'success');
    },
    [fetchReturnVerifications, addToast]
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const hasSession = await restoreSession();
        await Promise.all([fetchProducts(), fetchSettings()]);
        if (hasSession) {
          await Promise.all([
            fetchOrders(),
            loadCartFromServer() // Load cart from server after login
          ]);
        }
      } finally {
        setIsBootstrapping(false);
      }
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustCredits = useCallback(
    async (userId: string, amount: number, reason: string) => {
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, creditBalance: (u.creditBalance || 0) + amount } : u
        )
      );

      try {
        await fetch(`${BACKEND_URL}/api/users/${userId}/credits`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amount, reason })
        });
      } catch {
        addToast('Failed to sync credits to MongoDB', 'warning');
      }
    },
    [addToast]
  );

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/users`, {
        credentials: 'include'
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load users');

      const list = Array.isArray(data?.users) ? data.users : [];
      setUsers(list);
      if (list.length === 0) {
        setUserStats({});
        return list as User[];
      }

      try {
        const statsRes = await fetch(`${BACKEND_URL}/api/users/stats`, {
          credentials: 'include'
        });
        const statsData = await statsRes.json().catch(() => ({}));
        if (!statsRes.ok) {
          throw new Error(statsData?.error || 'Failed to load user stats');
        }

        const statsList = Array.isArray(statsData?.stats) ? statsData.stats : [];
        const nextStats = statsList.reduce((acc: Record<string, UserStatsSummary>, stats: any) => {
          if (!stats?.userId) return acc;
          acc[stats.userId] = {
            userId: stats.userId,
            orderCount: Number(stats.orderCount || 0),
            totalSpend: Number(stats.totalSpend || 0),
            lastOrderAt: stats.lastOrderAt ?? null
          };
          return acc;
        }, {});
        setUserStats(nextStats);
      } catch {
        // best-effort stats fetch
      }
      return list as User[];
    } catch (e: any) {
      addToast(e?.message ?? 'Users feed offline', 'warning');
      return [];
    }
  }, [addToast]);

  const fetchUserStats = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/users/${userId}/stats`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load user stats');
      const stats = data?.stats;
      if (stats?.userId) {
        const mapped: UserStatsSummary = {
          userId: stats.userId,
          orderCount: Number(stats.orderCount || 0),
          totalSpend: Number(stats.totalSpend || 0),
          lastOrderAt: stats.lastOrderAt ?? null
        };
        setUserStats(prev => ({ ...prev, [stats.userId]: mapped }));
        return mapped;
      }
    } catch {
      // best-effort stats fetch
    }
    return null;
  }, []);

  const updateUserProfile = useCallback(
    async (id: string, updates: Partial<User>) => {
      const res = await fetch(`${BACKEND_URL}/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update user failed');

      const updated = data.user as User;
      setUsers(prev => prev.map(u => (u.id === id ? updated : u)));
      addToast('USER UPDATED', 'success');

      if (currentUser?.id === id) {
        setCurrentUser(updated);
      }

      return updated;
    },
    [addToast, currentUser?.id]
  );

  const redeemPoints = useCallback(
    async (points: number) => {
      if (!currentUser?.id) return;

      try {
        const res = await fetch(`${BACKEND_URL}/api/users/${currentUser.id}/redeem-points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ points })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Redeem failed');

        const updated = data.user as User;
        setCurrentUser(updated);
        setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
        addToast('POINTS CONVERTED', 'success');
      } catch (e: any) {
        addToast(e?.message || 'Redeem failed', 'warning');
      }
    },
    [addToast, currentUser?.id]
  );

  const updateOrder = useCallback(
    async (id: string, status: OrderStatus, metadata?: any) => {
      if (!id) {
        addToast('Order update failed: missing order id', 'warning');
        return;
      }

      setOrders(prev => prev.map(o => (o.id === id ? { ...o, status, ...metadata } : o)));

      try {
        const res = await fetch(`${BACKEND_URL}/api/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status, ...metadata })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Order update failed');
      } catch {
        addToast('Order update failed to sync', 'warning');
      }
    },
    [addToast]
  );

  return {
    currentUser,
    setCurrentUser,
    users,
    setUsers,
    userStats,
    settings,
    setSettings,
    products,
    setProducts,
    orders,
    setOrders,
    approvals,
    setApprovals,
    auditLogs,
    setAuditLogs,
    cart,
    setCart,

    toasts,
    addToast,

    clearCart,

    adjustCredits,
    updateOrder,
    fetchUsers,
    fetchUserStats,
    updateUserProfile,
    redeemPoints,

    isBackendOnline,
    syncWithBackend,
    isBootstrapping,
    lastSyncTime,
    refreshDashboardData,
    refreshDashboardDataSafe,

    restoreSession,
    logout,

    fetchProducts,
    fetchSettings,
    createProduct,
    updateProduct,
    deleteProduct,

    fetchOrders,
    fetchApprovals,
    fetchAuditLogs,
    fetchReturnVerifications,
    settleReturnVerification
  };
};
