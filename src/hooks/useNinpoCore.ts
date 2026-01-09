import { useState, useEffect, useCallback } from 'react';
import {
  User,
  Product,
  Order,
  OrderStatus,
  AppSettings,
  ApprovalRequest,
  AuditLog
} from '../types';
import { MOCK_PRODUCTS } from '../constants';

const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

type Toast = { id: string; message: string; type: 'info' | 'success' | 'warning' };

export const useNinpoCore = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState(true);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const [settings, setSettings] = useState<AppSettings>({
    deliveryFee: 2.99,
    referralBonus: 5.0,
    michiganDepositValue: 0.1,
    processingFeePercent: 0.05,
    glassHandlingFeePercent: 0.02,
    dailyReturnLimit: 25.0,
    maintenanceMode: false
  });

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

  // -------- Products ----------
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
      // fallback to mock so storefront still works
      setProducts(MOCK_PRODUCTS as any);
      addToast(e?.message ?? 'Using fallback products', 'warning');
      return MOCK_PRODUCTS as any;
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

  // -------- Orders (OWNER) ----------
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders`, {
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to load orders');
      }

      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data?.orders) ? data.orders : [];
      setOrders(list);
      return list as Order[];
    } catch (e: any) {
      addToast(e?.message ?? 'Orders feed offline', 'warning');
      return [];
    }
  }, [addToast]);

  // -------- Session restore (cookie-based) ----------
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

      // Normalize into your frontend User shape (best-effort)
      const mapped: any = {
        id: u?.id || u?.userId,
        name: u?.username || 'USER',
        username: u?.username,
        email: u?.username ? `${u.username}@ninposnacks.com` : undefined,
        role: u?.role || 'CUSTOMER'
      };

      setCurrentUser(mapped as User);

      // If OWNER, auto-load orders for dashboard
      if ((mapped?.role || '').toUpperCase() === 'OWNER') {
        fetchOrders();
      }

      return true;
    } catch {
      setCurrentUser(null);
      return false;
    }
  }, [fetchOrders]);

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

  // Load products + restore session on first mount
  useEffect(() => {
    restoreSession();
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Existing order/user helpers (kept) ----------
  const adjustCredits = useCallback(
    async (userId: string, amount: number, reason: string) => {
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, credits: (u.credits || 0) + amount } : u))
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

  const updateOrder = useCallback(
    async (id: string, status: OrderStatus, metadata?: any) => {
      setOrders(prev => prev.map(o => (o.id === id ? { ...o, status, ...metadata } : o)));

      try {
        const res = await fetch(`${BACKEND_URL}/api/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status, ...metadata })
        });

        // If backend returns updated order, reconcile
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const updated = data?.order;
          if (updated?.id) {
            setOrders(prev => prev.map(o => (o.id === id ? updated : o)));
          }
        }
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
    adjustCredits,
    updateOrder,
    isBackendOnline,
    syncWithBackend,

    // session + products
    restoreSession,
    logout,
    fetchProducts,
    createProduct,
    updateProduct,
    deleteProduct,

    // orders
    fetchOrders
  };
};
