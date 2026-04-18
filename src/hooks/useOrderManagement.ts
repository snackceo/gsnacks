import { useState } from 'react';
import { Order, OrderStatus } from '../types';
import { useNinpoCore } from './useNinpoCore';
import { BACKEND_URL } from '../constants';

interface UseOrderManagementProps {
  orders: Order[];
  updateOrder: (id: string, status: OrderStatus, metadata?: any) => void;
}

export const useOrderManagement = ({ orders, updateOrder }: UseOrderManagementProps) => {
  const { addToast } = useNinpoCore();
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const handleAccept = async (orderId: string) => {
    if (!orderId) return;

    if (orderId.startsWith('detail-')) {
      setDetailOrderId(orderId.substring(7));
      return;
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/driver/accept-order`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to assign order');
      }

      const order = orders.find(o => o.id === orderId);
      if (order) {
        setActiveOrder(order);
      }
    } catch (err: any) {
      addToast(err?.message || 'Failed to assign order', 'warning');
    }
  };

  const handlePickUp = (orderId: string) => {
    if (!orderId) return;
    updateOrder(orderId, OrderStatus.PICKED_UP);
  };

  const handleStartNavigation = (orderId: string) => {
    if (!orderId) return;
    setIsNavigating(true);
    updateOrder(orderId, OrderStatus.ARRIVING);
    setTimeout(() => {
      setIsNavigating(false);
      alert('Navigation: You have arrived at the delivery address.');
    }, 5000);
  };

  return { activeOrder, setActiveOrder, detailOrderId, setDetailOrderId, isNavigating, handleAccept, handlePickUp, handleStartNavigation };
};