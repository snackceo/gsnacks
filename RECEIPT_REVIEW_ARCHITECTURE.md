# Receipt Review System - Architecture & Flow Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        RECEIPT REVIEW SYSTEM                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐      ┌──────────────────┐      ┌──────────────┐
│  FRONTEND (Driver)  │      │  STORAGE (Cloud) │      │  BACKEND API │
│                     │      │                  │      │              │
│ • Capture photo     │─────→│  Cloudinary      │──┐   │              │
│ • Camera/gallery    │      │  (uploaded URL)  │  │   │              │
│                     │      └──────────────────┘  │   │              │
└─────────────────────┘                             │   │              │
                                                    │   │              │
                                                    ↓   │              │
                        ┌──────────────────────────────→│ POST         │
                        │                           │   │ /receipt-    │
                        │                           │   │ capture      │
                        │                           │   │              │
                        │                           └──→│ Creates:     │
                        │                               │ • Receipt    │
                        │                               │   Capture    │
                        │                               │ • Parse Job  │
                        │                               │   (QUEUED)   │
                        │                               │              │
                        │                               └──────────────┘
                        │
                        │  ┌────────────────────────────────────────┐
                        └─→│ POST /receipt-parse                    │
                           │                                        │
                           ├─→ Route: Immediate parse (or enqueue) │
                           │                                        │
                           └─→ Worker: Background job (BullMQ)     │
                              (if ENABLE_RECEIPT_QUEUE=true)       │
                                                                    │
                                        │                           │
                                        ├─ Gemini Vision API ────────┐
                                        │                           │
                                        ├─ Product Matching        │
                                        │  ├─ Alias lookup        │
                                        │  └─ Fuzzy match         │
                                        │                          │
                                        ├─ Warning Detection       │
                                        │  ├─ Price bounds        │
                                        │  ├─ Size tokens         │
                                        │  └─ Confidence checks   │
                                        │                          │
                                        └─ Update ReceiptParseJob │
                                           (status=PARSED/       │
                                            NEEDS_REVIEW)         │
```

## Data Flow: Capture to Approval

```
STEP 1: DRIVER CAPTURES RECEIPT
┌─────────────────────────────┐
│ Driver Action               │
│ • Take photo or upload      │
│ • Select store              │
│ • Click "Capture & Parse"   │
└──────────┬──────────────────┘
           │
           ├─→ [Upload to Cloudinary]
           │       ↓
           │   [Get secureUrl]
           │
           ├─→ POST /api/driver/receipt-capture
           │   {
           │     storeId, storeName,
           │     images: [{ url: "https://..." }]
           │   }
           │
           ├─→ ReceiptCapture.create()
           │   status = "pending_parse"
           │
           └─→ matchStoreCandidate()
               │
               ├─ Phone match? → confidence = 0.95
               ├─ Address match? → confidence = 0.9
               ├─ Fuzzy name + city/zip? → confidence = 0.8
               └─ No match? → confidence = 0
                   │
                   └─→ ReceiptParseJob.upsert()
                       storeCandidate = { name, address, phone, confidence }
                       status = "QUEUED"


STEP 2: PARSE (ROUTE or WORKER)
┌──────────────────────────────────┐
│ Sync Route                        │
│ POST /api/driver/receipt-parse    │ OR  │ Background Worker    │
│ (immediate)                       │     │ (if queue enabled)   │
└──────────────┬────────────────────┘     └────────┬─────────────┘
               │                                    │
               └────────┬────────────────────────┬──┘
                        │
                        ├─→ ReceiptCapture.findById(captureId)
                        │
                        ├─→ Gemini Vision API
                        │   "Extract all line items"
                        │   Input: { image, prompt }
                        │   Output: [{ receiptName, quantity, totalPrice }, ...]
                        │
                        ├─→ For each item:
                        │   ├─ Normalize name
                        │   ├─ Try ReceiptNameAlias match
                        │   ├─ Try fuzzy match vs StoreInventory
                        │   ├─ Detect warnings
                        │   │  ├─ Price out of bounds?
                        │   │  ├─ No size token?
                        │   │  ├─ High price variance?
                        │   │  └─ Confidence decay?
                        │   └─ Suggest action:
                        │      ├─ LINK_UPC_TO_PRODUCT
                        │      ├─ CREATE_PRODUCT
                        │      └─ IGNORE
                        │
                        ├─→ ReceiptCapture.markParsed(items)
                        │   status = "parsed"
                        │
                        └─→ upsertReceiptParseJobFromDraft()
                            items = [ { rawLine, nameCandidate, qty, unitPrice, match, warnings } ]
                            status = warnings.length > 0 ? "NEEDS_REVIEW" : "PARSED"


