# NinpoSnacks Deployment Guide

**Last Updated:** January 16, 2026  
**Status:** READY FOR PRODUCTION  
**Audience:** DevOps, Release Manager, Operations  

---

## Pre-Deployment Checklist

### Security
- [ ] All secrets rotated (Stripe, Cloudinary, JWT, MongoDB)
- [ ] Debug endpoints removed from codebase
- [ ] Sentry PII scrubbing enabled
- [ ] Rate limiting configured
- [ ] CORS whitelist restricted to production domain
- [ ] SSL certificates valid (90+ days remaining)

### Dependencies
- [ ] Node.js 18+ installed on production
- [ ] MongoDB 5.0+ running and accessible
- [ ] Redis running (for session store, BullMQ queues)
- [ ] Stripe API keys validated
- [ ] Cloudinary account configured
- [ ] Sentry project created

### Data
- [ ] Database backup performed
- [ ] Migration scripts tested on staging
- [ ] Initial product data seeded (if needed)
- [ ] Owner account created via `npm run create-owner`

### Performance
- [ ] Load testing completed (>1000 req/s baseline)
- [ ] Database indexes optimized
- [ ] Cache warming strategy defined
- [ ] CDN configured for static assets

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Production                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  Stripe  │    │Cloudinary│    │  Sentry  │      │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘      │
│       │                │               │            │
│  ┌────▼─────────────────▼───────────────▼─────┐    │
│  │         Backend (Node.js + Express)        │    │
│  │  Port 5000 | Environment: production       │    │
│  └────┬──────────────────────────────┬────────┘    │
│       │                              │             │
│  ┌────▼──────┐    ┌────────────┐   │             │
│  │ MongoDB   │    │   Redis    │   │             │
│  │(persistent)    │(session)   │   │             │
│  └───────────┘    └────────────┘   │             │
│                                     │             │
│  ┌──────────────────────────────────▼─────┐      │
│  │    Frontend (Vite + React)              │      │
│  │    CDN-hosted | CORS configured         │      │
│  └─────────────────────────────────────────┘      │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## Environment Variables

### Required (Production)
```bash
# Application
NODE_ENV=production
VITE_BACKEND_URL=https://api.ninposnacks.com

# Database
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/ninposnacks?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-with-openssl-rand-hex-64>
OWNER_USERNAMES=owner_user1,owner_user2

# Payment
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Media
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx

# Redis (if using BullMQ for receipts)
REDIS_URL=redis://default:password@redis.production.com:6379

# Geographic (for distance calculations)
HUB_LAT=42.3314
HUB_LNG=-83.0458
```

### Optional
```bash
# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 min
RATE_LIMIT_MAX_REQUESTS=100

# Cloudinary (alternative to env key)
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name

# Feature Flags
ENABLE_RECEIPT_QUEUE=true
ENABLE_RETURNS_VERIFICATION=true
```

---

## Step-by-Step Deployment

### Phase 1: Pre-Deployment (1 day before)

1. **Backup Everything**
   ```bash
   # Database backup
   mongodump --uri "mongodb+srv://user:pass@cluster.ninposnacks.com/ninposnacks" \
     --out /backups/ninposnacks-$(date +%Y%m%d-%H%M%S)
   
   # Verify backup
   ls -lh /backups/ninposnacks-*/
   ```

2. **Staging Final Test**
   ```bash
   # Deploy to staging environment first
   git push origin main
   # Trigger CI/CD for staging
   # Run regression tests
   # Verify all integrations
   ```

3. **Notify Team**
   - Send deployment window notification
   - Confirm on-call support available

### Phase 2: Deployment (Maintenance Window: 2-4 hours)

1. **Pre-Deployment Validation**
   ```bash
   # Pull latest code
   git pull origin main
   
   # Verify environment variables
   env | grep -E 'STRIPE|CLOUDINARY|SENTRY|MONGO|JWT'
   
   # Check database connectivity
   npx mongoose-connect --uri "${MONGO_URI}"
   ```

2. **Build & Install**
   ```bash
   # Clean install
   rm -rf node_modules
   npm ci  # Use ci, not install (production-safe)
   
   # Build frontend
   npm run build
   
   # Verify build artifacts
   ls -lh dist/
   ```

3. **Database Migrations (if any)**
   ```bash
   # Run migrations
   npm run migrate:up
   
   # Verify migration status
   db.migrations.find({status: "pending"})
   ```

4. **Start Services**
   ```bash
   # Option A: Using PM2 (recommended)
   pm2 start server/index.js --name "ninpo-api" \
     --env production --max-memory-restart 1G
   
   # Option B: Using Docker
   docker pull ninposnacks:latest
   docker run -d \
     --name ninpo-api \
     --env-file .env.production \
     -p 5000:5000 \
     ninposnacks:latest
   
   # Option C: Using systemd
   systemctl restart ninpo-api
   ```

5. **Post-Deployment Verification**
   ```bash
   # Health check
   curl -s https://api.ninposnacks.com/api/health | jq .
   
   # Verify endpoints
   curl -s https://api.ninposnacks.com/api/products?limit=1
   
   # Check logs
   pm2 logs ninpo-api | head -50
   ```

### Phase 3: Smoke Testing (30 minutes)

