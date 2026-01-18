// src/services/errorMonitorService.ts
// Simulated error monitoring service integration (replace with real API calls as needed)

export interface ErrorEvent {
  id: string;
  message: string;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
  url?: string;
}

// Simulate fetching recent error events (replace with real API call)
export async function fetchRecentErrors(): Promise<ErrorEvent[]> {
  // In production, fetch from your error monitoring provider's API
  return [
    {
      id: 'evt1',
      message: 'Unhandled exception in /api/orders',
      level: 'error',
      timestamp: new Date().toISOString(),
      url: 'https://monitoring.example.com/event/evt1'
    },
    {
      id: 'evt2',
      message: 'Database connection timeout',
      level: 'warning',
      timestamp: new Date(Date.now() - 3600 * 1000).toISOString(),
      url: 'https://monitoring.example.com/event/evt2'
    }
  ];
}
