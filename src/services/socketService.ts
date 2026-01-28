
import { io, Socket } from 'socket.io-client';
import { BACKEND_URL } from '../constants';

let socket: Socket | null = null;

export const connectSocket = async (userId: string) => {
  if (socket && socket.connected) return socket;
  socket = io(BACKEND_URL, { withCredentials: true });
  socket.on('connect', () => {
    socket?.emit('join', userId);
    console.log('[Socket] Connected and joined as', userId);
  });
  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
  });
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const onCartUpdate = (callback: (data: any) => void) => {
  if (!socket) return () => {};
  socket.on('cart:update', callback);
  return () => socket?.off('cart:update', callback);
};

export const onOrderUpdate = (callback: (data: any) => void) => {
  if (!socket) return () => {};
  socket.on('order:update', callback);
  return () => socket?.off('order:update', callback);
};

export const onOrderCreated = (callback: (data: any) => void) => {
  if (!socket) return () => {};
  socket.on('order:created', callback);
  return () => socket?.off('order:created', callback);
};

export const onProductUpdate = (callback: (data: any) => void) => {
  if (!socket) return () => {};
  socket.on('product:update', callback);
  return () => socket?.off('product:update', callback);
};

export const onDriverNotFoundUpdate = (callback: (data: { orderId: string; items: any[] }) => void) => {
  if (!socket) return () => {};
  socket.on('driver:notfound:update', callback);
  return () => socket?.off('driver:notfound:update', callback);
};

export const onDriverNotFoundDelete = (callback: (data: { orderId: string }) => void) => {
  if (!socket) return () => {};
  socket.on('driver:notfound:delete', callback);
  return () => socket?.off('driver:notfound:delete', callback);
};

export const onReturnUpcsUpdate = (callback: (data: { upcs: string[]; eligibilityCache: any }) => void) => {
  if (!socket) return () => {};
  socket.on('returnupcs:update', callback);
  return () => socket?.off('returnupcs:update', callback);
};

export const onReturnUpcsDelete = (callback: () => void) => {
  if (!socket) return () => {};
  socket.on('returnupcs:delete', callback);
  return () => socket?.off('returnupcs:delete', callback);
};

// Receipt deleted event for instant UI update
export const onReceiptCaptureDeleted = (callback: (data: { captureId: string }) => void) => {
  if (!socket) return () => {};
  socket.on('receipt:capture:deleted', callback);
  return () => socket?.off('receipt:capture:deleted', callback);
};
