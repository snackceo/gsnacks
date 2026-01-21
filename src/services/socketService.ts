import type { Socket } from 'socket.io-client';

let socket: Socket | null = null;
let socketIo: typeof import('socket.io-client').io | null = null;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Lazy-load socket.io-client to avoid initialization errors
 */
const getIoClient = async () => {
  if (!socketIo) {
    try {
      const module = await import('socket.io-client');
      socketIo = module.io;
    } catch (error) {
      console.error('[Socket] Failed to load socket.io-client:', error);
      return null;
    }
  }
  return socketIo;
};

/**
 * Initialize WebSocket connection and join user-specific room
 */
export const connectSocket = async (userId: string) => {
  if (socket?.connected) {
    console.log('[Socket] Already connected');
    return socket;
  }

  try {
    const io = await getIoClient();
    if (!io) {
      console.warn('[Socket] socket.io-client not available');
      return null;
    }

    socket = io(API_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
      
      // Join user-specific room for targeted updates
      socket?.emit('join', userId);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
    });

    socket.on('connect_error', (error: any) => {
      console.error('[Socket] Connection error:', error.message);
    });

    return socket;
  } catch (error) {
    console.error('[Socket] Connection failed:', error);
    return null;
  }
};

/**
 * Disconnect WebSocket
 */
export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('[Socket] Manually disconnected');
  }
};

/**
 * Get active socket instance
 */
export const getSocket = (): Socket | null => {
  return socket;
};

/**
 * Subscribe to cart updates
 */
export const onCartUpdate = (callback: (data: any) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for cart:updated listener');
    return () => {};
  }
  socket?.on('cart:updated', callback);
  return () => socket?.off('cart:updated', callback);
};

/**
 * Subscribe to driver not-found items updates
 */
export const onDriverNotFoundUpdate = (callback: (data: { orderId: string; items: any[] }) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for driver-not-found:updated listener');
    return () => {};
  }
  socket?.on('driver-not-found:updated', callback);
  return () => socket?.off('driver-not-found:updated', callback);
};

/**
 * Subscribe to driver not-found items deletion
 */
export const onDriverNotFoundDelete = (callback: (data: { orderId: string }) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for driver-not-found:deleted listener');
    return () => {};
  }
  socket?.on('driver-not-found:deleted', callback);
  return () => socket?.off('driver-not-found:deleted', callback);
};

/**
 * Subscribe to return UPCs updates
 */
export const onReturnUpcsUpdate = (callback: (data: { upcs: string[]; eligibilityCache: any }) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for return-upcs:updated listener');
    return () => {};
  }
  socket?.on('return-upcs:updated', callback);
  return () => socket?.off('return-upcs:updated', callback);
};

/**
 * Subscribe to return UPCs deletion
 */
export const onReturnUpcsDelete = (callback: () => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for return-upcs:deleted listener');
    return () => {};
  }
  socket?.on('return-upcs:deleted', callback);
  return () => socket?.off('return-upcs:deleted', callback);
};

/**
 * Subscribe to order updates (for dashboard)
 */
export const onOrderUpdate = (callback: (data: any) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for order:updated listener');
    return () => {};
  }
  socket?.on('order:updated', callback);
  return () => socket?.off('order:updated', callback);
};

/**
 * Subscribe to new orders (for dashboard)
 */
export const onOrderCreated = (callback: (data: any) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for order:created listener');
    return () => {};
  }
  socket?.on('order:created', callback);
  return () => socket?.off('order:created', callback);
};

/**
 * Subscribe to product updates (for dashboard)
 */
export const onProductUpdate = (callback: (data: any) => void) => {
  if (!socket) {
    console.warn('[Socket] Socket not connected for product:updated listener');
    return () => {};
  }
  socket?.on('product:updated', callback);
  return () => socket?.off('product:updated', callback);
};
