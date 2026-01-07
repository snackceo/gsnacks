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

/**
 * LOGISTICS HUB CONFIGURATION
 */
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';

export const useNinpoCore = () => {
  const [toasts, setToasts] = useState<
    { id: string; message: string; type: 'info' | 'success' | 'warning' }[]
  >([]);

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

  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>(
    []
  );

  const addToast = useCallback(
    (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(
        () => setToasts(prev => prev.filter(t => t.id !== id)),
        4000
      );
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

  const adjustCredits = useCallback(
    async (userId: string, amount: number, reason: string) => {
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, credits: u.credits + amount } : u
        )
      );

      try {
        await fetch(`${BACKEND_URL}/api/users/${userId}/credits`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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
      setOrders(prev =>
        prev.map(o => (o.id === id ? { ...o, status, ...metadata } : o))
      );

      try {
        await fetch(`${BACKEND_URL}/api/orders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, ...metadata })
        });
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
    syncWithBackend
  };
};
