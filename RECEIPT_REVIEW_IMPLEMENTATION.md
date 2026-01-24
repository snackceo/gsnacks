# Receipt Parsing & Review Implementation Summary

## Overview
Implemented a robust, review-first receipt parsing pipeline that treats all parsing and matching results as proposals/drafts. No immediate mutations to stores, products, or inventory until management approval.

## Architecture

### 1. Data Model: ReceiptParseJob
**Location:** [server/models/ReceiptParseJob.js](server/models/ReceiptParseJob.js)

Canonical proposal object with:
- `captureId` (unique, indexed)
- `status`: QUEUED → PARSED → NEEDS_REVIEW → APPROVED/REJECTED
- `storeCandidate`: name, address, phone, confidence, matched `storeId`
- `items[]`: rawLine, nameCandidate, quantity, unitPrice, lineTotal, match info, warnings
- `metadata`: approvedBy, storeId, createdProducts, priceObservations

### 2. Store Matching Utility
**Location:** [server/utils/storeMatcher.js](server/utils/storeMatcher.js)

Deterministic matching in priority order:
1. Exact `storeId` (unlikely from receipt)
2. Phone match (normalized digits)
3. Address match (normalized street/city/state/zip)
4. Fuzzy name + same city/zip (Levenshtein, threshold=0.25)

Returns `{ match: Store | null, confidence: 0..1, reason: string }`

### 3. Backend Endpoints

#### Capture & Parse
- **POST /api/driver/receipt-capture**: Create capture, attempt store matching, initialize ReceiptParseJob proposal
- **POST /api/driver/receipt-parse**: Enqueue or immediately parse (same logic used by both route and worker)

#### Review & Management
- **GET /api/receipts?status=NEEDS_REVIEW**: List draft proposals (auth-gated, managers only)
- **GET /api/receipts/:id**: Full detail for review
- **POST /api/receipts/:id/approve**: 
  - Auto-create store (if missing, status=DRAFT, isActive=false)
  - Create products for unmatched items
  - Emit price observations to StoreInventory
  - Audit log
- **POST /api/receipts/:id/reject**: Mark rejected, audit log

### 4. Frontend Components

#### ManagementReceipts
**Location:** [src/views/management/ManagementReceipts.tsx](src/views/management/ManagementReceipts.tsx)

List receipt drafts with filters (NEEDS_REVIEW, PARSED, APPROVED, REJECTED):
- Show store candidate (name, address, phone, confidence)
- List line items with:
  - Raw name + normalized candidate
  - Qty, unit price, total
  - Match confidence & reason
  - Warnings (e.g., price out of bounds)
- Approve/Reject buttons with audit trail

