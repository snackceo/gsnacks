// server/instrument.js
// Sentry initialization - must be imported FIRST before any other modules
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://710b85ed673cecc2a0d59df6c7ff85f3@o4510730569711616.ingest.us.sentry.io/4510737740660736",
  
  // Environment tracking
  environment: process.env.NODE_ENV || 'development',
  
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Integrations
  integrations: [
    // Enable HTTP instrumentation
    Sentry.httpIntegration(),
    // Enable Express instrumentation
    Sentry.expressIntegration(),
    // Enable MongoDB instrumentation
    Sentry.mongoIntegration(),
  ],
  
  // Before send hook for filtering
  beforeSend(event, hint) {
    // Don't send health check errors
    if (event.request?.url?.includes('/api/health')) {
      return null;
    }
    
    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Sentry Event:', event, hint);
    }
    
    return event;
  },
});

export default Sentry;

