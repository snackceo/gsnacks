// src/services/errorMonitorService.ts
import * as Sentry from '@sentry/react';
import { apiFetch } from '../apiFetch';

export interface ErrorEvent {
  id: string; // The frontend component uses `id`. We will map _id to id.
  _id: string;
  message: string;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
  url?: string;
  stackTrace?: string;
  userId?: string;
  context?: Record<string, any>;
}

type ErrorEventInput = Omit<ErrorEvent, 'id' | '_id' | 'timestamp'>;

/**
 * Log error event to the backend.
 */
export async function logErrorEvent(event: ErrorEventInput): Promise<void> {
  try {
    await apiFetch('/api/v1/errors', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  } catch (e) {
    console.error('Failed to log error event to backend:', e);
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

  // Log to our backend
  const errorEvent: ErrorEventInput = {
    message: errorMessage,
    level,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    stackTrace,
    context
  };

  logErrorEvent(errorEvent);
}

/**
 * Fetch recent error events from the backend.
 */
export async function fetchRecentErrors(): Promise<ErrorEvent[]> {
  try {
    const { data } = await apiFetch<{ data: ErrorEvent[] }>('/api/v1/errors');
    // The frontend component expects an `id` property.
    return data.map(event => ({ ...event, id: event._id }));
  } catch (error) {
    console.error('Failed to fetch recent errors:', error);
    // Return a synthetic error to display on the dashboard
    return [
      {
        id: 'fetch-error-1',
        _id: 'fetch-error-1',
        message: 'Failed to fetch error events from the server.',
        level: 'error',
        timestamp: new Date().toISOString(),
      },
    ];
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
    info: 0,
  };

  errors.forEach(err => {
    byLevel[err.level] = (byLevel[err.level] || 0) + 1;
  });

  return {
    total: errors.length,
    byLevel,
    recent: errors.slice(0, 10),
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