STEP 3: MANAGEMENT REVIEW
┌──────────────────────────────────────┐
│ Manager UI                           │
│ Management → Receipts                │
│                                      │
│ Filter: NEEDS_REVIEW                │
│ List shows:                          │
│ • Store name + confidence            │
│ • Item count + warning count         │
│ • Timestamp                          │
└──────────────┬──────────────────────┘
               │
               ├─→ GET /api/receipt-review/receipts?status=NEEDS_REVIEW
               │   Response: [
               │     {
               │       _id, captureId, status,
               │       storeCandidate: { name, address, phone, confidence, storeId? },
               │       items: [
               │         {
               │           rawLine: "COCA COLA 12PK",
               │           nameCandidate: "coca cola 12 pack",
               │           quantity: 2,
               │           unitPrice: 7.99,
               │           lineTotal: 15.98,
               │           match: { confidence: 0.88, reason: "fuzzy_high" },
               │           warnings: ["price_out_of_bounds"]
               │         }
               │       ],
               │       warnings: ["price_out_of_bounds"]
               │     }
               │   ]
               │
               └─→ Manager clicks "Approve"


STEP 4: APPROVAL & APPLICATION
┌──────────────────────────────────────┐
│ Approval Logic                       │
│ POST /api/receipt-review/receipts/:id/approve       │
└──────────────┬──────────────────────┘
               │
               ├─→ Check authorization (MANAGER/OWNER)
               │
               ├─→ Get ReceiptParseJob
               │
               ├─→ Get or Create Store
               │   ├─ If storeCandidate.storeId exists → use it
               │   ├─ Else → Store.create({
               │   │          name, phone, address,
               │   │          isActive: false,      ← DRAFT
               │   │          createdFrom: "receipt_upload"
               │   │        })
               │   └─ Set finalStoreId
               │
               ├─→ For each item in parseJob.items:
               │   ├─ If match.productId → use existing
               │   ├─ Else → Product.create({
               │   │          name: nameCandidate,
               │   │          price: unitPrice,
               │   │          category: "uncategorized"
               │   │        })
               │   │
               │   └─ StoreInventory.upsert({
               │          storeId: finalStoreId,
               │          productId,
               │          observedPrice: unitPrice,
               │          costPrice: unitPrice,
               │          source: "receipt_upload"
               │        })
               │
               ├─→ Update ReceiptParseJob
               │   status = "APPROVED"
               │   metadata = {
               │     approvedBy: username,
               │     approvedAt: now,
               │     storeId: finalStoreId,
               │     createdProducts: [...],
               │     priceObservations: [...]
               │   }
               │
               ├─→ recordAuditLog({
               │   type: "receipt_approved",
               │   actorId: username,
               │   details: "..."
               │ })
               │
               └─→ UI Toast: "Receipt approved successfully"


STEP 5: RESULT
┌──────────────────────────────────────┐
│ Real Inventory Updated               │
│                                      │
│ ✓ Store created (DRAFT, inactive)   │
│ ✓ Products created for new items     │
│ ✓ StoreInventory prices recorded     │
│ ✓ Audit trail logged                 │
│ ✓ ReceiptParseJob marked APPROVED    │
│                                      │
│ Next: Manager activates store        │
│       Pricing intelligence picks up  │
│       prices for recommendations     │
└──────────────────────────────────────┘
```

## Alternative: Rejection Flow

```
┌──────────────────────────────────┐
│ Manager Review                   │
│ Sees issues or inaccuracies      │
│ Clicks "Reject"                  │
└──────────────┬──────────────────┘
               │
               └─→ POST /api/receipt-review/receipts/:id/reject
                   {
                     reason: "Price too low, likely scanner error"
                   }
                   │
                   ├─→ ReceiptParseJob.status = "REJECTED"
                   │
                   ├─→ metadata = {
                   │   rejectedBy: username,
                   │   rejectedAt: now,
                   │   rejectionReason: "..."
                   │ }
                   │
                   ├─→ recordAuditLog({
                   │   type: "receipt_rejected",
                   │   details: "..."
                   │ })
                   │
                   └─→ [NO CHANGES TO INVENTORY]
                       Receipt just archived for audit trail
```

## Database Schema Relationships

```
ReceiptCapture
├─ _id (PK)
├─ captureRequestId (unique, idempotency key)
├─ storeId → Store
├─ storeName
├─ orderId (optional)
├─ images: [{ url, thumbnailUrl, sequence }]
├─ status: pending_parse | parsing | parsed | failed
├─ draftItems: [{...}]
├─ totalItems, itemsNeedingReview, itemsConfirmed
└─ timestamps

