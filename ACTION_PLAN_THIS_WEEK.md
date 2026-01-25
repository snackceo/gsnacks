# 🎬 THIS WEEK: Launch Readiness Action Plan

**Week of:** January 16-22, 2026  
**Deadline:** Friday, January 22 (before staging → production prep)  
**Status:** 🟡 4 tasks pending | ✅ 4 tasks complete  

---

## Daily Standup Agenda

### What's Done ✅
1. Debug endpoints removed from codebase
2. Production Hardening Guide created
3. Deployment Guide created
4. Launch Readiness Summary documented

### What's In Progress ⏳
1. **Sentry hardening config** (Backend)
2. **Load testing** (QA)
3. **PII scrubbing tests** (QA/Backend)
4. **Production monitoring setup** (DevOps)

### What's Blocked 🔴
- None currently; all items have clear owners

---

## Monday 1/16 (TODAY)

### 📋 Backend Team (1-2 hours)
- [ ] Read [PRODUCTION_HARDENING_GUIDE.md](./PRODUCTION_HARDENING_GUIDE.md) sections 1-2
- [ ] Copy Sentry production-safe config from guide
- [ ] Update `server/instrument.js` with new config
- [ ] Add `SENTRY_SAMPLE_RATE=0.05` to `.env.example`
- [ ] Create branch: `feature/sentry-hardening`
- [ ] Commit with message: "chore: harden Sentry config for production"

**Time Estimate:** 1.5 hours  
**Owner:** @backend-lead  
**Review Needed:** Yes (security team)

### 📋 DevOps Team (30 min)
- [ ] Read [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) sections 1-2
- [ ] Verify all environment variables documented in `.env.example`
- [ ] Create `.env.production.template` (shared with team, secrets TBD)
- [ ] Test database backup script in staging
- [ ] Document any deviations from guide

**Time Estimate:** 30 min  
**Owner:** @devops-lead  
**Review Needed:** No

### 📋 QA Team (2 hours)
- [ ] Read [PRODUCTION_HARDENING_GUIDE.md](./PRODUCTION_HARDENING_GUIDE.md) section 3
- [ ] Outline PII scrubbing test cases:
  - Trigger error with credit card number → verify Sentry doesn't capture
  - Trigger error with auth token → verify header removed
  - Trigger error with user email → verify not in logs
- [ ] Create test plan doc: `SENTRY_PII_TESTS.md`
- [ ] Schedule load testing for Wednesday (k6 or Apache Bench)

**Time Estimate:** 2 hours  
**Owner:** @qa-lead  
**Review Needed:** Yes (Backend team)

### 📋 Product/PM (15 min)
- [ ] Review [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) pre-deployment section
- [ ] Confirm deployment window (recommend Tuesday 2am UTC for minimal impact)
- [ ] Draft customer communication (optional, based on SLA)
- [ ] Share timeline with stakeholders

**Time Estimate:** 15 min  
**Owner:** @product-manager

---

## Tuesday 1/17

### 📋 Backend Team (2 hours)
- [ ] **Deploy Sentry hardening to staging**
  ```bash
  git checkout feature/sentry-hardening
  git push origin feature/sentry-hardening
  # Create PR, get review, merge to staging
  ```
- [ ] **Test in staging:**
  ```bash
  # Trigger intentional error in staging
  curl https://staging.ninposnacks.com/api/test-sentry
  # Check Sentry dashboard - verify no auth headers or cookies captured
  # Verify p99 response time < 500ms
  ```
- [ ] Update PR with results: "✅ Sentry hardening deployed and tested in staging"

**Time Estimate:** 2 hours  
**Owner:** @backend-lead

### 📋 DevOps Team (1 hour)
- [ ] **Test deployment procedures in staging:**
  ```bash
  # Run through DEPLOYMENT_GUIDE.md Phase 2 (dry run)
  # Don't actually deploy, just verify commands work
  # Test database backup/restore
  # Time the process
  ```
- [ ] Document any issues found
- [ ] Create checklist: `DEPLOYMENT_CHECKLIST_20260117.md`

**Time Estimate:** 1 hour  
**Owner:** @devops-lead

