# Receipt Workflow Implementation - Quick Reference

## Files Modified (Summary)

### Backend: server/index.js
**Change:** Updated route mounting documentation
**Impact:** Clarifies unified architecture (primary: `/api/receipts`, legacy: `/api/receipt-review`)
```javascript
// Primary receipt endpoints (role-neutral, unified)
app.use('/api/receipts', receiptsRouter);

// Legacy endpoints (backward compatibility)
app.use('/api/receipt-review', receiptReviewRouter);
```

### Backend: server/routes/receipts.js
**Changes:** Added GET endpoints and reject handler
**Impact:** Creates truly unified endpoint set with role-neutral architecture

**New/Modified Endpoints:**
1. `GET /` - List receipts by status (new)
2. `GET /:id` - Fetch single receipt (new)
3. `POST /:id/reject` - Reject receipt (new)
4. `POST /:captureId/approve` - Approve receipt (enhanced)

**Key Auth Pattern:**
```javascript
const canApproveReceipts = user => 
  user.role === 'OWNER' || 
  user.role === 'MANAGER' || 
  isOwnerUsername(user.username);
```

### Frontend: src/views/management/ManagementReceipts.tsx
**Changes:** Updated all API endpoints to use `/api/receipts/*`
**Impact:** Component now calls unified endpoint set

**API Calls Updated:**
1. `fetchReceipts()` - GET `/api/receipts?status=${statusFilter}`
2. `handleApprove()` - POST `/api/receipts/${id}/approve`
3. `handleReject()` - POST `/api/receipts/${id}/reject`

---

## Architecture Decision: Unified vs Split Endpoints

### Problem (Before)
- GET operations at `/api/receipt-review/receipts`
- Approve operation at `/api/receipts/{id}/approve`
- Reject missing from unified router
- Inconsistent endpoint paths cause confusion

### Solution (After)
- All operations at `/api/receipts/*` (primary)
- Identical role checks across all endpoints
- Legacy `/api/receipt-review` kept for backward compatibility
- Single source of truth for receipt operations

### Benefits
✅ Single permission model across all receipt operations  
✅ Easier to audit and enforce role rules  
✅ Consistent API contract for all clients  
✅ Migration path without breaking changes  
✅ Clear distinction between owner-only and team access  

---

## API Contract (Finalized)

### Unified Endpoints: `GET /api/receipts`

**GET** `/api/receipts`
- **Auth:** `authRequired` + `canApproveReceipts`
- **Query:** `status=NEEDS_REVIEW|PARSED|APPROVED|REJECTED` (optional)
- **Response:** `{ ok: true, jobs: [...] }`

**GET** `/api/receipts/:id`
- **Auth:** `authRequired` + `canApproveReceipts`
- **Response:** `{ ok: true, job: {...} }`

**POST** `/api/receipts/:id/approve`
- **Auth:** `authRequired` + `canApproveReceipts`
- **Body:** `{ storeCandidate, items, mode, selectedIndices, lockDurationDays }`
- **Response:** `{ ok: true, captureId, storeId, createdProducts, matchedProducts, inventoryUpdates }`
- **Side Effects:**
  - Creates Store (if new) with `createdFrom: 'receipt_upload'` and `isActive: false`
  - Creates Products for unmatched items
  - Upserts StoreInventory with observedPrice and priceHistory
  - Links UPCs via UpcItem updates
  - Records audit logs (type='store_created_from_receipt', 'receipt_approved')

**POST** `/api/receipts/:id/reject`
- **Auth:** `authRequired` + `canApproveReceipts`
- **Body:** `{ reason: string }`
- **Response:** `{ ok: true }`
- **Side Effects:**
  - Sets ReceiptParseJob.status = 'REJECTED'
  - Records audit log (type='receipt_rejected')

---

## Permission Model

| Role | Can Access Receipt Endpoints? |
|------|------------------------------|
| OWNER | ✅ Yes (username in OWNER_USERNAMES) |
| MANAGER | ✅ Yes (role === 'MANAGER') |
| DRIVER | ❌ No |
| CUSTOMER | ❌ No |

---

## Backward Compatibility

**Legacy Endpoint:** `GET /api/receipt-review/receipts` still works
- Points to same receiptReviewRouter
- Has identical permission checks
- Can be retired after migration period

**Migration Path:**
1. ✅ Deploy unified endpoints (Phase 1 - complete)
2. ⏳ Monitor legacy endpoint usage (Phase 2)
3. ⏳ Deprecate and remove old endpoints (Phase 3)

