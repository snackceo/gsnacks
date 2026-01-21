/**
 * Push Notification Service
 * Handles browser push notifications (FREE - no Twilio needed)
 */

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
 * Request permission for push notifications
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isPushSupported()) {
    console.warn('[Push] Push notifications not supported in this browser');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    console.warn('[Push] Notification permission denied');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    console.log('[Push] Permission result:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('[Push] Error requesting permission:', error);
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
 * Subscribe to push notifications
 * Note: This uses the browser's Push API - NO external service needed!
 */
export const subscribeToPush = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) {
    return null;
  }

  try {
    // First register service worker
    const registration = await registerServiceWorker();
    if (!registration) {
      return null;
    }

    // Wait for service worker to be ready
    const swRegistration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await swRegistration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('[Push] Already subscribed');
      return subscription;
    }

    // Request permission
    const permitted = await requestNotificationPermission();
    if (!permitted) {
      return null;
    }

    // Subscribe to push
    // Note: You can generate VAPID keys with: npx web-push generate-vapid-keys
    // For now, we'll use a placeholder - you should replace this with your own keys
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
    
    if (!vapidPublicKey) {
      console.warn('[Push] VAPID public key not configured - using browser notifications only');
      return null;
    }

    subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    console.log('[Push] Subscribed successfully:', subscription);
    
    // Send subscription to server
    await saveSubscriptionToServer(subscription);
    
    return subscription;
  } catch (error) {
    console.error('[Push] Subscription failed:', error);
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
 * Show a local notification (doesn't need push service)
 */
export const showLocalNotification = async (title: string, options?: NotificationOptions) => {
  if (!isPushSupported()) {
    return;
  }

  const permitted = await requestNotificationPermission();
  if (!permitted) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      icon: '/logo.png',
      badge: '/badge.png',
      ...(options || {}),
    } as NotificationOptions);
  } catch (error) {
    console.error('[Push] Local notification failed:', error);
  }
};

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
  } catch (error) {
    console.error('[Push] Failed to remove subscription:', error);
  }
};
