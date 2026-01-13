import { useState, useEffect, useCallback } from 'react';
import {
  User,
  Product,
  Order,
  OrderStatus,
  AppSettings,
  ApprovalRequest,
  AuditLog,
  UserStatsSummary
} from '../types';
import { MOCK_PRODUCTS } from '../constants';

const runtimeBackendUrl = () => {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'ninposnacks.com' || host.endsWith('.ninposnacks.com')) {
      return 'https://api.ninposnacks.com';
    }
  }

  return 'http://localhost:5000';
};

const BACKEND_URL = runtimeBackendUrl();
const allowPlatinumTier = (import.meta as any).env?.VITE_ALLOW_PLATINUM_TIER === 'true';
const SETTINGS_STORAGE_KEY = 'ninpo:settings';

const defaultSettings: AppSettings = {
  deliveryFee: 4.99,
  referralBonus: 5.0,
  michiganDepositValue: 0.1,
  processingFeePercent: 0.05,
  returnHandlingFeePerContainer: 0.02,
  glassHandlingFeePerContainer: 0.02,
  pickupOnlyMultiplier: 0.5,
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0,
  dailyReturnLimit: 250,
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier,
  platinumFreeDelivery: false
};

const normalizeSettings = (raw?: Partial<AppSettings> | null): AppSettings => {
  const data = raw ?? {};
  return {
    ...defaultSettings,
    ...data,
    deliveryFee: Number(data.deliveryFee ?? defaultSettings.deliveryFee),
    referralBonus: Number(data.referralBonus ?? defaultSettings.referralBonus),
    michiganDepositValue: Number(
      data.michiganDepositValue ?? defaultSettings.michiganDepositValue
    ),
    processingFeePercent: Number(
      data.processingFeePercent ?? defaultSettings.processingFeePercent
    ),
    returnHandlingFeePerContainer: Number(
      data.returnHandlingFeePerContainer ?? defaultSettings.returnHandlingFeePerContainer
    ),
    glassHandlingFeePerContainer: Number(
      data.glassHandlingFeePerContainer ?? defaultSettings.glassHandlingFeePerContainer
    ),
    pickupOnlyMultiplier: Number(
      data.pickupOnlyMultiplier ?? defaultSettings.pickupOnlyMultiplier
    ),
    distanceIncludedMiles: Number(
      data.distanceIncludedMiles ?? defaultSettings.distanceIncludedMiles
    ),
    distanceBand1MaxMiles: Number(
      data.distanceBand1MaxMiles ?? defaultSettings.distanceBand1MaxMiles
    ),
    distanceBand2MaxMiles: Number(
      data.distanceBand2MaxMiles ?? defaultSettings.distanceBand2MaxMiles
    ),
    distanceBand1Rate: Number(
      data.distanceBand1Rate ?? defaultSettings.distanceBand1Rate
    ),
    distanceBand2Rate: Number(
      data.distanceBand2Rate ?? defaultSettings.distanceBand2Rate
    ),
    distanceBand3Rate: Number(
      data.distanceBand3Rate ?? defaultSettings.distanceBand3Rate
    ),
    dailyReturnLimit: Number(data.dailyReturnLimit ?? defaultSettings.dailyReturnLimit),
    maintenanceMode: Boolean(
      data.maintenanceMode ?? defaultSettings.maintenanceMode
    ),
    requirePhotoForRefunds: Boolean(
      data.requirePhotoForRefunds ?? defaultSettings.requirePhotoForRefunds
    ),
    allowGuestCheckout: Boolean(
      data.allowGuestCheckout ?? defaultSettings.allowGuestCheckout
    ),
    showAdvancedInventoryInsights: Boolean(
      data.showAdvancedInventoryInsights ?? defaultSettings.showAdvancedInventoryInsights
    ),
    allowPlatinumTier: Boolean(
      data.allowPlatinumTier ?? defaultSettings.allowPlatinumTier
    ),
    platinumFreeDelivery: Boolean(
      data.platinumFreeDelivery ?? defaultSettings.platinumFreeDelivery
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userStats, setUserStats] = useState<Record<string, UserStatsSummary>>({});

  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings());

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info') => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    },
    []
  );

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const syncWithBackend = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sync`);
      setIsBackendOnline(res.ok);
    } catch {
      setIsBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    syncWithBackend();
    const i = setInterval(syncWithBackend, 30000);
    return () => clearInterval(i);
  }, [syncWithBackend]);

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
      setCurrentUser(null);
      addToast('SIGNED OUT', 'info');
    }
  }, [addToast]);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/products`, {
        credentials: 'include'
      });

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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings`, {
        credentials: 'include'
      });

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
          isGlass: (p as any).isGlass ?? false
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

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders`, {
        credentials: 'include'
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load orders');

      const list = Array.isArray(data?.orders) ? data.orders : [];
      setOrders(list);
      return list as Order[];
    } catch (e: any) {
      addToast(e?.message ?? 'Orders feed offline', 'warning');
      return [];
    }
  }, [addToast]);

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

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const hasSession = await restoreSession();
        await Promise.all([fetchProducts(), fetchSettings()]);
        if (hasSession) {
          await fetchOrders();
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
          u.id === userId
            ? { ...u, creditBalance: (u.creditBalance || 0) + amount }
            : u
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
        const nextStats = statsList.reduce(
          (acc: Record<string, UserStatsSummary>, stats: any) => {
            if (!stats?.userId) return acc;
            acc[stats.userId] = {
              userId: stats.userId,
              orderCount: Number(stats.orderCount || 0),
              totalSpend: Number(stats.totalSpend || 0),
              lastOrderAt: stats.lastOrderAt ?? null
            };
            return acc;
          },
          {}
        );
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

      setOrders(prev =>
        prev.map(o => (o.id === id ? { ...o, status, ...metadata } : o))
      );

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

    restoreSession,
    logout,

    fetchProducts,
    fetchSettings,
    createProduct,
    updateProduct,
    deleteProduct,

    fetchOrders,
    fetchApprovals,
    fetchAuditLogs
  };
};
