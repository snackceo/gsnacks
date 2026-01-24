# Receipt Review System - Quick Start Guide

## For Managers: Reviewing Receipts

### Access Receipt Reviews
1. In Management Dashboard, click **Receipts** in the sidebar
2. Filter by status:
   - **NEEDS_REVIEW**: Items with warnings or unmatched products
   - **PARSED**: Successfully parsed, ready for approval
   - **APPROVED**: Already approved and applied
   - **REJECTED**: Rejected (not applied)

### Review a Receipt
1. Click a receipt in the list to expand details
2. View:
   - **Store Candidate**: Matched/proposed store with confidence % and address/phone
   - **Line Items**: Each receipt item with:
     - Raw name from receipt
     - Normalized name for matching
     - Quantity, unit price, total
     - Match confidence and reason (if linked to existing product)
     - Warnings (e.g., price out of bounds, no size info)

### Approve a Receipt
1. Review store and items
2. Click **Approve** button
3. System will:
   - Create store if missing (status=DRAFT, needs manual activation)
   - Create products for unmatched items
   - Emit price observations to store inventory
   - Mark as APPROVED
   - Log audit trail

### Reject a Receipt
1. Click **Reject** button
2. No changes applied to inventory/products
3. Receipt marked as REJECTED
4. Logged in audit trail

## For Drivers: Capturing Receipts

### Capture a Receipt
1. In Receipts section, take a photo of the receipt
2. Select store first (required)
3. Tap **Capture & Parse**
4. System will:
   - Upload image to Cloudinary
   - Create receipt capture record
   - Trigger Gemini parsing
   - Generate ReceiptParseJob proposal
   - Show toast with status

### Monitor Parse Status
- Refresh the Receipts list
- New receipts appear with items count
- If parsing failed, status shows in list

## API Reference for Developers

### Create Capture
```bash
POST /api/driver/receipt-capture
Content-Type: application/json

{
  "storeId": "store_id_here",
  "storeName": "Store Name",
  "captureRequestId": "unique-uuid",
  "images": [
    {
      "url": "https://res.cloudinary.com/...",
      "thumbnailUrl": "https://res.cloudinary.com/...",
      "mime": "image/jpeg"
    }
  ]
}
```

Response:
```json
{
  "ok": true,
  "captureId": "capture_id_here",
  "status": "pending_parse",
  "imageCount": 1
}
```

### Trigger Parse
```bash
POST /api/driver/receipt-parse
Content-Type: application/json

{
  "captureId": "capture_id_here"
}
```

Response:
```json
{
  "ok": true,
  "queued": true,
  "jobId": "job_id"
}
```

### List Drafts for Review
```bash
GET /api/receipt-review/receipts?status=NEEDS_REVIEW
```

Response:
```json
{
  "ok": true,
  "jobs": [
    {
      "_id": "job_id",
      "captureId": "capture_id",
      "status": "NEEDS_REVIEW",
      "storeCandidate": {
        "name": "Walmart #1234",
        "address": { "street": "123 Main", "city": "Dearborn", "state": "MI", "zip": "48126" },
        "phone": "3135551234",
        "confidence": 0.95
      },
      "items": [
        {
          "rawLine": "COCA COLA 12PK",
          "nameCandidate": "coca cola 12 pack",
          "quantity": 2,
          "unitPrice": 7.99,
          "lineTotal": 15.98,
          "match": { "confidence": 0.88, "reason": "fuzzy_high" },
          "warnings": ["price_out_of_bounds"]
        }
      ],
      "warnings": ["price_out_of_bounds"],
      "createdAt": "2026-01-24T14:30:00Z"
    }
  ]
}
```

### Get Receipt Detail
```bash
GET /api/receipt-review/receipts/:id
```

### Approve Receipt
```bash
POST /api/receipt-review/receipts/:id/approve
Content-Type: application/json

{
  "storeCandidate": {
    "name": "Walmart #1234",
    "address": { "street": "123 Main", "city": "Dearborn", "state": "MI", "zip": "48126" },
    "phone": "3135551234"
  },
  "items": [ ... ]
}
```

Response:
```json
{
  "ok": true,
  "job": {
    "_id": "job_id",
    "status": "APPROVED",
    "metadata": {
      "approvedBy": "manager_username",
      "approvedAt": "2026-01-24T14:35:00Z",
      "storeId": "newly_created_store_id",
      "createdProducts": [
        { "id": "product_id", "name": "COCA COLA 12PK" }
      ],
      "priceObservations": [
        { "productId": "...", "storeId": "...", "price": 7.99 }
      ]
    }
  }
}
```

### Reject Receipt
```bash
POST /api/receipt-review/receipts/:id/reject
Content-Type: application/json

{
  "reason": "Price too low, likely error"
}
```

## Data Flow Diagram

```
Driver captures receipt photo
         ↓
   [Cloudinary Upload]
         ↓
POST /api/driver/receipt-capture
         ↓
  ReceiptCapture created
  ReceiptParseJob initialized
         ↓
POST /api/driver/receipt-parse
         ↓
   [Gemini Vision API]
   Extract items, store address
         ↓
  Match products (alias, fuzzy)
  Detect warnings (price, size, etc.)
         ↓
  upsertReceiptParseJobFromDraft()
  Status: NEEDS_REVIEW (if warnings)
         ↓
Manager reviews in UI
   GET /api/receipt-review/receipts
         ↓
Manager clicks Approve/Reject
         ↓
POST /api/receipt-review/receipts/:id/approve
         ↓
Auto-create store (DRAFT)
Auto-create products
Emit StoreInventory price observations
Audit log
         ↓
[Real inventory data applied]
```

## Troubleshooting

### Receipt doesn't appear in NEEDS_REVIEW
1. Check if capture was created: `/api/driver/receipt-capture/:captureId`
2. Check parse status: see receipt-capture `status` field
3. Check Gemini API key is set: `GEMINI_API_KEY`
4. Check logs for parse errors

### Store not matched
1. Review store address/phone from receipt
2. Check existing stores in database
3. Store will be created as DRAFT during approval

### Items not matching products
1. Product names must be similar (Levenshtein distance < 0.25 normalized)
2. Aliases help: confirm a mapping in UPC registry to boost confidence
3. New products will be created for unmatched items on approval

### Need to activate a draft store
After approval, navigate to Stores management and toggle `isActive` to enable ordering.
