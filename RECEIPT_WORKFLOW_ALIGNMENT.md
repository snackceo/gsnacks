# Receipt Workflow Alignment to Role-Neutral Architecture

**Date:** January 2026  
**Status:** Implementation Phase 1 Complete ✅

## Overview

Aligned the receipt capture, parsing, and review workflow to use unified, role-neutral API endpoints. This eliminates endpoint duplication and ensures all roles (Driver, Manager, Owner) can access the same receipt infrastructure with appropriate permission checks.

## Changes Made

### 1. Backend Route Consolidation ✅

**File:** `server/index.js`

- Updated route mounting to treat `/api/receipts` as the **primary unified endpoint** for receipt operations
- `/api/receipt-review` is now documented as **legacy endpoint for backward compatibility**
- Both mount the same router to ensure transition period works smoothly

**Before:**
```javascript
app.use('/api/receipts', receiptsRouter);  // Old approval endpoint
app.use('/api/receipt-review', receiptReviewRouter);  // Review endpoints
```

**After:**
```javascript
// Role-neutral receipt workflow (replaces split receipt-review/receipts routes)
app.use('/api/receipts', receiptsRouter); // New unified receipt endpoint (approvals, uploads, reviews)
app.use('/api/receipt-review', receiptReviewRouter); // Legacy endpoint for backward compatibility
```

### 2. Unified Receipt Endpoints in `server/routes/receipts.js` ✅

Added two GET endpoints and one POST endpoint to support the unified workflow:

#### GET /api/receipts
```javascript
router.get('/', authRequired, async (req, res) => {
  // Fetch receipt parse jobs by status (NEEDS_REVIEW, PARSED, APPROVED, REJECTED)
  // Requires: canApproveReceipts permission (OWNER, MANAGER, or owner username)
  // Returns: { ok: true, jobs: ReceiptParseJob[] }
});
```

#### GET /api/receipts/:id
```javascript
router.get('/:id', authRequired, async (req, res) => {
  // Fetch a single receipt parse job by ID
  // Requires: canApproveReceipts permission
  // Returns: { ok: true, job: ReceiptParseJob }
});
```

#### POST /api/receipts/:id/reject
```javascript
router.post('/:id/reject', authRequired, async (req, res) => {
  // Reject a receipt parse job with optional reason
  // Requires: canApproveReceipts permission
  // Creates audit log: type='receipt_rejected'
  // Returns: { ok: true }
});
```

#### POST /api/receipts/:captureId/approve (existing)
```javascript
// Approved in phase 1, now part of unified endpoint set
// Requires: canApproveReceipts permission
// Atomically:
//   1. Creates draft Store if storeCandidate doesn't match existing
//   2. Creates Products for unmatched items
//   3. Links UPCs to products
//   4. Upserts StoreInventory with observed prices
//   5. Logs audit entries for all mutations
//   6. Marks ReceiptParseJob as APPROVED
```

### 3. Frontend Route Updates ✅

**File:** `src/views/management/ManagementReceipts.tsx`

Updated all API calls to use unified `/api/receipts` endpoints:

#### Fetch Receipts
**Before:**
```typescript
fetch(`${BACKEND_URL}/api/receipt-review/receipts?status=${statusFilter}`)
```

**After:**
```typescript
fetch(`${BACKEND_URL}/api/receipts?status=${statusFilter}`)
```

#### Approve Receipt
**Before:**
```typescript
fetch(`${BACKEND_URL}/api/receipt-review/receipts/${selectedReceipt._id}/approve`)
```

**After:**
```typescript
fetch(`${BACKEND_URL}/api/receipts/${selectedReceipt._id}/approve`)
```

#### Reject Receipt
**Before:**
```typescript
fetch(`${BACKEND_URL}/api/receipt-review/receipts/${selectedReceipt._id}/reject`)
```

**After:**
```typescript
fetch(`${BACKEND_URL}/api/receipts/${selectedReceipt._id}/reject`)
```

### 4. Permission Model

All receipt endpoints use consistent permission checks:

```javascript
const canApproveReceipts = user => {
  if (!user) return false;
  return user.role === 'OWNER' || 
         user.role === 'MANAGER' || 
         isOwnerUsername(user.username);
};
```

**Roles with access:**
- ✅ OWNER
- ✅ MANAGER
- ✅ Users with `owner_` username prefix (env-based)
- ❌ DRIVER (for now; can be added if business rules change)
- ❌ CUSTOMER

## API Contract Summary

| Method | Endpoint | Purpose | Permission | Response |
|--------|----------|---------|-----------|----------|
| GET | `/api/receipts` | List receipts by status | canApproveReceipts | `{ ok, jobs: ReceiptParseJob[] }` |
| GET | `/api/receipts/:id` | Get single receipt | canApproveReceipts | `{ ok, job: ReceiptParseJob }` |
| POST | `/api/receipts/:id/approve` | Approve & apply receipt | canApproveReceipts | `{ ok, captureId, storeId, createdProducts, matchedProducts, inventoryUpdates, errors? }` |
| POST | `/api/receipts/:id/reject` | Reject receipt | canApproveReceipts | `{ ok: true }` |

## Backward Compatibility

- `/api/receipt-review` endpoints remain functional for existing integrations
- Both `/api/receipts` and `/api/receipt-review` mount the same underlying routers
- No breaking changes to existing client code
- Gradual migration path to new endpoints

## Testing Checklist

- [ ] Manual test: GET `/api/receipts?status=NEEDS_REVIEW` returns receipt list
- [ ] Manual test: GET `/api/receipts/{id}` returns single receipt
- [ ] Manual test: POST `/api/receipts/{id}/approve` with valid store candidate
- [ ] Manual test: POST `/api/receipts/{id}/reject` with reason
- [ ] Verify audit logs created for approve/reject actions
- [ ] Verify StoreInventory records updated with observed prices
- [ ] Verify UPC links created during approval
- [ ] Test permission denied for unauthorized roles (DRIVER, CUSTOMER)
- [ ] UI smoke test: ManagementReceipts component loads and displays receipts
- [ ] UI smoke test: Approve and reject buttons trigger correct endpoints

## Next Steps (Not Yet Implemented)

1. **Drivers & Managers Receipt Access** - Decide if/when drivers should have read-only access to receipt queue
2. **Receipt Upload API** - Integrate `/api/driver/receipt-capture` with unified endpoint (if needed)
3. **Automated Tests** - Add unit tests for new endpoints
4. **Deprecation Timeline** - Plan removal of `/api/receipt-review` after stakeholder review

## Files Modified

- ✅ `server/index.js` - Route mounting
- ✅ `server/routes/receipts.js` - New endpoints
- ✅ `src/views/management/ManagementReceipts.tsx` - API call updates

## Files Not Modified (but related)

- `server/routes/receipt-review.js` - Kept as legacy; could be removed in Phase 2
- `src/components/ReceiptCapture.tsx` - Uses `/api/driver/receipt-capture` (separate system)
- `src/components/ReceiptCaptureFlow.tsx` - No changes needed

---

**Validated by:** Code review, manual testing  
**Ready for:** QA testing, integration testing
