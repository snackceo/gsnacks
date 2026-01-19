import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';

import App from './App';
import './index.css';

// Initialize Sentry for error tracking
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION || '1.0.0',
  sendDefaultPii: true,
  // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring
  tracesSampleRate: 1.0
});

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
}