1. **API Functionality**
   ```bash
   # Products endpoint
   curl -X GET https://api.ninposnacks.com/api/products
   
   # Auth (create test user if needed)
   curl -X POST https://api.ninposnacks.com/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"test_user","password":"TestPass123"}'
   
   # Orders (place test order via dashboard)
   # Verify Stripe webhook received
   ```

2. **Third-Party Integrations**
   ```bash
   # Sentry: Trigger test error
   # Check Sentry dashboard for event arrival (30s delay)
   
   # Stripe: Process test payment
   # Confirm charge appears in Stripe dashboard
   
   # Cloudinary: Upload test image
   # Verify image accessible via CDN
   ```

3. **Database Integrity**
   ```bash
   # Check indexes
   db.getCollectionNames().forEach(c => print(c + ": " + db[c].getIndexes().length))
   
   # Verify replication
   rs.status()
   ```

### Phase 4: Rollback (if needed)

```bash
# Option 1: Revert to previous code
git revert <deployment-commit>
npm ci && npm run build
pm2 restart ninpo-api

# Option 2: Restore database from backup
mongorestore --uri "mongodb+srv://..." /backups/ninposnacks-<timestamp>/

# Option 3: Emergency shutdown
pm2 stop ninpo-api
# Notify stakeholders
# Investigate issue
# Deploy fix
```

---

## Post-Deployment Monitoring (First 24 hours)

### Metrics to Watch
- **Response times:** p50 <100ms, p99 <500ms
- **Error rate:** <0.1%
- **Database CPU:** <50%
- **Memory usage:** <70% of allocated

### Daily Checklist
- [ ] Monitor error rate in Sentry
- [ ] Check Stripe transaction volume
- [ ] Verify database backup completed
- [ ] Review user feedback
- [ ] Test critical user flows

### Sample Monitoring Query
```bash
# Tail logs (last 100 lines)
pm2 logs ninpo-api --lines 100

# Check performance
curl -s -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  https://sentry.io/api/0/organizations/ninposnacks/stats/ | jq .

# Database stats
db.stats()
```

---

## Rollback Procedures

### Quick Rollback (< 5 minutes)
```bash
# If deployment hasn't propagated to all instances
git revert <commit-hash>
git push origin main
# Let CI/CD redeploy

# Immediate restart
pm2 restart ninpo-api
```

### Full Rollback (< 30 minutes)
```bash
# Revert code + database to backup
git checkout <previous-tag>

# Restore database
mongorestore --uri "${MONGO_URI}" /backups/ninposnacks-20260116-143022/

# Restart services
systemctl restart ninpo-api

# Verify
curl -s https://api.ninposnacks.com/api/health
```

### Data Rollback Only
```bash
# If only data is corrupted, keep code
mongorestore --nsInclude "ninposnacks.*" \
  /backups/ninposnacks-<timestamp>/

# Restart any dependent services
pm2 restart all
```

---

## Deployment Runbook for Operations Team

**Deployment Window:** [Set date/time]  
**Owner:** [Release Manager]  
**Backout Plan:** Rollback to previous commit + restore DB from backup  

### Timeline
| Time | Action | Owner | Est. Duration |
|------|--------|-------|---|
| -1h | Final checks, notify team | Ops | 15 min |
| 0h | Take database backup | DBA | 10 min |
| 0h+10m | Deploy to production | DevOps | 10 min |
| 0h+20m | Run smoke tests | QA | 15 min |
| 0h+35m | Monitor error rates | DevOps | ongoing |
| +24h | Debrief & document learnings | Team | 30 min |

### Escalation Contacts
- **Release Manager:** [Name] ([phone/slack])
- **DevOps Lead:** [Name] ([phone/slack])
- **DBA:** [Name] ([phone/slack])
- **On-Call Support:** [PagerDuty link]

---

## Troubleshooting

### Service Won't Start
```bash
# Check logs
pm2 logs ninpo-api

# Verify environment variables
env | grep NODE_ENV

# Test database connection
node -e "require('mongoose').connect(process.env.MONGO_URI, { useNewUrlParser: true })"

# Check port availability
lsof -i :5000
```

### High Error Rate Post-Deployment
1. Check Sentry dashboard for error patterns
2. Verify all secrets are set correctly
3. Check database connectivity
4. Review recent code changes
5. If unclear → **ROLLBACK IMMEDIATELY**

### Stripe/Cloudinary Integration Failing
```bash
# Test Stripe
curl -X GET https://api.stripe.com/v1/account \
  -H "Authorization: Bearer ${STRIPE_API_KEY}"

# Test Cloudinary
curl -s -u "api_key:api_secret" \
  https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image
```

---

## Success Criteria

✅ Deployment is **successful** when:
1. All API endpoints responding with status 200
2. Error rate in Sentry < 0.1% for 1 hour
3. Stripe webhooks being received and processed
4. Database replication healthy
5. Frontend serving over CDN with correct cache headers
6. No critical issues reported by users

---

## References

- [Production Readiness Checklist](./PRODUCTION_READINESS.md)
- [Production Hardening Guide](./PRODUCTION_HARDENING_GUIDE.md)
- [Incident Response Playbook](./INCIDENT_RESPONSE.md) *(create)*
- [Sentry Documentation](https://docs.sentry.io/)
- [Stripe API Docs](https://stripe.com/docs/api)

---

**Deployment Approval Required From:**
- [ ] Engineering Lead
- [ ] Product Manager
- [ ] Operations Manager

**Signature:** ______________________ **Date:** __________
