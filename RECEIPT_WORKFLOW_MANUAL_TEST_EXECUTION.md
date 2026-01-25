# Receipt Workflow - Manual Testing Execution Checklist

**Project:** NinpoSnacks Receipt Workflow Alignment  
**Phase:** 1 - Implementation Complete, Testing Started  
**Date Started:** January 2026  
**Tester:** [Your Name]  
**Test Environment:** Local Development (localhost:5000 + localhost:5173)

---

## Pre-Test Setup

### Environment Preparation
- [ ] Backend service running: `npm start`
- [ ] Frontend service running: `npm run dev`
- [ ] MongoDB running and accessible
- [ ] Test owner account created: `npm run create-owner`
- [ ] Browser opened to http://localhost:5173
- [ ] DevTools open (F12) - Console and Network tabs
- [ ] Terminal with `tail -f server.log` (to watch backend logs)
- [ ] Database client open (MongoDB Compass or mongo CLI)

### Test Data Setup
- [ ] At least 1 receipt with status='NEEDS_REVIEW' in database
- [ ] At least 1 receipt with status='PARSED' in database
- [ ] Store with receipt-based origin does NOT exist yet (for Scenario 3)
- [ ] No recent audit logs (to make new ones stand out)

**Create Test Receipt (if needed):**
```javascript
// In MongoDB console
db.receiptparsejobs.insertOne({
  captureId: "test-receipt-" + Date.now(),
  status: "NEEDS_REVIEW",
  storeCandidate: {
    name: "Test Walmart #1",
    address: { street: "123 Main", city: "Ann Arbor", state: "MI", zip: "48103" },
    phone: "(734) 123-4567",
    storeType: "walmart",
    confidence: 0.95
  },
  items: [
    {
      lineIndex: 0,
      receiptName: "COCA COLA 12PK BOTTLE",
      totalPrice: 8.99,
      quantity: 1,
      unitPrice: 8.99,
      suggestedProduct: null,
      needsReview: true
    }
  ],
  createdAt: new Date()
})
```

---

## Test Execution Log

### Scenario 1: Fetch Receipt List (Role-Neutral GET)

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Click "Management" in top nav
- [ ] Click "Pricing Intelligence" (or receipt module)
- [ ] Wait for list to load (should see receipts)
- [ ] Open DevTools Network tab
- [ ] Filter by status "NEEDS_REVIEW"
- [ ] Verify network request shows: `GET /api/receipts?status=NEEDS_REVIEW`
- [ ] Verify response status: **200 OK**
- [ ] Verify response body has structure: `{ ok: true, jobs: [...] }`

**Results:**
```
Request URL: ________________
Request Status: ______
Response Time: ______ms
Jobs Count: ______
✅ PASS / ❌ FAIL
```

**Issues Encountered:** 
_________________________________

---

### Scenario 2: Fetch Single Receipt (Role-Neutral GET)

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] From receipt list, click on one receipt to view details
- [ ] Wait for details panel to load
- [ ] Open DevTools Network tab
- [ ] Find request matching pattern: `GET /api/receipts/[id]`
- [ ] Verify response status: **200 OK**
- [ ] Verify response shows store candidate details
- [ ] Verify response shows line items with name/qty/price
- [ ] Verify store candidate shows: name, address, phone, confidence

**Results:**
```
Request URL: ________________
Request Status: ______
Store Name: ________________
Items Count: ______
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

### Scenario 3: Approve Receipt with Store Creation

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] In detail panel, verify store candidate is displayed
- [ ] Click "Approve & Apply" button (or similar)
- [ ] If prompted, confirm the store candidate
- [ ] Wait for operation to complete
- [ ] Verify success toast appears (green banner at bottom)
- [ ] Open DevTools Network tab to find request
- [ ] Verify request: `POST /api/receipts/[id]/approve`
- [ ] Verify response status: **200 OK**
- [ ] Verify response contains: `createdProducts`, `inventoryUpdates`, `storeId`

**Database Verification - CRITICAL:**
```javascript
// Open MongoDB console

// 1. Verify Store was created
db.stores.findOne({ createdFrom: 'receipt_upload' })
// Should return: { _id: ..., name: "Test Walmart #1", isActive: false, ... }

✅ Store found with _id: ________________
OR ❌ Store NOT found

// 2. Verify Products were created
db.products.find({ store: ObjectId("...storeId...") })
// Should return products created from receipt

✅ ______ products created
OR ❌ Products NOT found

// 3. Verify StoreInventory updated
db.storeinventories.find({ storeId: ObjectId("...storeId...") })
// Should show observedPrice entries

✅ ______ inventory entries
OR ❌ Inventory NOT found

// 4. Verify Audit Logs created
db.auditlogs.find({ type: 'receipt_approved' }).sort({ createdAt: -1 }).limit(2)
// Should show recent approval log

