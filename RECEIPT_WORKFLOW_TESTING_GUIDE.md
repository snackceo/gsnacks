# Receipt Workflow Alignment - Testing Guide

**Date:** January 2026  
**Purpose:** Validate end-to-end receipt capture, parsing, and approval workflow

## Quick Start

### Prerequisites
- Backend running on `http://localhost:5000`
- Frontend running on `http://localhost:5173`
- Database seeded with test owner account
- Postman or curl installed (for API testing)

### Owner Credentials (Test)
```
username: owner_test
password: [your-set-password]
role: OWNER
```

## Test Scenarios

### Scenario 1: Fetch Receipt List (Role-Neutral GET)

**Test:** Owner can fetch receipt list using new unified endpoint

**Steps:**
1. Log in as Owner
2. Navigate to Management → Pricing Intelligence (or Receipt Reviews)
3. Verify receipts load with status filter

**Expected Result:**
```
✅ GET /api/receipts?status=NEEDS_REVIEW returns 200 OK
✅ Response contains { ok: true, jobs: [...] }
✅ Each job has _id, status, createdAt, items, storeCandidate
```

**API Call (curl):**
```bash
curl -X GET 'http://localhost:5000/api/receipts?status=NEEDS_REVIEW' \
  -H 'Content-Type: application/json' \
  -b "session=<your-jwt-token>"
```

---

### Scenario 2: Fetch Single Receipt (Role-Neutral GET)

**Test:** Owner can fetch single receipt details

**Steps:**
1. Click on a receipt in the list
2. Verify receipt details load (store candidate, line items)

**Expected Result:**
```
✅ GET /api/receipts/{id} returns 200 OK
✅ Response contains { ok: true, job: { _id, storeCandidate, items, ... } }
✅ Store candidate shows name, address, phone, confidence
✅ Line items show rawLine, nameCandidate, quantity, unitPrice, lineTotal
```

**API Call (curl):**
```bash
curl -X GET 'http://localhost:5000/api/receipts/64a1f2b3c4d5e6f7g8h9i0j1' \
  -H 'Content-Type: application/json' \
  -b "session=<your-jwt-token>"
```

---

### Scenario 3: Approve Receipt with Store Creation

**Test:** Owner can approve receipt and create new store from candidate

**Setup:**
- Have a parsed receipt with NEEDS_REVIEW status
- Store candidate should NOT exist in database

**Steps:**
1. Select receipt from list
2. Review store candidate (name, address, phone)
3. Click "Approve & Apply" button
4. Verify success toast appears

**Expected Result:**
```
✅ POST /api/receipts/{id}/approve returns 200 OK
✅ Response contains { ok: true, captureId, storeId, createdProducts, ... }
✅ New Store created in database (isActive: false, createdFrom: 'receipt_upload')
✅ New Products created for unmatched items
✅ StoreInventory records created with observedPrice
✅ UpcItems linked to Products
✅ Audit log created: type='store_created_from_receipt'
✅ Audit log created: type='receipt_approved'
✅ ReceiptParseJob.status updated to 'APPROVED'
```

**API Call (curl):**
```bash
curl -X POST 'http://localhost:5000/api/receipts/64a1f2b3c4d5e6f7g8h9i0j1/approve' \
  -H 'Content-Type: application/json' \
  -b "session=<your-jwt-token>" \
  -d '{
    "storeCandidate": {
      "name": "Walmart Store #42",
      "address": {
        "street": "123 Main St",
        "city": "Ann Arbor",
        "state": "MI",
        "zip": "48103"
      },
      "phone": "(734) 123-4567",
      "storeType": "walmart"
    },
    "items": [...]
  }'
```

