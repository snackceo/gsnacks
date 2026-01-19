// src/services/analyticsService.ts
import * as Sentry from '@sentry/react';

export interface AnalyticsEvent {
  category: 'user' | 'product' | 'order' | 'scanner' | 'returns' | 'payment' | 'navigation';
  action: string;
  label?: string;
  value?: number;
  metadata?: Record<string, any>;
}

class AnalyticsService {
  private enabled: boolean = true;

  constructor() {
    // Check if analytics should be disabled (e.g., development mode)
    this.enabled = import.meta.env.MODE !== 'development' || 
                   import.meta.env.VITE_ANALYTICS_DEBUG === 'true';
  }

  /**
   * Track a custom event
   */
  trackEvent(event: AnalyticsEvent): void {
    if (!this.enabled) {
      console.log('[Analytics - Debug]', event);
      return;
    }

    // Send to Sentry as breadcrumb
    Sentry.addBreadcrumb({
      category: event.category,
      message: event.action,
      level: 'info',
      data: {
        label: event.label,
        value: event.value,
        ...event.metadata
      }
    });

    // Store locally for dashboard
    this.storeEvent(event);
  }

  /**
   * Track page view
   */
  trackPageView(page: string, userId?: string): void {
    this.trackEvent({
      category: 'navigation',
      action: 'page_view',
      label: page,
      metadata: { userId, timestamp: new Date().toISOString() }
    });
  }

  /**
   * Track user action
   */
  trackUserAction(action: string, details?: Record<string, any>): void {
    this.trackEvent({
      category: 'user',
      action,
      metadata: details
    });
  }

  /**
   * Track product interaction
   */
  trackProductInteraction(action: 'view' | 'add_to_cart' | 'remove_from_cart', productId: string, productName?: string): void {
    this.trackEvent({
      category: 'product',
      action,
      label: productName,
      metadata: { productId }
    });
  }

  /**
   * Track order events
   */
  trackOrder(action: 'initiated' | 'completed' | 'failed', orderId?: string, total?: number): void {
    this.trackEvent({
      category: 'order',
      action: `order_${action}`,
      label: orderId,
      value: total,
      metadata: { orderId, total }
    });
  }

  /**
   * Track scanner usage
   */
  trackScanner(action: 'opened' | 'scanned' | 'success' | 'error', details?: Record<string, any>): void {
    this.trackEvent({
      category: 'scanner',
      action: `scanner_${action}`,
      metadata: details
    });
  }

  /**
   * Track bottle return events
   */
  trackReturn(action: 'started' | 'container_scanned' | 'completed' | 'cancelled', containerCount?: number, credit?: number): void {
    this.trackEvent({
      category: 'returns',
      action: `return_${action}`,
      value: containerCount,
      metadata: { containerCount, credit }
    });
  }

  /**
   * Track payment events
   */
  trackPayment(method: 'credits' | 'stripe' | 'gpay', status: 'initiated' | 'success' | 'failed', amount?: number, error?: string): void {
    this.trackEvent({
      category: 'payment',
      action: `payment_${status}`,
      label: method,
      value: amount,
      metadata: { method, amount, error }
    });
  }

  /**
   * Set user context for Sentry
   */
  setUser(userId: string, email?: string, tier?: string): void {
    Sentry.setUser({
      id: userId,
      email,
      tier
    });
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    Sentry.setUser(null);
  }

  /**
   * Track error manually
   */
  trackError(error: Error, context?: Record<string, any>): void {
    Sentry.captureException(error, {
      extra: context
    });
  }

  /**
   * Store event in localStorage for dashboard
   */
  private storeEvent(event: AnalyticsEvent): void {
    try {
      const key = 'ninpo_analytics_events';
      const stored = localStorage.getItem(key);
      const events = stored ? JSON.parse(stored) : [];
      
      // Keep only last 100 events
      events.push({
        ...event,
        timestamp: new Date().toISOString()
      });
      
      if (events.length > 100) {
        events.shift();
      }
      
      localStorage.setItem(key, JSON.stringify(events));
    } catch (e) {
      // Silently fail if localStorage is full or unavailable
    }
  }

  /**
   * Get stored analytics events (for admin dashboard)
   */
  getStoredEvents(): (AnalyticsEvent & { timestamp: string })[] {
    try {
      const key = 'ninpo_analytics_events';
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Clear stored events
   */
  clearStoredEvents(): void {
    try {
      localStorage.removeItem('ninpo_analytics_events');
    } catch {
      // Silently fail
    }
  }

  /**
   * Get analytics summary
   */
  getSummary(): {
    totalEvents: number;
    eventsByCategory: Record<string, number>;
    recentEvents: (AnalyticsEvent & { timestamp: string })[];
  } {
    const events = this.getStoredEvents();
    const eventsByCategory: Record<string, number> = {};
    
    events.forEach(event => {
      eventsByCategory[event.category] = (eventsByCategory[event.category] || 0) + 1;
    });
    
    return {
      totalEvents: events.length,
      eventsByCategory,
      recentEvents: events.slice(-10)
    };
  }
}

// Export singleton instance
export const analytics = new AnalyticsService();
