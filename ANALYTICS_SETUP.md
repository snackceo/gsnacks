# Analytics Setup Documentation

## Overview
NinpoSnacks is now equipped with comprehensive analytics and error monitoring powered by **Sentry**. This system tracks user behavior, errors, performance, and business metrics.

---

## What's Implemented

### ✅ Error Monitoring (Sentry)
- **Frontend**: React error boundaries, unhandled exceptions, promise rejections
- **Backend**: API errors, database errors, middleware failures
- **Features**:
  - Automatic error capture and reporting
  - Stack traces with source maps
  - User context (ID, email, tier)
  - Performance monitoring (page load, API response times)
  - Session replay (captures user sessions with errors)

### ✅ Usage Tracking
Custom event tracking for key business actions:

#### User Actions
- Login/logout events
- Page views with user context
- Account settings updates

#### Product Interactions
- Product views
- Add to cart events
- Remove from cart events

#### Shopping Flow
- Cart opened/closed
- Checkout initiated
- Payment method selected (credits, Stripe, Google Pay)
- Order completed/failed

#### Bottle Returns
- Scanner opened
- Containers scanned (with count)
- Return session completed (with credit amount)
- Return verification submitted

#### Scanner Usage
- Scanner session started
- Individual UPC scans
- Success/error rates
- Average scans per session

### ✅ Analytics Dashboard
Located in Management Panel → Analytics tab

**Features**:
- **Real-time Metrics**: Total events, page views, orders, returns
- **Conversion Tracking**: Product views → add to cart conversion rate
- **Order Analytics**: Completion rate, average order value, total revenue
- **Scanner Performance**: Usage stats, scans per session
- **Event Timeline**: Recent activity with timestamps
- **Category Breakdown**: Events grouped by type

---

## Environment Variables

### Frontend (.env)
```bash
# Sentry Error Monitoring
VITE_SENTRY_DSN=your-sentry-frontend-dsn-here

# App Version (for release tracking)
VITE_APP_VERSION=1.0.0

# Analytics Debug Mode (logs events in development)
VITE_ANALYTICS_DEBUG=true
```

### Backend (server/.env)
```bash
# Sentry Backend Monitoring
SENTRY_DSN=your-sentry-backend-dsn-here

# Environment
NODE_ENV=production
```

---

## How to Set Up Sentry