**Database Verification:**
```javascript
// Check Store was created
db.stores.findOne({ name: "Walmart Store #42" })
// Should return: { _id: ..., name: "...", isActive: false, createdFrom: "receipt_upload", ... }

// Check Products were created
db.products.find({ store: ObjectId("...storeId...") })
// Should return created products with sku, name, price, deposit

// Check StoreInventory
db.storeinventories.find({ storeId: ObjectId("...storeId...") })
// Should return entries with observedPrice, priceHistory

// Check AuditLog
db.auditlogs.find({ type: { $in: ["store_created_from_receipt", "receipt_approved"] } }).sort({ createdAt: -1 }).limit(5)
// Should show recent audit entries with actorId matching logged-in user
```

---

### Scenario 4: Reject Receipt

**Test:** Owner can reject a receipt parse job

**Setup:**
- Have a parsed receipt with NEEDS_REVIEW status

**Steps:**
1. Select receipt from list
2. Click "Reject" button
3. Provide optional rejection reason
4. Verify success toast appears
5. Verify receipt disappears from NEEDS_REVIEW filter

**Expected Result:**
```
✅ POST /api/receipts/{id}/reject returns 200 OK
✅ Response contains { ok: true }
✅ ReceiptParseJob.status updated to 'REJECTED'
✅ ReceiptParseJob.metadata.rejectionReason stored
✅ Audit log created: type='receipt_rejected'
✅ Receipt no longer appears in NEEDS_REVIEW filter
✅ Receipt appears in REJECTED filter
```

**API Call (curl):**
```bash
curl -X POST 'http://localhost:5000/api/receipts/64a1f2b3c4d5e6f7g8h9i0j1/reject' \
  -H 'Content-Type: application/json' \
  -b "session=<your-jwt-token>" \
  -d '{ "reason": "Duplicate receipt, already processed" }'
```

---

### Scenario 5: Permission Denied (Non-Owner)

**Test:** Non-owners (CUSTOMER, DRIVER) cannot access receipt endpoints

**Steps:**
1. Log in as regular customer
2. Try to manually call GET `/api/receipts`

**Expected Result:**
```
✅ GET /api/receipts returns 403 Forbidden
✅ Response contains { error: "Not authorized" }
✅ No receipt data leaked
```

**API Call (curl):**
```bash
curl -X GET 'http://localhost:5000/api/receipts' \
  -H 'Content-Type: application/json' \
  -b "session=<your-jwt-token-customer>"
# Should return: 403 { error: "Not authorized" }
```

---

### Scenario 6: Audit Trail

**Test:** All receipt actions create audit logs

**Setup:**
- Approve 1 receipt
- Reject 1 receipt
- Query audit logs

**Steps:**
1. Navigate to Management → Audit Logs
2. Filter by type 'receipt_approved' and 'receipt_rejected'
3. Verify entries show correct actor, timestamp, and details

**Expected Result:**
```
✅ Audit logs created for each action
✅ Log contains: type, actorId, details, createdAt
✅ Approvals show: storeId, createdProducts count, inventoryUpdates count
✅ Rejections show: jobId, rejectionReason
```

**Database Query:**
```javascript
db.auditlogs.find({ 
  type: { $in: ["receipt_approved", "receipt_rejected"] },
  actorId: "owner_test"
}).sort({ createdAt: -1 }).limit(10)
```

---

## Regression Tests

### Test: Backward Compatibility with Legacy Endpoint

**Purpose:** Ensure legacy `/api/receipt-review` endpoints still work during transition

**Steps:**
1. Call GET `/api/receipt-review/receipts?status=NEEDS_REVIEW`
2. Call GET `/api/receipt-review/receipts/{id}`
3. Call POST `/api/receipt-review/receipts/{id}/approve`
4. Call POST `/api/receipt-review/receipts/{id}/reject`

**Expected Result:**
```
✅ All legacy endpoints return 200 OK with same response structure
✅ Data returned matches new unified endpoint behavior
✅ No functionality differences
```

---

### Test: Concurrent Approvals (Race Condition)

**Purpose:** Ensure atomic transactions prevent double-application

**Setup:**
- Parse receipt with store candidate and line items
- Prepare two approval requests simultaneously

