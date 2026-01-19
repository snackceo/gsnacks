import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';

import App from './App';
import './index.css';

// Initialize Sentry for error tracking and performance monitoring
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION || '1.0.0',
  sendDefaultPii: true,
  
  // Performance Monitoring
  tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  
  // Session Replay (optional - captures user sessions for debugging)
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
  
  // Integrations
  integrations: [
    Sentry.browserTracingIntegration({
      // Trace all navigation
      enableInp: true,
    }),
    Sentry.replayIntegration({
      maskAllText: false, // Set to true in production for privacy
      blockAllMedia: false,
    }),
  ],
  
  // Filter out common non-critical errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
    'Network request failed',
    'Failed to fetch',
  ],
  
  // Add custom tags
  initialScope: {
    tags: {
      app: 'ninpo-snacks',
      component: 'frontend',
    },
  },
  
  // Before send hook to add custom context
  beforeSend(event, hint) {
    // Add user agent info
    if (event.request) {
      event.request.headers = {
        ...event.request.headers,
        'User-Agent': navigator.userAgent,
      };
    }
    
    // Log errors in development
    if (import.meta.env.MODE === 'development') {
      console.error('Sentry Event:', event, hint);
    }
    
    return event;
  },
});

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <Sentry.ErrorBoundary fallback={<div>An error occurred. Please refresh the page.</div>}>
          <App />
        </Sentry.ErrorBoundary>
      </BrowserRouter>
    </StrictMode>
  );
}