#### Image Upload Flow
**Location:** [src/views/ManagementView.tsx](src/views/ManagementView.tsx#L788)

Already implemented:
1. Capture/scan receipt image locally
2. Upload to Cloudinary via `uploadReceiptPhoto()`
3. Send Cloudinary URL to `/api/driver/receipt-capture`
4. Trigger `/api/driver/receipt-parse` or queue job
5. Emit receipt-queue-refresh event to trigger UI update

### 5. Workers & Queue

#### Receipt Worker
**Location:** [server/workers/receiptWorker.js](server/workers/receiptWorker.js)

- Listens for `receipt-parse` jobs from BullMQ
- Calls shared `executeReceiptParse()` helper
- Updates ReceiptCapture status
- Creates ReceiptParseJob proposal
- Error handling: marks capture as failed, logs error

#### Helper Function
**Location:** [server/utils/receiptParseHelper.js](server/utils/receiptParseHelper.js)

Shared parsing logic used by both:
- Receipt-prices route (sync or async)
- Receipt worker (background job)

## Proposal Persistence Flow

```
Receipt Upload
  ↓
[POST /api/driver/receipt-capture]
  ↓ (store matching)
  ├→ Auto-create store (DRAFT) if high confidence
  └→ Initialize ReceiptParseJob(QUEUED) with storeCandidate
  ↓
[POST /api/driver/receipt-parse]
  ↓ (Gemini extraction + product matching)
  └→ upsertReceiptParseJobFromDraft()
      - Items with match suggestions
      - Status: PARSED or NEEDS_REVIEW (based on warnings)
  ↓
[Management: GET /api/receipts?status=NEEDS_REVIEW]
  ↓ (Review & Edit)
[POST /api/receipts/:id/approve]
  ├→ Create store (if not already exists)
  ├→ Create products for unmatched items
  ├→ Emit price observations
  └→ Mark approved, audit log
  ↓
Real inventory + pricing data applied
```

## Key Safety Features

1. **No Direct Mutations**: Parsing results are proposals only
2. **Management Review**: Items must be explicitly approved
3. **Draft Stores**: Auto-created stores are inactive (`isActive=false`) until activated
4. **Audit Trail**: All approvals/rejections logged
5. **Deterministic Matching**: No fuzzy/ML-based decisions without verification
6. **Warnings System**: Items flagged for:
   - Decayed confidence (alias trust decay)
   - Missing size tokens
   - Price out of bounds
   - Tax/coupon/promo lines
7. **Validation**: Cloudinary URLs, image types, sizes enforced

## Testing Checklist

### Backend API
- [ ] POST /api/driver/receipt-capture (with Cloudinary URL)
  - [ ] Validates storeId exists
  - [ ] Creates ReceiptCapture record
  - [ ] Initializes ReceiptParseJob with storeCandidate
- [ ] POST /api/driver/receipt-parse
  - [ ] Enqueues or immediately parses
  - [ ] Calls Gemini (if enabled)
  - [ ] Updates ReceiptParseJob with items
  - [ ] Sets status=NEEDS_REVIEW if warnings present
- [ ] GET /api/receipts?status=NEEDS_REVIEW
  - [ ] Auth-gated (manager/owner only)
  - [ ] Returns sorted list
- [ ] POST /api/receipts/:id/approve
  - [ ] Creates store if missing
  - [ ] Creates products for items
  - [ ] Emits price observations
  - [ ] Marks approved, audit log
- [ ] POST /api/receipts/:id/reject
  - [ ] Marks rejected, audit log

### Frontend
- [ ] ManagementReceipts component renders
- [ ] List/filter receipts by status
- [ ] Detail panel shows store candidate + items
- [ ] Approve/Reject buttons functional
- [ ] Toasts on success/error

### Integration
- [ ] Upload image → receipt appears in NEEDS_REVIEW
- [ ] Approve → store/products created
- [ ] Rejected receipts don't affect inventory
- [ ] Worker processes jobs (if queue enabled)

## Known Limitations & Future Work

1. **Gemini Integration**: Current placeholder in helper; full extraction/matching in receipt-prices.js
2. **Partial Approval**: Not implemented (approve all items or none)
3. **Product Linking UI**: Management can't currently select from existing products during review
4. **UPC Registry**: Not yet integrated with approval flow
5. **Price Locking**: Not enforced when creating price observations
6. **Category Classification**: Uses "uncategorized" for newly created products
7. **Bulk Operations**: No batch approve/reject

## Configuration

Ensure these env vars:
- `ENABLE_RECEIPT_QUEUE=true` (if using BullMQ worker)
- `BULLMQ_URL` or `REDIS_URL` (for queue)
- `GEMINI_API_KEY` (for Gemini Vision parsing)
- `CLOUDINARY_NAME`, `CLOUDINARY_KEY`, `CLOUDINARY_SECRET` (for image upload)

## Files Created/Modified

**New Files:**
- [server/models/ReceiptParseJob.js](server/models/ReceiptParseJob.js)
- [server/utils/storeMatcher.js](server/utils/storeMatcher.js)
- [server/utils/receiptParseHelper.js](server/utils/receiptParseHelper.js)
- [server/routes/receipt-review.js](server/routes/receipt-review.js)
- [src/views/management/ManagementReceipts.tsx](src/views/management/ManagementReceipts.tsx)

**Modified Files:**
- [server/index.js](server/index.js): Added receipt-review route
- [server/routes/receipt-prices.js](server/routes/receipt-prices.js): Added storeMatcher import, ReceiptParseJob creation, approval logic
- [server/workers/receiptWorker.js](server/workers/receiptWorker.js): Wired to executeReceiptParse helper
- [src/views/ManagementView.tsx](src/views/ManagementView.tsx): Added ManagementReceipts module

## Next Steps

1. **Complete Gemini Integration**: Move full extraction logic from receipt-prices.js into a reusable module
2. **Product Selection UI**: Let managers select existing products during review
3. **UPC Linking**: Integrate UPC registry with approval flow
4. **Batch Operations**: Approve multiple receipts at once
5. **Analytics**: Dashboard showing approval rate, most common items, store matching accuracy