### 📋 QA Team (4 hours)
- [ ] **Start PII scrubbing tests (detailed design)**
  ```bash
  # Test 1: Credit card number in error
  curl -X POST https://staging.ninposnacks.com/api/test-error \
    -d '{"cc":"4532111111111111"}' \
    # Check Sentry - should NOT have cc number
  
  # Test 2: Auth header
  curl -H "Authorization: Bearer secret_token_123" \
    https://staging.ninposnacks.com/api/protected \
    # Check Sentry - should NOT have auth header
  
  # Test 3: Email in URL
  curl https://staging.ninposnacks.com/api/users?email=user@example.com \
    # Check Sentry - should NOT have email
  ```
- [ ] Document results in `SENTRY_PII_TESTS.md`
- [ ] File any issues as bugs with evidence

**Time Estimate:** 4 hours  
**Owner:** @qa-lead

---

## Wednesday 1/18

### 📋 QA Team (6 hours)
- [ ] **Load Testing**
  ```bash
  # Install k6: https://k6.io/docs/getting-started/installation/
  
  # Create test script: tests/load-test.js
  import http from 'k6/http';
  export let options = {
    stages: [
      { duration: '30s', target: 100 },   // Ramp up
      { duration: '1m', target: 1000 },   // Stay at 1000 req/s
      { duration: '30s', target: 0 },     // Ramp down
    ],
  };
  export default () => {
    http.get('https://staging.ninposnacks.com/api/products');
  };
  
  # Run test
  k6 run tests/load-test.js
  
  # Check results:
  # - Response time p99 < 500ms
  # - Error rate < 0.5%
  # - Throughput > 1000 req/s
  ```
- [ ] Document results: `LOAD_TEST_RESULTS.md`
- [ ] If issues found, file bugs with owner assignments

**Time Estimate:** 6 hours  
**Owner:** @qa-lead

### 📋 Backend Team (2 hours)
- [ ] Review PII test results
- [ ] Fix any issues found
- [ ] Test fix in staging
- [ ] Update PR with status

**Time Estimate:** 2 hours  
**Owner:** @backend-lead

---

## Thursday 1/19

### 📋 All Teams (1 hour)
- [ ] **Daily Standup: Launch Readiness Review**
  - Sentry hardening: Status & confidence level
  - Load tests: Any issues? Acceptable results?
  - Deployment readiness: All checks green?
  - Blockers: Any surprises?

### 📋 DevOps Team (2 hours)
- [ ] Set up production monitoring:
  - [ ] Uptime monitoring (UptimeRobot / Pingdom)
  - [ ] Error rate alerts (Sentry > 0.5% threshold)
  - [ ] Response time alerts (p99 > 500ms)
  - [ ] Database CPU alerts (> 70%)
- [ ] Configure incident notification channels
- [ ] Test alert system (trigger false positive)
- [ ] Document dashboard URLs & alert rules

**Time Estimate:** 2 hours  
**Owner:** @devops-lead

### 📋 Product/PM (1 hour)
- [ ] Finalize deployment window (recommend Tuesday 2am UTC)
- [ ] Send team notification with schedule
- [ ] Create incident response contact list
- [ ] Confirm on-call coverage

**Time Estimate:** 1 hour  
**Owner:** @product-manager

### 📋 Backend Team (1 hour)
- [ ] Final code review of Sentry hardening PR
- [ ] Merge to main branch
- [ ] Tag release: `v1.0.0-production`
- [ ] Create release notes

**Time Estimate:** 1 hour  
**Owner:** @backend-lead

---

## Friday 1/20 (FINAL PUSH)

### 📋 All Teams (2 hours)
- [ ] **Launch Readiness Sign-Off Meeting**
  - Review all documentation
  - Confirm procedures & timelines
  - Identify any remaining gaps
  - Final questions & concerns

### 📋 DevOps Team (2 hours)
- [ ] Final pre-production checks:
  - [ ] All secrets generated & stored securely
  - [ ] Database backup process tested
  - [ ] Rollback procedure verified
  - [ ] On-call team trained
  - [ ] Escalation contacts confirmed
