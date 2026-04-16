# API Endpoints

## Auth

POST /api/auth/login  
POST /api/auth/register  

---

## Users

GET /api/users/me  

---

## Orders

POST /api/orders  
GET /api/orders/:id  

---

## Receipts & Scanning

POST /api/driver/upload-receipt-image
POST /api/driver/receipt-capture
POST /api/driver/receipt-parse
GET /api/driver/receipt-capture/:captureId
GET /api/driver/receipt-captures-summary
GET /api/driver/receipt-health

---

## Receipt Management

GET /api/receipts
GET /api/receipts/:jobId
POST /api/receipts/:jobId/approve

#### POST /api/receipts/:jobId/approve

Approves a parsed receipt job and commits its items to inventory and pricing data. This is the final, authoritative step in the receipt review workflow.

**Authorization:** `OWNER` or `MANAGER`

**URL Parameters:**
- `jobId` (string, required): The ID of the `ReceiptParseJob` to approve.

**Request Body:**

The request body must be a `ReceiptApprovePayload` object, which contains the operator's decisions for each line item.

*Example Request:*
```json
{
  "mode": "selected",
  "approvalDraft": {
    "jobId": "60d5f1b3e6b3f1b3e6b3f1b3",
    "captureId": "60d5f1b3e6b3f1b3e6b3f1b4",
    "finalStoreMode": "MATCHED",
    "finalStoreId": "5fabea7b4b3f1a001f3e8b4a",
    "items": [
      {
        "lineIndex": 0,
        "action": "LINK_UPC_TO_PRODUCT",
        "productId": "NP-000123"
      },
      {
        "lineIndex": 1,
        "action": "CREATE_PRODUCT",
        "createProduct": {
          "name": "New Snack Item",
          "price": 4.99,
          "category": "Snacks"
        }
      }
    ]
  },
  "selectedIndices":
}
```

**Responses:**

- **200 OK:** The job was successfully approved. The response body will contain the updated `job`, `capture`, and `store` objects.
- **400 Bad Request:** The request was malformed (e.g., missing required fields).
- **404 Not Found:** The specified `jobId` or `captureId` does not exist.
- **500 Internal Server Error:** An unexpected error occurred during processing.

POST /api/receipts/:jobId/reject

#### POST /api/receipts/:jobId/reject

Rejects a parsed receipt job, moving it to a final `REJECTED` state. This action is typically used for duplicate, fraudulent, or unreadable receipts.

**Authorization:** `OWNER` or `MANAGER`

**URL Parameters:**
- `jobId` (string, required): The ID of the `ReceiptParseJob` to reject.

**Request Body:**

*Example Request:*
```json
{
  "reason": "Duplicate receipt, already processed under capture ID xyz."
}
```

**Responses:**
- **200 OK:** The job was successfully rejected.
- **400 Bad Request:** The `reason` field is missing or empty.
- **404 Not Found:** The specified `jobId` does not exist.

DELETE /api/receipts/:captureId

---

## UPC & Eligibility

GET /api/upc/eligibility
POST /api/upc/eligibility
GET /api/upc/off/:code
POST /api/upc/scan

---

## Response Format

{
  success: boolean,
  data: any,
  error?: string
}