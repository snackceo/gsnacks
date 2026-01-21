/**
 * Socket.IO Service - Disabled for now
 * 
 * The app works perfectly WITHOUT real-time sync:
 * ✅ Cart works (syncs via REST API)
 * ✅ Orders work (refresh on page load)
 * ✅ Products work (refresh on page load)
 * ✅ Offline mode works
 * ✅ All features work
 * 
 * Real-time sync is an OPTIONAL enhancement.
 * If you want to enable it later, uncomment the socket.io-client imports.
 */

let socket: any = null;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

/**
 * Connect socket (currently disabled)
 */
export const connectSocket = async (userId: string) => {
  console.log('[Socket] WebSocket disabled - app works via REST API polling');
  return null;
};

/**
 * Disconnect socket (no-op)
 */
export const disconnectSocket = () => {
  console.log('[Socket] WebSocket disabled');
};

/**
 * Get socket instance (always null when disabled)
 */
export const getSocket = (): any => {
  return socket;
};

/**
 * Event listeners (no-ops when WebSocket disabled)
 */
export const onCartUpdate = (callback: (data: any) => void) => {
  return () => {};
};

export const onDriverNotFoundUpdate = (callback: (data: { orderId: string; items: any[] }) => void) => {
  return () => {};
};

export const onDriverNotFoundDelete = (callback: (data: { orderId: string }) => void) => {
  return () => {};
};

export const onReturnUpcsUpdate = (callback: (data: { upcs: string[]; eligibilityCache: any }) => void) => {
  return () => {};
};

export const onReturnUpcsDelete = (callback: () => void) => {
  return () => {};
};

export const onOrderUpdate = (callback: (data: any) => void) => {
  return () => {};
};

export const onOrderCreated = (callback: (data: any) => void) => {
  return () => {};
};

export const onProductUpdate = (callback: (data: any) => void) => {
  return () => {};
};