- [ ] Create `DEPLOYMENT_CHECKLIST_20260124.md` (for actual deployment day)
- [ ] Brief on-call team on procedures

**Time Estimate:** 2 hours  
**Owner:** @devops-lead

### 📋 Backend Team (1 hour)
- [ ] Final code review pass
- [ ] No breaking changes since Wednesday
- [ ] Documentation updated

**Time Estimate:** 1 hour  
**Owner:** @backend-lead

### 📋 QA Team (1 hour)
- [ ] Smoke test checklist finalized
- [ ] Test data prepared for post-deployment verification
- [ ] Ready for Monday production deployment

**Time Estimate:** 1 hour  
**Owner:** @qa-lead

### 📋 Product/PM (30 min)
- [ ] Final communication to stakeholders
- [ ] Confirm Monday deployment is a go
- [ ] Prepare post-deployment success message

**Time Estimate:** 30 min  
**Owner:** @product-manager

---

## Success Criteria for This Week

✅ **Backend**
- [ ] Sentry hardening merged to main
- [ ] PII scrubbing tests passing
- [ ] No new bugs introduced

✅ **DevOps**
- [ ] Production monitoring configured
- [ ] Rollback procedure tested
- [ ] On-call team trained

✅ **QA**
- [ ] Load tests passed (>1000 req/s, <0.5% error rate)
- [ ] Smoke tests documented & ready
- [ ] PII tests passing

✅ **Product**
- [ ] Deployment window confirmed
- [ ] Team notified
- [ ] Stakeholders aligned

---

## Time Allocation Summary

| Role | Total Hours | Per Day |
|------|------------|---------|
| Backend | 5 hours | 1.25 hrs/day |
| DevOps | 3 hours | 0.75 hrs/day |
| QA | 13 hours | 3.25 hrs/day |
| Product | 1.5 hours | 0.3 hrs/day |
| **TOTAL** | **22.5 hours** | **5.5 hrs/day** |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|-----------|
| Sentry hardening breaks logging | LOW | HIGH | Daily testing in staging |
| Load test shows >0.5% errors | MEDIUM | HIGH | Investigate & retest Wed |
| Deployment window conflict | LOW | MEDIUM | Confirm Mon with PM |
| On-call unavailable Tuesday | LOW | CRITICAL | Confirm coverage by Fri |

---

## Questions? 🤔

### For Backend
- "Do we need to update Sentry version?" → No, hardening via config only
- "Will this affect error tracking?" → No, improves it by reducing noise

### For DevOps
- "Should we test rollback in production?" → NO, only staging
- "What's the backup strategy?" → See DEPLOYMENT_GUIDE.md Phase 1

### For QA
- "How long will load testing take?" → ~2 hours (k6 run + analysis)
- "Do we test against production data?" → No, staging data only

### For Product
- "When's the final go/no-go decision?" → Friday 5pm UTC
- "Who's the deployment owner?" → DevOps lead, coordinated by PM

---

## Slack/Standup Template

```
✅ DONE:
- Debug endpoints removed
- Hardening guide created
- Deployment guide created

⏳ TODAY:
- Sentry hardening applied (Backend)
- Load tests designed (QA)
- Deployment procedures tested (DevOps)

🚨 BLOCKERS:
- None

🎯 PRIORITY:
- Get Sentry hardening tested by Wed
- Complete load tests by Wed EOD
- Confirm Monday deployment by Friday
```

---

## Checklist for Monday 1/16 End of Day

- [ ] Backend: Sentry config changes started
- [ ] DevOps: Environment template created
- [ ] QA: Test plan documented
- [ ] Product: Deployment window communicated
- [ ] All: Daily standup completed

**Target:** 80% of Monday work done by EOD

---

## Next Milestone

**Tuesday 1/24 DEPLOYMENT** (if all checks pass)

After this week's work, we'll be ready for production deployment. All items are achievable with focus and clear ownership.

**Let's ship this! 🚀**

---

**Document Owner:** Release Manager  
**Last Updated:** 2026-01-16  
**Next Update:** Daily during week 1/16-1/22