### 1. Create Sentry Account
1. Go to [sentry.io](https://sentry.io)
2. Sign up for free account
3. Create two projects:
   - **ninposnacks-frontend** (React)
   - **ninposnacks-backend** (Node.js)

### 2. Get DSN Keys
- Frontend: Project Settings → Client Keys (DSN)
- Backend: Project Settings → Client Keys (DSN)

### 3. Configure Environment Variables
Copy `.env.example` files and add your DSN keys:

**Frontend**:
```bash
cp .env.example .env
# Edit .env and add VITE_SENTRY_DSN
```

**Backend**:
```bash
cd server
cp .env.example .env
# Edit .env and add SENTRY_DSN
```

### 4. Test Error Monitoring
**Frontend test**:
```javascript
// Trigger test error in browser console
throw new Error('Test Sentry frontend integration');
```

**Backend test**:
```javascript
// Add to any route temporarily
app.get('/api/test-error', (req, res) => {
  throw new Error('Test Sentry backend integration');
});
```

Check Sentry dashboard to confirm errors appear.

---

## Analytics Service API

### Import
```typescript
import { analytics } from '../services/analyticsService';
```

### Available Methods

#### Track Custom Event
```typescript
analytics.trackEvent({
  category: 'user' | 'product' | 'order' | 'scanner' | 'returns' | 'payment' | 'navigation',
  action: 'event_name',
  label: 'optional_label',
  value: 123, // optional numeric value
  metadata: { key: 'value' } // optional custom data
});
```

#### Track Page View
```typescript
analytics.trackPageView('/customer', userId);
```

#### Track User Action
```typescript
analytics.trackUserAction('settings_updated', { 
  setting: 'address', 
  newValue: '123 Main St' 
});
```

#### Track Product Interaction
```typescript
// View
analytics.trackProductInteraction('view', productId, productName);

// Add to cart
analytics.trackProductInteraction('add_to_cart', productId, productName);

// Remove from cart
analytics.trackProductInteraction('remove_from_cart', productId, productName);
```

#### Track Order Events
```typescript
// Initiated
analytics.trackOrder('initiated', orderId, totalAmount);

// Completed
analytics.trackOrder('completed', orderId, totalAmount);

// Failed
analytics.trackOrder('failed', orderId, totalAmount);
```

#### Track Scanner
```typescript
// Scanner opened
analytics.trackScanner('opened');

// Scan performed
analytics.trackScanner('scanned', { upc: '012345678901' });

// Scan success/error
analytics.trackScanner('success', { upc: '012345678901' });
analytics.trackScanner('error', { upc: '012345678901', reason: 'invalid' });
```

#### Track Bottle Returns
```typescript
// Return started
analytics.trackReturn('started');

// Container scanned
analytics.trackReturn('container_scanned', containerCount, creditAmount);

// Return completed
analytics.trackReturn('completed', containerCount, creditAmount);

// Return cancelled
analytics.trackReturn('cancelled');
```

#### Track Payments
```typescript
// Payment initiated
analytics.trackPayment('stripe', 'initiated', amount);

// Payment success
analytics.trackPayment('credits', 'success', amount);

// Payment failed
analytics.trackPayment('gpay', 'failed', amount, 'Card declined');
```

#### Set User Context
```typescript
// On login
analytics.setUser(userId, email, tier);

// On logout
analytics.clearUser();
```

#### Track Errors
```typescript
try {
  // risky operation
} catch (error) {
  analytics.trackError(error, { context: 'checkout_flow' });
}
```

---

## Data Storage

### Local Storage (Development/Fallback)
Events are stored locally in `localStorage` for:
- Offline development testing
- Analytics dashboard display
- Fallback when Sentry unavailable

**Keys**:
- `ninpo_analytics_events` - Recent 100 events
- Maximum 100 events stored (oldest removed first)

### Sentry (Production)
All events sent to Sentry as:
- **Breadcrumbs** - User action timeline
- **Custom Events** - Business metrics
- **Transactions** - Performance tracking

---

## Analytics Dashboard Usage

### Access
1. Login as OWNER
2. Navigate to **Management Panel**
3. Click **Analytics** tab (first tab)

### Features

**Summary Cards**:
- Total events tracked
- Page views (+ unique pages)
- Orders completed (+ avg value)
- Containers returned (+ total returns)

**Product Metrics**:
- Product views
- Add to cart count
- Conversion rate (views → cart)

**Order Metrics**:
- Completed orders
- Failed orders
- Total revenue
- Average order value

**Scanner Usage**:
- Scanner opens
- Total scans performed
- Scans per session

**Event Categories**:
- Breakdown by category (user, product, order, etc.)
- Total count per category

**Recent Events Timeline**:
- Last 20 events
- Category tags
- Action names
- Timestamps
- Values/metadata

**Actions**:
- **Refresh** - Reload latest events
- **Clear Data** - Remove all local analytics (production data in Sentry unaffected)

---

## Performance Monitoring

### Frontend
- **Page Load Times**: Automatic via Sentry
- **Component Render Times**: React profiler integration
- **API Call Duration**: Fetch/axios interceptors
- **Scanner Performance**: Time to first scan, scan success rate

### Backend
- **API Response Times**: Automatic middleware
- **Database Query Times**: Mongoose slow query logging
- **Route Performance**: Transaction sampling

### Configuration
```typescript
// main.tsx
tracesSampleRate: 0.1 // 10% of transactions in production
```

**Recommendation**: Keep at 10% in production to avoid quota limits.

---

## Privacy & GDPR Compliance

### User Data Collection
- **User IDs**: Stored for session tracking
- **Email addresses**: Only if user is logged in
- **Tier level**: For segmentation
- **No PII**: Names, addresses, phone numbers NOT tracked

### Session Replay
```typescript
// main.tsx
replaysSessionSampleRate: 0.1  // 10% of normal sessions
replaysOnErrorSampleRate: 1.0   // 100% of sessions with errors
```

**Privacy Settings**:
```typescript
maskAllText: false  // Set to TRUE in production for privacy
blockAllMedia: false // Set to TRUE to block images/videos
```

### Data Retention
- Sentry: 90 days (free tier)
- Local storage: 100 most recent events
- Can be cleared via dashboard

---

## Troubleshooting

### Events Not Appearing in Sentry

**Check**:
1. DSN keys correct in `.env` files
2. Environment variables loaded: `console.log(import.meta.env.VITE_SENTRY_DSN)`
3. Sentry initialized: Check browser console for "Sentry initialized"
4. Network tab shows requests to `sentry.io`

**Debug Mode**:
```bash
# Frontend
VITE_ANALYTICS_DEBUG=true npm run dev
```

### Analytics Dashboard Empty

**Check**:
1. Perform some actions (add to cart, view products)
2. Click "Refresh" button
3. Open browser console, check for errors
4. Verify localStorage has `ninpo_analytics_events` key

### Performance Impact

**Sentry adds ~15KB gzipped**:
- Minimal bundle size increase
- Async loading doesn't block rendering
- Sample rates prevent overhead

**Optimize**:
```typescript
// Reduce sampling in production
tracesSampleRate: 0.05 // 5% instead of 10%
```

---

## Launch Checklist

- [ ] Sentry account created
- [ ] Frontend DSN added to `.env`
- [ ] Backend DSN added to `server/.env`
- [ ] Test error captured in Sentry dashboard
- [ ] Analytics dashboard shows events
- [ ] Privacy settings configured (`maskAllText: true`)
- [ ] Performance sampling set to 10% or less
- [ ] Team members added to Sentry project
- [ ] Slack/email alerts configured (optional)

---

## Metrics to Monitor

### Daily
- Active users (page views)
- Orders completed
- Order failure rate
- Average order value

### Weekly
- New user signups
- Conversion rate trends
- Popular products
- Scanner usage
- Bottle return volume

### Monthly
- Revenue trends
- User tier distribution
- Error rates
- Performance degradation

---

## Support & Resources

- **Sentry Docs**: https://docs.sentry.io
- **React Integration**: https://docs.sentry.io/platforms/javascript/guides/react/
- **Node.js Integration**: https://docs.sentry.io/platforms/node/
- **Performance Monitoring**: https://docs.sentry.io/product/performance/

---

## Future Enhancements

### Potential Additions
- [ ] Google Analytics integration
- [ ] Mixpanel for funnel analysis
- [ ] Amplitude for cohort analysis
- [ ] Custom dashboards with charts
- [ ] Email reports (weekly summaries)
- [ ] A/B testing framework
- [ ] Heatmap tracking
- [ ] Real-time dashboard (WebSocket updates)

---

**Last Updated**: January 2025  
**Version**: 1.0.0