✅ Audit logs found
OR ❌ Audit logs NOT found
```

**Results:**
```
Request URL: ________________
Request Status: ______
Store Created: ✅ / ❌
Products Created: ______ count
Inventory Updated: ______ records
Audit Logs: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

### Scenario 4: Reject Receipt

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] From receipt list, select a different receipt (with status=PARSED or NEEDS_REVIEW)
- [ ] In detail panel, click "Reject" button (or similar)
- [ ] If prompted, enter rejection reason (e.g., "Duplicate receipt")
- [ ] Confirm action
- [ ] Wait for operation to complete
- [ ] Verify success toast appears
- [ ] Open DevTools Network tab
- [ ] Find request: `POST /api/receipts/[id]/reject`
- [ ] Verify response status: **200 OK**
- [ ] Refresh receipt list and filter by status "REJECTED"
- [ ] Verify receipt now appears in REJECTED list
- [ ] Verify it NO LONGER appears in NEEDS_REVIEW/PARSED lists

**Database Verification:**
```javascript
// Open MongoDB console

// Verify status updated
db.receiptparsejobs.findOne({ _id: ObjectId("...receipt-id...") })
// Should show: { status: "REJECTED", metadata: { rejectionReason: "..." }, ... }

✅ Status is REJECTED
OR ❌ Status NOT updated

// Verify Audit Log
db.auditlogs.findOne({ type: 'receipt_rejected' })
// Should show rejection log

✅ Rejection audit log found
OR ❌ Audit log NOT found
```

**Results:**
```
Request URL: ________________
Request Status: ______
Receipt Status Updated: ✅ / ❌
Audit Log Created: ✅ / ❌
Receipt Appears in REJECTED Filter: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

### Scenario 5: Permission Denied (Non-Owner)

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Open new incognito/private browser window
- [ ] Navigate to http://localhost:5173
- [ ] Log in as a regular CUSTOMER (not owner)
- [ ] Try to navigate to Management page directly: `/management`
- [ ] Verify access is DENIED or page redirects to home
- [ ] Open DevTools and paste this in Console:
```javascript
fetch('http://localhost:5000/api/receipts', {
  method: 'GET',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(d => console.log('Status:', r.status, 'Body:', d))
```
- [ ] Verify response status: **403 Forbidden**
- [ ] Verify response body: `{ error: "Not authorized" }`
- [ ] Verify NO receipt data was returned

**Results:**
```
User Role: CUSTOMER
Request Status: ______
Error Message: ________________
No Data Leaked: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

### Scenario 6: Audit Trail Verification

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Log in as OWNER
- [ ] Navigate to Management → Settings or Audit Logs (if available)
- [ ] Open MongoDB console in parallel
- [ ] Run query to find recent receipt audit logs:

```javascript
db.auditlogs.find({
  type: { $in: ["receipt_approved", "receipt_rejected", "store_created_from_receipt"] }
}).sort({ createdAt: -1 }).limit(20)
```

- [ ] Verify at least these entries exist:
  - ✅ type='receipt_approved' with your username as actorId
  - ✅ type='receipt_rejected' with your username as actorId
  - ✅ type='store_created_from_receipt' with details showing storeId

**Results:**
```
Receipt Approved Logs: ______ found
Receipt Rejected Logs: ______ found
Store Created Logs: ______ found
Actor ID Matches: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

## Regression Tests

### Test: Backward Compatibility (Legacy Endpoint)

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Open DevTools Console and run:

```javascript
// Test legacy endpoint
fetch('http://localhost:5000/api/receipt-review/receipts?status=NEEDS_REVIEW', {
  method: 'GET',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(d => {
  console.log('Status:', r.status);
  console.log('Response:', d);
  console.log('Same as new endpoint?', JSON.stringify(d) === '...');
})
```

- [ ] Verify response status: **200 OK**
- [ ] Verify response format matches new endpoint
- [ ] Verify data is identical to `/api/receipts`

**Results:**
```
Legacy Endpoint Status: ______
Matches New Endpoint: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

### Test: Concurrent Approvals (Race Condition)

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Create or identify a receipt with NEEDS_REVIEW status
- [ ] Note the receipt ID: _____________________
- [ ] Open two browser tabs
- [ ] In Tab 1, open DevTools Console and prepare this code:

```javascript
const receiptId = 'YOUR_RECEIPT_ID';
fetch(`http://localhost:5000/api/receipts/${receiptId}/approve`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    storeCandidate: {
      name: "Concurrent Test Store",
      address: { street: "Test", city: "City", state: "ST", zip: "12345" }
    },
    items: []
  })
})
.then(r => { console.log('TAB 1 Status:', r.status); return r.json(); })
.then(d => console.log('TAB 1 Response:', d))
```

- [ ] In Tab 2, prepare identical code with different store name:

```javascript
const receiptId = 'YOUR_RECEIPT_ID';
fetch(`http://localhost:5000/api/receipts/${receiptId}/approve`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    storeCandidate: {
      name: "Concurrent Test Store 2",
      address: { street: "Test", city: "City", state: "ST", zip: "12345" }
    },
    items: []
  })
})
.then(r => { console.log('TAB 2 Status:', r.status); return r.json(); })
.then(d => console.log('TAB 2 Response:', d))
```

- [ ] Click Execute in Tab 1
- [ ] Immediately click Execute in Tab 2 (within 1 second)
- [ ] Check results:
  - One should be 200 OK (success)
  - Other should be 400/409 (conflict/error)
- [ ] Check database for duplicate stores:

```javascript
db.stores.find({ name: /Concurrent Test Store/ })
// Should find only 1 store (not 2)
```

**Results:**
```
Tab 1 Status: ______
Tab 2 Status: ______
One Success, One Failed: ✅ / ❌
Duplicate Stores Created: ______ (should be 1)
No Partial Mutations: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