**Steps:**
1. Send two concurrent POST `/api/receipts/{id}/approve` requests
2. Monitor database for duplicates

**Expected Result:**
```
✅ Only one approval succeeds (200 OK)
✅ Second approval fails gracefully (409 Conflict or 400 Bad Request)
✅ No duplicate StoreInventory records
✅ No duplicate Products
✅ Exactly one audit log entry
```

---

### Test: Invalid Store Candidate

**Purpose:** Ensure validation catches missing required fields

**Setup:**
- Prepare receipt with empty storeCandidate

**Steps:**
1. Send POST `/api/receipts/{id}/approve` with missing store name

**Expected Result:**
```
✅ Approval fails with 400 Bad Request
✅ Response contains: { error: "Store candidate is required for approval." }
✅ No database mutations
✅ ReceiptParseJob status unchanged
```

---

## Performance Tests

### Test: List Pagination

**Purpose:** Ensure large receipt lists don't cause timeout

**Setup:**
- Create 200+ parsed receipts

**Steps:**
1. Call GET `/api/receipts?status=NEEDS_REVIEW&limit=100`
2. Measure response time

**Expected Result:**
```
✅ Response time < 2 seconds
✅ Response contains up to 100 jobs (sorted by createdAt DESC)
✅ Limit parameter respected (max 200)
```

---

## UI Integration Tests

### Test: ManagementReceipts Component Render

**Purpose:** Verify React component uses new endpoints correctly

**Setup:**
- Navigate to Management page
- Select "Pricing Intelligence" or receipt module

**Steps:**
1. Wait for receipts to load
2. Filter by different statuses
3. Click on a receipt to view details
4. Click Approve button
5. Verify success/error states

**Expected Result:**
```
✅ Component loads without errors
✅ Receipts display with correct structure
✅ Status filters work (NEEDS_REVIEW, PARSED, APPROVED, REJECTED)
✅ Detail panel shows store candidate and items
✅ Approve button triggers correct API call
✅ Success toast appears after approval
✅ Receipt disappears from NEEDS_REVIEW and appears in APPROVED
```

---

## Checklist for Sign-Off

- [ ] All 6 main test scenarios pass
- [ ] All 4 regression tests pass
- [ ] All 2 performance tests pass
- [ ] All 3 UI integration tests pass
- [ ] No console errors in browser DevTools
- [ ] No server errors in backend logs
- [ ] Database audit logs show expected entries
- [ ] Backward compatibility verified with legacy endpoints
- [ ] Permission checks work correctly for all roles
- [ ] No race conditions detected in concurrent tests

---

## Troubleshooting

### Issue: 401 Unauthorized on receipt endpoints

**Cause:** JWT cookie not attached or expired

**Solution:**
1. Log in again
2. Verify `session` cookie in browser DevTools
3. Check COOKIE_DOMAIN env var matches your domain

### Issue: 403 Forbidden on receipt endpoints

**Cause:** User role is not OWNER or username not in OWNER_USERNAMES

**Solution:**
1. Verify user role in database: `db.users.findOne({ username: "your_user" })`
2. Check OWNER_USERNAMES env var: `echo $OWNER_USERNAMES`
3. Ensure username is in comma-separated list with proper prefix (owner_)

### Issue: StoreInventory not created

**Cause:** Store lookup failed or product not linked

**Solution:**
1. Verify store was created: `db.stores.findOne({ name: "..." })`
2. Check ReceiptParseJob.storeCandidate.storeId is set
3. Verify items have suggestedProduct.productId or auto-created

### Issue: Audit logs not showing

**Cause:** recordAuditLog failed silently

**Solution:**
1. Check backend logs for "AUDIT LOG ERROR"
2. Verify AuditLog model exists
3. Check MongoDB write permissions

---

**Last Updated:** January 2026  
**Tested Version:** TBD  
**Tester Name:** [Your Name]
