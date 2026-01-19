// src/services/errorMonitorService.ts
import * as Sentry from '@sentry/react';

export interface ErrorEvent {
  id: string;
  message: string;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
  url?: string;
}

// Fetch recent error events - currently uses localStorage as fallback
// In production, integrate with Sentry's API or a backend endpoint
export async function fetchRecentErrors(): Promise<ErrorEvent[]> {
  try {
    // Get stored errors from localStorage (populated by Sentry's before-send hook)
    const storedErrors = localStorage.getItem('sentry_recent_errors');
    if (storedErrors) {
      return JSON.parse(storedErrors);
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch recent errors:', error);
    return [];
  }
}