## UI Integration Tests

### Test: ManagementReceipts Component Render

**Status:** ⏳ NOT STARTED

**Execution Steps:**
- [ ] Log in as OWNER
- [ ] Navigate to Management → Pricing Intelligence (or receipt module)
- [ ] Verify page loads without errors
- [ ] Check browser console for errors: Should be CLEAN
- [ ] Verify receipt list displays:
  - [ ] Shows receipt count
  - [ ] Shows status badge (NEEDS_REVIEW, PARSED, etc.)
  - [ ] Shows item count per receipt
  - [ ] Shows timestamp of receipt

- [ ] Test Status Filters:
  - [ ] Click "NEEDS_REVIEW" - list updates
  - [ ] Click "PARSED" - list updates
  - [ ] Click "APPROVED" - list updates
  - [ ] Click "REJECTED" - list updates

- [ ] Test Detail Panel:
  - [ ] Click receipt to open details
  - [ ] Verify store candidate displayed
  - [ ] Verify line items shown
  - [ ] Verify "Approve" and "Reject" buttons visible

- [ ] Test Approve Flow:
  - [ ] Click "Approve" button
  - [ ] Wait for toast notification
  - [ ] Verify "Success" toast appears
  - [ ] Verify receipt disappears from current filter
  - [ ] Verify receipt appears in "APPROVED" filter

- [ ] Test Reject Flow:
  - [ ] Click different receipt
  - [ ] Click "Reject" button
  - [ ] Enter reason in prompt
  - [ ] Click confirm
  - [ ] Wait for toast notification
  - [ ] Verify success
  - [ ] Verify receipt moves to "REJECTED" filter

**Results:**
```
Component Renders: ✅ / ❌
No Console Errors: ✅ / ❌
Status Filters Work: ✅ / ❌
Detail Panel Shows Data: ✅ / ❌
Approve Flow Works: ✅ / ❌
Reject Flow Works: ✅ / ❌
Toast Notifications Show: ✅ / ❌
✅ PASS / ❌ FAIL
```

**Issues Encountered:**
_________________________________

---

## Final Sign-Off

### Test Summary
```
Scenario 1 (Fetch List):      ✅ PASS / ❌ FAIL
Scenario 2 (Fetch Single):    ✅ PASS / ❌ FAIL
Scenario 3 (Approve):         ✅ PASS / ❌ FAIL
Scenario 4 (Reject):          ✅ PASS / ❌ FAIL
Scenario 5 (Permissions):     ✅ PASS / ❌ FAIL
Scenario 6 (Audit Trail):     ✅ PASS / ❌ FAIL
Regression 1 (Legacy):        ✅ PASS / ❌ FAIL
Regression 2 (Concurrent):    ✅ PASS / ❌ FAIL
UI Integration Tests:         ✅ PASS / ❌ FAIL
```

### Known Issues & Workarounds
1. _________________________________
2. _________________________________
3. _________________________________

### Recommendations
- [ ] Ready for Phase 2 development
- [ ] Fix identified issues before Phase 2
- [ ] Conduct additional performance testing
- [ ] Add integration test suite

### Approval
- **Tester Name:** _______________________
- **Date Completed:** _______________________
- **Status:** ✅ APPROVED / ❌ FAILED / ⏳ PENDING

**Sign-Off:**
```
_______________________     Date: _____________
(Tester Signature)
```

---

**Notes & Additional Comments:**

_________________________________________________________________

_________________________________________________________________

_________________________________________________________________

---

**Test Environment Details:**
- Backend Version: _______________________
- Frontend Version: _______________________
- Node Version: _______________________
- MongoDB Version: _______________________
- OS: Windows 11
- Browser: Chrome Version _______________________

---

**Attached Artifacts:**
- [ ] Screenshot of successful approvals
- [ ] Screenshot of audit logs
- [ ] Network tab recording (HAR file)
- [ ] Database export of test data
- [ ] Console error logs (if any)

---

**For Questions or Issues:**
Contact: [Your Name]  
Email: [Your Email]  
Slack: @[Your Handle]
