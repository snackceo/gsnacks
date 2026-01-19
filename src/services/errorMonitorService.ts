// src/services/errorMonitorService.ts
import * as Sentry from '@sentry/react';

export interface ErrorEvent {
  id: string;
  message: string;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
  url?: string;
  stackTrace?: string;
  userId?: string;
  context?: Record<string, any>;
}

// Initialize error collection
const MAX_STORED_ERRORS = 50;
const STORAGE_KEY = 'ninpo_error_events';

/**
 * Store error event in localStorage for dashboard display
 */
export function storeErrorEvent(event: ErrorEvent): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const errors: ErrorEvent[] = stored ? JSON.parse(stored) : [];
    
    errors.unshift(event);
    
    // Keep only recent errors
    if (errors.length > MAX_STORED_ERRORS) {
      errors.length = MAX_STORED_ERRORS;
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(errors));
  } catch (e) {
    console.error('Failed to store error event:', e);
  }
}

/**
 * Capture and track an error
 */
export function captureError(
  error: Error | string,
  context?: Record<string, any>,
  level: 'error' | 'warning' | 'info' = 'error'
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const stackTrace = error instanceof Error ? error.stack : undefined;
  
  // Send to Sentry
  if (error instanceof Error) {
    Sentry.captureException(error, {
      level,
      extra: context
    });
  } else {
    Sentry.captureMessage(errorMessage, {
      level,
      extra: context
    });
  }
  
  // Store locally for dashboard
  const errorEvent: ErrorEvent = {
    id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    message: errorMessage,
    level,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    stackTrace,
    context
  };
  
  storeErrorEvent(errorEvent);
}

/**
 * Fetch recent error events from localStorage
 */
export async function fetchRecentErrors(): Promise<ErrorEvent[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch recent errors:', error);
    return [];
  }
}

/**
 * Clear stored errors
 */
export function clearStoredErrors(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear errors:', e);
  }
}

/**
 * Get error statistics
 */
export async function getErrorStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  recent: ErrorEvent[];
}> {
  const errors = await fetchRecentErrors();
  
  const byLevel: Record<string, number> = {
    error: 0,
    warning: 0,
    info: 0
  };
  
  errors.forEach(err => {
    byLevel[err.level] = (byLevel[err.level] || 0) + 1;
  });
  
  return {
    total: errors.length,
    byLevel,
    recent: errors.slice(0, 10)
  };
}

// Set up global error handler
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    captureError(event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    captureError(
      event.reason instanceof Error ? event.reason : String(event.reason),
      { type: 'unhandled_promise_rejection' }
    );
  });
}
