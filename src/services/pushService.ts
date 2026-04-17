/**
 * Push Notification Service
 * Handles browser push notifications (FREE - no Twilio needed)
 */

/**
 * Helper: Convert VAPID key to Uint8Array
 */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
};

/**
 * Save push subscription to server
 */
const saveSubscriptionToServer = async (subscription: PushSubscription): Promise<void> => {
  try {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    
    await fetch(`${API_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(subscription),
    });
    
    console.log('[Push] Subscription saved to server');
  } catch (error) {
    console.error('[Push] Failed to save subscription:', error);
  }
};

/**
 * Remove push subscription from server
 */
const removeSubscriptionFromServer = async (subscription: PushSubscription): Promise<void> => {
    try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
        await fetch(`${API_URL}/api/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(subscription),
        });
        console.log('[Push] Subscription removed from server');
    }
    catch (error) {
        console.error('[Push] Failed to remove subscription:', error);
    }
};
/**
 * Check if push notifications are supported
 */
export const isPushSupported = (): boolean => {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
};

/**
 * Get current notification permission status
 */
export const getNotificationPermission = (): NotificationPermission => {
  return Notification.permission;
};

/**
 * Request permission for push notifications (works WITHOUT VAPID keys)
 * Local notifications don't require any backend setup
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isPushSupported()) {
    console.log('[Push] Push notifications not supported in this browser');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    console.log('[Push] Notification permission was denied by user');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    console.log('[Push] Permission result:', permission);
    return permission === 'granted';
  } catch (error) {
    console.log('[Push] Error requesting permission:', error);
    return false;
  }
};

/**
 * Register service worker
 */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('[SW] Service worker registered:', registration);
    return registration;
  } catch (error) {
    console.error('[SW] Service worker registration failed:', error);
    return null;
  }
};

/**
 * Subscribe to push notifications (optional - only if VAPID keys configured)
 * Works with or without VAPID keys
 * 
 * To enable server-side push:
 * 1. Generate VAPID keys (FREE): npx web-push generate-vapid-keys
 * 2. Add to .env: VITE_VAPID_PUBLIC_KEY=your-key
 * 3. Server sends push notifications
 * 
 * Without VAPID keys: Local notifications still work perfectly
 */
export const subscribeToPush = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) {
    console.log('[Push] Push notifications not supported in this browser');
    return null;
  }

  try {
    // First register service worker
    const registration = await registerServiceWorker();
    if (!registration) {
      console.log('[Push] Service worker registration failed, local notifications only');
      return null;
    }

    // Wait for service worker to be ready
    const swRegistration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await swRegistration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('[Push] Already subscribed to push');
      return subscription;
    }

    // Request permission
    const permitted = await requestNotificationPermission();
    if (!permitted) {
      console.log('[Push] User denied notification permission');
      return null;
    }

    // Check if VAPID key is configured
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
    
    if (!vapidPublicKey) {
      console.log('[Push] No VAPID key configured - local notifications enabled, server push disabled');
      console.log('[Push] To enable server push notifications, generate free VAPID keys:');
      console.log('[Push]   npx web-push generate-vapid-keys');
      return null;
    }

    // Subscribe to push with VAPID key
    subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    console.log('[Push] Successfully subscribed to server push');
    
    // Send subscription to server
    await saveSubscriptionToServer(subscription);
    
    return subscription;
  } catch (error) {
    console.log('[Push] Push subscription optional - app works without it:', error);
    return null;
  }
};

/**
 * Unsubscribe from push notifications
 */
export const unsubscribeFromPush = async (): Promise<boolean> => {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      return true;
    }

    const success = await subscription.unsubscribe();
    
    if (success) {
      console.log('[Push] Unsubscribed successfully');
      // Remove subscription from server
      await removeSubscriptionFromServer(subscription);
    }
    
    return success;
  } catch (error) {
    console.error('[Push] Unsubscribe failed:', error);
    return false;
  }
};

/**
 * Show a local notification (FREE - no VAPID keys needed!)
 * Works perfectly without any backend setup
 */
export const showLocalNotification = async (title: string, options?: NotificationOptions) => {
  if (!isPushSupported()) {
    console.log('[Push] Notifications not supported in this browser');
    return;
  }

  const permitted = await requestNotificationPermission();
  if (!permitted) {
    console.log('[Push] User notification permission not granted');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      icon: '/logo.png',
      badge: '/badge.png',
      ...(options || {}),
    } as NotificationOptions);
    console.log('[Push] Local notification shown:', title);
  } catch (error) {
    console.log('[Push] Local notification error:', error);
  }
};
