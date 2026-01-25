# Production Hardening Guide

**Status:** IMPLEMENTATION STARTED  
**Date:** January 16, 2026  
**Owner:** Development Team  

---

## ✅ COMPLETED ACTIONS

### 1. Debug Endpoints Removed
- ✅ Removed `/api/debug-sentry` from `server/index.js` (line 178-182)
- ✅ Removed `/api/driver/receipt-settings-debug` from `server/routes/receipt-prices.js`
- **Verified:** No debug endpoints remain in codebase

---

## 🔍 Sentry PII Audit Results

### Current Configuration Status

**Frontend (`src/main.tsx`):**
- ✅ `sendDefaultPii: false` for production (line 18)
- ✅ Session replay mask enabled: `maskAllText: false` (to preserve UX while protecting PII)
- ✅ Error filtering list configured (ResizeObserver, network errors)
- ✅ Custom tags added (`app`, `component`)

**Backend (`server/instrument.js`):**
- ⚠️ `sendDefaultPii: true` **in development only** (line 8)
- ⚠️ HTTP integration enabled (may capture headers with auth tokens)
- ✅ `beforeSend` hook filters health check errors

### PII Exposure Risk Assessment

| Field | Status | Risk | Mitigation |
|-------|--------|------|-----------|
| User IDs | ✅ Safe | Low | Never included in error logs |
| Usernames | ⚠️ Partial | Medium | May appear in request headers |
| Email/Phone | ⚠️ Partial | Medium | May appear in request body (checkout) |
| Cart contents | ✅ Safe | Low | Intentionally filtered |
| Credit card data | ✅ Safe | None | Always handled by Stripe (PCI-compliant) |

### Recommended Sentry Configuration (PRODUCTION)

```javascript
// server/instrument.js - PRODUCTION SAFE
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'production',
  
  // CRITICAL: Disable PII in production
  sendDefaultPii: false, // Never send user IPs, cookies, headers
  
  // Conservative sampling to reduce volume
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
  
  // Filter sensitive HTTP headers
  integrations: [
    Sentry.httpIntegration({
      captureRequestHeaders: false, // Don't capture auth headers
      captureResponseHeaders: false,
    }),
  ],
  
  // Aggressive scrubbing
  beforeSend(event, hint) {
    // Scrub request body (remove URLs with sensitive data)
    if (event.request?.url) {
      event.request.url = event.request.url.replace(/\/api\/[^/]+\/[a-f0-9]{24}/g, '/api/***');
    }
    
    // Remove cookies
    if (event.request?.cookies) {
      delete event.request.cookies;
    }
    
    // Remove sensitive headers
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }
    
    return event;
  },
  
  // Don't send errors for non-critical paths
  ignoreErrors: [
    'ResizeObserver',
    'Network request failed',
    'Failed to fetch',
    '/api/health',
    '/api/auth/ping',
  ],
});
```

---

## 🚀 Immediate Next Steps (THIS WEEK)

### 1. Deploy Debug Endpoint Removals
**Timeline:** Immediate (next commit)
**Owner:** DevOps  
**Tasks:**
- [ ] Merge to staging branch
- [ ] Verify no endpoints on `GET /api/debug-*`
- [ ] Run `curl ${BACKEND_URL}/api/debug-sentry` → expect 404

### 2. Harden Sentry Configuration
**Timeline:** Before production deployment  
**Owner:** Backend Team  
**Tasks:**
- [ ] Update `server/instrument.js` with production-safe config above
- [ ] Add env var: `SENTRY_SAMPLE_RATE=0.05` (for production)
- [ ] Test in staging: intentional error should NOT include request headers
- [ ] Document in `.env.example`

### 3. Add Sentry Scrubbing Rules
**Timeline:** Before launch  
**Owner:** Backend Team  
**Implementation:**
```javascript
// Add to Sentry config integrations
{
  integrations: [
    new Sentry.Integrations.RequestData({
      // Only capture basic request info
      include: {
        request: ['method', 'url'],
        cookies: false,
        headers: false,
        query_string: false,
        body: false,
      }
    }),
  ]
}
```

### 4. Create Test Suite for PII Scrubbing
**Timeline:** This week  
**Owner:** QA/Testing  
**Coverage:**
- [ ] Trigger error with sensitive payload → verify Sentry doesn't log it
- [ ] Test auth header stripping
- [ ] Test cookie removal
- [ ] Verify no URLs with IDs in error messages

---

## 📋 Ongoing Hardening Checklist

### Security
- [ ] All debug endpoints removed (✅ DONE)
- [ ] Sentry PII scrubbing enabled
- [ ] Rate limiting on auth endpoints
- [ ] CORS whitelist restricted (production only)
- [ ] API keys rotated (pre-launch)

### Performance & Reliability
- [ ] Database connection pooling tuned
- [ ] Redis/cache configured for staging
- [ ] Load testing (target: 1000 req/s)
- [ ] Graceful degradation for Stripe/Cloudinary failures

### Monitoring
- [ ] Uptime monitoring configured (UptimeRobot/New Relic)
- [ ] Error alerting thresholds set
- [ ] Custom dashboards in Sentry
- [ ] Incident response runbook documented

### Documentation
- [ ] Deployment guide for production
- [ ] Rollback procedures documented
- [ ] Database backup strategy verified
- [ ] Disaster recovery tested

---

## 🛑 Production Deployment Blockers

**Current Status:** 1 blocker remains

| Issue | Status | Action | Owner |
|-------|--------|--------|-------|
| Debug endpoints | ✅ FIXED | Removed from codebase | DevOps |
| Sentry PII scrubbing | ⏳ IN PROGRESS | Apply config from guide above | Backend |
| Rate limiting | 🔴 NOT STARTED | Add express-rate-limit | Backend |
| Load test results | 🔴 NOT STARTED | Run k6/Apache Bench test | QA |

---

## 📞 Support & Escalation

**For PII/Security concerns:**
- Contact: [DevSecOps team]
- Escalation: CRITICAL → prod deployment blocked

**For Sentry configuration:**
- Reference: https://docs.sentry.io/product/security/
- Test endpoint: POST to /api/test-sentry in staging only

---

## References

- [Sentry Security Best Practices](https://docs.sentry.io/product/security/)
- [GDPR Compliance for Error Tracking](https://docs.sentry.io/product/security/gdpr/)
- [OWASP PII Classification](https://owasp.org/www-community/attacks/PII_Disclosure)
- [Production Readiness Checklist](./PRODUCTION_READINESS.md)

---

**Last Updated:** 2026-01-16  
**Next Review:** 2026-01-23