---

## Testing Status

### Completed Tests
✅ Code validation (zero syntax errors)  
✅ Backend route registration verified  
✅ Frontend API calls updated  
✅ Permission checks consistent  
✅ Audit logging integrated  

### Pending Tests
⏳ Integration testing (manual)
  - Receipt list fetch
  - Single receipt detail fetch
  - Approval with store creation
  - Rejection workflow
  - Permission denial for non-owners
  - Audit trail creation
  - Concurrent approval handling

**See:** RECEIPT_WORKFLOW_TESTING_GUIDE.md for full test scenarios

---

## Deployment Checklist

- [ ] Code review approved
- [ ] All tests from RECEIPT_WORKFLOW_TESTING_GUIDE.md passed
- [ ] Audit logs verified in staging
- [ ] Backward compatibility tested with legacy endpoints
- [ ] Permission checks validated for all roles
- [ ] Database migration (if needed) completed
- [ ] Monitoring/alerts configured for receipt endpoints
- [ ] Stakeholder approval obtained
- [ ] Deploy to production
- [ ] Monitor logs for errors (first 24 hours)
- [ ] Schedule legacy endpoint deprecation (after 90 days)

---

## Key Implementation Details

### Atomic Approval Process
```javascript
// Uses MongoDB transactions to ensure consistency
const session = await mongoose.startSession();
session.startTransaction();

// 1. Resolve or create store
// 2. Process each item: create product or link existing
// 3. Upsert StoreInventory with prices
// 4. Update ReceiptCapture status
// 5. Update ReceiptParseJob status

session.commitTransaction();
```

### Audit Log Entries
All mutations create audit logs:
```javascript
await recordAuditLog({
  type: 'receipt_approved|receipt_rejected',
  actorId: req.user.username,
  details: `jobId=${id} storeId=${storeId} products=${count}`
});
```

### Price History Tracking
Each StoreInventory maintains priceHistory array:
```javascript
{
  price: unitPrice,
  observedAt: new Date(),
  storeId: store._id,
  captureId: capture._id,
  matchMethod: 'manual_confirm|fuzzy|alias',
  matchConfidence: 0.85,
  confirmedBy: username,
  workflowType: 'new_product|update_price'
}
```

---

## Next Phases (After Phase 1 Complete)

### Phase 2: Driver/Manager Read-Only Access
**Scope:** Allow DRIVER/MANAGER to view receipt queue (read-only)
**Changes Needed:**
- Modify `canApproveReceipts` to allow read access for MANAGER
- Create separate `canViewReceipts` for read-only (includes DRIVER with restrictions)
- Add store/region filtering for manager scope

**Estimated Effort:** 4-6 hours

### Phase 3: Real-Time Sync Optimization
**Scope:** Use WebSocket/Socket.io for live receipt status updates
**Changes Needed:**
- Emit 'receipt:updated' event when status changes
- Connect ManagementReceipts component to live updates
- Add optimistic UI updates for instant feedback

**Estimated Effort:** 6-8 hours

---

## Support & Troubleshooting

### Enable Debug Logging
```bash
# Backend
DEBUG=ninpo:* npm start

# Frontend
localStorage.setItem('debug', 'ninpo:*');
```

### Common Issues

**Issue:** Receipt approval fails with "Store candidate is required"
- **Fix:** Ensure store candidate has at least a name field

**Issue:** StoreInventory not created
- **Fix:** Verify Product was successfully created in previous step

**Issue:** Audit logs missing
- **Fix:** Check MongoDB write permissions and AuditLog model

**Issue:** Permission denied (403) for owner account
- **Fix:** Verify username is in OWNER_USERNAMES env var with owner_ prefix

---

## Quick Commands

### Test Owner Account
```bash
# Create owner
npm run create-owner

# Login response
POST /api/auth/login
{
  "username": "owner_test",
  "password": "your-password"
}
```

### Fetch Receipt List
```bash
curl -H "Cookie: session=<jwt>" \
  http://localhost:5000/api/receipts?status=NEEDS_REVIEW
```

### Test Permission Denial
```bash
curl -H "Cookie: session=<customer-jwt>" \
  http://localhost:5000/api/receipts
# Returns: 403 { error: "Not authorized" }
```

---

**Status:** Phase 1 Implementation Complete ✅  
**Last Updated:** January 2026  
**Next Review:** After Phase 1 testing completion
