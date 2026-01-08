import { useState, useEffect, useCallback, useMemo } from 'react';
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

/**
 * LOGISTICS HUB CONFIGURATION
 */
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

type ToastType = 'info' | 'success' | 'warning';

type ApiError = {
  message: string;
  status?: number;
};

function asApiError(e: unknown, fallback = 'Request failed'): ApiError {
  if (typeof e === 'object' && e && 'message' in e) {
    return { message: String((e as any).message) };
  }
  return { message: fallback };
}

/**
 * Normalize user payloads from backend into your frontend User shape.
 * Handles common Mongo shapes: _id vs id.
 */
function normalizeUser(raw: any): User {
  if (!raw) return raw;
  const id = raw.id ?? raw._id;
  return { ...raw, id } as User;
}

export const useNinpoCore = () => {
  const [toasts, setToasts] = useState<
    { id: string; message: string; type: ToastType }[]
  >([]);

  const [isBackendOnline, setIsBackendOnline] = useState(true);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // NOTE: Keeping your local "users" state since it’s referenced elsewhere,
  // but authentication should now come from backend session (/api/auth/*).
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

  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(
    []
  );

  const addToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(
        () => setToasts(prev => prev.filter(t => t.id !== id)),
        4000
      );
    },
    []
  );

  /**
   * Central API helper:
   * - Always includes cookies (required for session persistence)
   * - JSON convenience
   * - Throws on non-2xx with readable error
   */
  const apiFetch = useCallback(
    async <T,>(
      path: string,
      opts?: RequestInit & { json?: any }
    ): Promise<T> => {
      const url =
        path.startsWith('http') ? path : `${BACKEND_URL}${path}`;

      const headers: Record<string, string> = {
        ...(opts?.headers as any)
      };

      const init: RequestInit = {
        ...opts,
        credentials: 'include'
      };

      if (opts?.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.json);
      }

      if (Object.keys(headers).length) init.headers = headers;

      const res = await fetch(url, init);

      // Try to parse JSON if possible
      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        if (isJson) {
          try {
            const data = await res.json();
            msg = data?.message || data?.error || msg;
          } catch {
            // ignore
          }
        } else {
          try {
            const text = await res.text();
            if (text) msg = text;
          } catch {
            // ignore
          }
        }
        const err: ApiError = { message: msg, status: res.status };
        throw err;
      }

      if (isJson) return (await res.json()) as T;

      // If endpoint returns empty or non-json, return as any
      return (undefined as unknown) as T;
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

  /**
   * Step 1: Restore session on first load
   * Calls GET /api/auth/me and sets currentUser if cookie session is valid.
   */
  const restoreSession = useCallback(async () => {
    try {
      // Common backend patterns:
      // - returns { user: {...} }
      // - or returns the user directly
      const data = await apiFetch<any>('/api/auth/me', { method: 'GET' });
      const rawUser = data?.user ?? data;
      if (rawUser) setCurrentUser(normalizeUser(rawUser));
      else setCurrentUser(null);
    } catch (e) {
      // 401 = not logged in, not an error for restore
      setCurrentUser(null);
    }
  }, [apiFetch]);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  /**
   * Auth actions (frontend should call these instead of in-memory logic)
   */
  const register = useCallback(
    async (username: string, password: string) => {
      try {
        const data = await apiFetch<any>('/api/auth/register', {
          method: 'POST',
          json: { username, password }
        });
        const rawUser = data?.user ?? data;
        setCurrentUser(rawUser ? normalizeUser(rawUser) : null);
        addToast('Account created', 'success');
        return rawUser;
      } catch (e) {
        const err = asApiError(e, 'Registration failed');
        addToast(err.message, 'warning');
        throw e;
      }
    },
    [apiFetch, addToast]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const data = await apiFetch<any>('/api/auth/login', {
          method: 'POST',
          json: { username, password }
        });
        const rawUser = data?.user ?? data;
        setCurrentUser(rawUser ? normalizeUser(rawUser) : null);
        addToast('Logged in', 'success');
        return rawUser;
      } catch (e) {
        const err = asApiError(e, 'Login failed');
        addToast(err.message, 'warning');
        throw e;
      }
    },
    [apiFetch, addToast]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // even if backend fails, clear local user to protect UX
    } finally {
      setCurrentUser(null);
      addToast('Logged out', 'info');
    }
  }, [apiFetch, addToast]);

  /**
   * Optional: attempt to load real products (non-breaking).
   * If endpoint doesn't exist yet, this silently keeps MOCK_PRODUCTS.
   */
  const loadProducts = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/api/products', { method: 'GET' });
      const list = Array.isArray(data) ? data : data?.products;
      if (Array.isArray(list)) {
        // Normalize common Mongo id shapes
        const normalized = list.map((p: any) => ({
          ...p,
          id: p.id ?? p._id
        }));
        setProducts(normalized);
      }
    } catch {
      // ignore; fallback is MOCK_PRODUCTS
    }
  }, [apiFetch]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const adjustCredits = useCallback(
    async (userId: string, amount: number, reason: string) => {
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, credits: (u as any).credits + amount } : u
        )
      );

      try {
        await apiFetch(`/api/users/${userId}/credits`, {
          method: 'PATCH',
          json: { amount, reason }
        });
      } catch {
        addToast('Failed to sync credits to MongoDB', 'warning');
      }
    },
    [apiFetch, addToast]
  );

  const updateOrder = useCallback(
    async (id: string, status: OrderStatus, metadata?: any) => {
      setOrders(prev =>
        prev.map(o => (o.id === id ? { ...o, status, ...metadata } : o))
      );

      try {
        await apiFetch(`/api/orders/${id}`, {
          method: 'PATCH',
          json: { status, ...metadata }
        });
      } catch {
        addToast('Order update failed to sync', 'warning');
      }
    },
    [apiFetch, addToast]
  );

  const isLoggedIn = useMemo(() => Boolean(currentUser), [currentUser]);

  return {
    // session/auth
    currentUser,
    setCurrentUser,
    isLoggedIn,
    restoreSession,
    register,
    login,
    logout,

    // existing state
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

    // utilities
    apiFetch,
    BACKEND_URL
  };
};
