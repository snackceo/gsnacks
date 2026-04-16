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
POST /api/receipts/:jobId/reject
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