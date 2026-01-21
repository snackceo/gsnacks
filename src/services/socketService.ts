let socket: any = null;
let socketIo: any = null;
let socketLoadFailed = false;
let socketLoadAttempted = false;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Lazy-load socket.io-client to avoid initialization errors
 * Wrapped in try-catch to prevent app crashes
 */
const getIoClient = async () => {
  if (socketLoadFailed || socketLoadAttempted) {
    return null; // Don't retry
  }

  socketLoadAttempted = true;

  try {
    // Use a timeout to prevent hanging
    const loadPromise = import('socket.io-client');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('socket.io-client load timeout')), 5000)
    );

    const module = await Promise.race([loadPromise, timeoutPromise]);
    socketIo = (module as any).io;
    return socketIo;
  } catch (error) {
    console.warn('[Socket] socket.io-client unavailable, sync features disabled:', error);
    socketLoadFailed = true;
    return null;
  }
};

/**
 * Initialize WebSocket connection and join user-specific room
 * Fully deferred and defensive - won't crash app if socket fails
 */
export const connectSocket = async (userId: string) => {
  try {
    if (socket?.connected) {
      console.log('[Socket] Already connected');
      return socket;
    }

    // Defer to next tick
    await new Promise(resolve => setTimeout(resolve, 500));

    const io = await getIoClient();
    if (!io) {
      console.log('[Socket] WebSocket not available, sync features disabled');
      return null;
    }

    socket = io(API_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
      socket?.emit('join', userId);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
    });

    socket.on('connect_error', (error: any) => {
      console.error('[Socket] Connection error:', error?.message || error);
    });

    return socket;
  } catch (error) {
    console.warn('[Socket] Connection skipped, app will work without real-time sync:', error);
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
export const getSocket = (): any => {
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