ReceiptParseJob
├─ _id (PK)
├─ captureId → ReceiptCapture (unique index)
├─ status: QUEUED | PARSED | NEEDS_REVIEW | APPROVED | REJECTED
├─ storeCandidate: {
│  ├─ name
│  ├─ address: { street, city, state, zip }
│  ├─ phone
│  ├─ confidence (0..1)
│  └─ storeId → Store (optional)
│ }
├─ items: [{
│  ├─ rawLine (from receipt)
│  ├─ nameCandidate (normalized)
│  ├─ quantity, unitPrice, lineTotal
│  ├─ match: {
│  │  ├─ productId → Product
│  │  ├─ confidence
│  │  └─ reason
│  │ }
│  ├─ actionSuggestion: enum
│  └─ warnings: [string]
│ }]
├─ metadata: {
│  ├─ approvedBy / rejectedBy
│  ├─ approvedAt / rejectedAt
│  ├─ storeId (created/matched during approval)
│  ├─ createdProducts: [{ id, name }]
│  ├─ priceObservations: [{ productId, storeId, price }]
│  └─ rejectionReason
│ }
└─ timestamps (createdAt, updatedAt)

Store
├─ _id (PK)
├─ name (unique)
├─ phone, address
├─ storeType
├─ createdFrom: manual | receipt_upload | admin_script
├─ isActive: boolean  ← DRAFT stores are false
└─ timestamps

Product
├─ _id (PK)
├─ name, price
├─ category, brand, productType
├─ createdFrom: manual | inventory_create | receipt_upload
└─ timestamps

StoreInventory
├─ storeId → Store (compound index)
├─ productId → Product (compound index)
├─ observedPrice (from receipts/observations)
├─ costPrice
├─ source: manual | receipt_upload
└─ lastUpdated

AuditLog
├─ type: receipt_* events
├─ actorId: username
├─ details
├─ createdAt (indexed)
└─ immutable
```

## State Machine: ReceiptParseJob Status

```
                    ┌──────────────┐
                    │   QUEUED     │  (initial, from receipt-capture)
                    └──────┬───────┘
                           │
                    POST /receipt-parse
                    or worker job
                           │
                           ↓
                    ┌──────────────┐
                    │   PARSED     │  (no warnings/all matched)
                    └──────┬───────┘
                           │
                    Gemini returns
                    with items
                           │
                           ├─ warnings? ──yes──→ NEEDS_REVIEW
                           │
                           └─ no ───────────→ PARSED
                                             (auto-approvable future)


                    ┌────────────────┐
                    │  NEEDS_REVIEW  │  (warnings present)
                    └────────┬───────┘
                             │
                    Manager reviews
                             │
                    ┌────────┴────────┐
                    │                 │
              Approve           Reject
                    │                 │
                    ↓                 ↓
          ┌──────────────┐   ┌──────────────┐
          │  APPROVED    │   │  REJECTED    │
          └──────────────┘   └──────────────┘
            (apply changes)    (archive only)
```

## Error Handling Flow

```
Gemini API Error
    │
    ├─ 429 (rate limit)
    │  └─ ReceiptCapture.status = "requires_retry"
    │     Caller retries in 30s
    │
    ├─ Timeout / connection
    │  └─ Same as 429 (transient)
    │
    └─ Permanent error
       └─ ReceiptCapture.status = "failed"
          parseError = error.message
          ReceiptParseJob not created
          Manual intervention needed

Store Matching Error
    ├─ No match found
    │  └─ storeCandidate.storeId = null
    │     confidence < threshold
    │     Mark as NEEDS_REVIEW
    │
    └─ Multiple matches
       └─ Pick highest confidence
          Warn manager for verification

Product Creation Failure
    ├─ On approval, if Product.create() fails
    │  └─ Log error, continue with next item
    │     metadata.errors recorded
    │
    └─ Partial success acceptable
       (manager can retry/fix manually)
```

## Concurrency & Idempotency

```
Idempotency: captureRequestId
    │
    ├─ Driver sends POST /receipt-capture with UUID
    │  └─ Backend checks existing ReceiptCapture.findOne({ captureRequestId })
    │     If found → return existing capture (no duplicate)
    │     If not → create new
    │
    └─ Duplicate prevention across retries


Transactions: upsertReceiptParseJobFromDraft()
    │
    └─ Atomic: either full update or rollback
       No partial states


Worker Retries: BullMQ exponential backoff
    │
    ├─ Attempt 1: immediate
    ├─ Attempt 2: wait 2s
    ├─ Attempt 3: wait 4s
    │
    └─ On final failure: mark capture.status = "failed"
```

---

This architecture ensures:
✓ No mutations without approval
✓ Deterministic store/product matching
✓ Full audit trail
✓ Robust error handling
✓ Worker support for async
✓ Idempotent operations
