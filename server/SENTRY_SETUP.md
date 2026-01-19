# Sentry Backend Configuration - Quick Start

## ✅ Configuration Complete

Your backend Sentry SDK is now properly configured following official best practices.

---

## What Was Changed

### 1. Created `server/instrument.js`
- Initializes Sentry **before** any other code runs
- Includes HTTP, Express, and MongoDB instrumentation
- Performance monitoring with 10% sampling in production
- Filters out health check endpoint errors
- Your DSN is pre-configured

### 2. Updated `server/index.js`
- Imports `instrument.js` at the very top (before all other modules)
- Added `Sentry.setupExpressErrorHandler(app)` after all routes
- Enhanced error middleware to include Sentry error IDs
- Added `/api/debug-sentry` test endpoint (development only)

### 3. Updated `server/.env.example`
- Added your actual Sentry DSN for quick setup

---

## Testing Sentry Integration

### Option 1: Use Debug Endpoint (Easiest)

1. **Start your server:**
   ```bash
   cd server
   npm start
   ```

2. **Trigger test error:**
   ```bash
   curl http://localhost:5000/api/debug-sentry
   ```
   Or visit: http://localhost:5000/api/debug-sentry in your browser

3. **Check Sentry Dashboard:**
   - Go to https://sentry.io
   - Navigate to your `ninposnacks-backend` project
   - You should see "My first Sentry error!" in Issues

### Option 2: Trigger Real Error

Cause any error in your API (e.g., invalid database query, missing field) and check Sentry.

---

## Environment Variables

Make sure your `server/.env` file has:

```bash
SENTRY_DSN=https://710b85ed673cecc2a0d59df6c7ff85f3@o4510730569711616.ingest.us.sentry.io/4510737740660736
NODE_ENV=development  # or production
```

---

## Key Features Enabled

✅ **Automatic Error Capture** - All unhandled errors sent to Sentry  
✅ **Performance Monitoring** - API response times tracked  
✅ **Express Integration** - Request context included in errors  
✅ **MongoDB Integration** - Database query performance tracked  
✅ **Error IDs** - Each error gets unique ID for support tickets  
✅ **PII Tracking** - IP addresses included for debugging  
✅ **Environment Tags** - Errors tagged with dev/production  

---

## Error Response Format

When an error occurs, your API now returns:

```json
{
  "error": "Error message here",
  "sentryId": "abc123xyz", 
  "stack": "..." // Only in development
}
```

Users can provide the `sentryId` for support, and you can search for it in Sentry.

---

## Next Steps

1. ✅ Test the `/api/debug-sentry` endpoint
2. ✅ Verify error appears in Sentry dashboard
3. ✅ Remove or disable debug endpoint before production deployment
4. ✅ Set `NODE_ENV=production` in production environment
5. ✅ Configure Sentry alerts (Slack/Email notifications)

---

## Production Checklist

Before deploying:

- [ ] `NODE_ENV=production` set
- [ ] Remove or comment out `/api/debug-sentry` endpoint
- [ ] Verify SENTRY_DSN is in production environment variables
- [ ] Test error reporting in staging environment
- [ ] Set up Sentry alert rules
- [ ] Add team members to Sentry project

---

## Monitoring Performance

With the current setup, Sentry will track:
- API endpoint response times
- Database query performance
- External API call latency
- Error rates by endpoint
- Request volume trends

View these in: **Sentry Dashboard → Performance**

---

## Troubleshooting

**Errors not appearing in Sentry:**
1. Check `SENTRY_DSN` is set correctly
2. Verify `instrument.js` is imported first
3. Check network tab for requests to `sentry.io`
4. Review server console for Sentry initialization logs

**Too many events:**
- Increase `tracesSampleRate` to reduce performance monitoring
- Add more filters in `beforeSend` hook

---

**Configuration Date:** January 19, 2026  
**Sentry SDK Version:** @sentry/node v8.55.0
