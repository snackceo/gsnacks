# Receipt API Matrix (Updated)

## Purpose

Defines all receipt-related endpoints grouped by domain, ownership, and lifecycle status.

---

## Domains

- Capture → image ingestion & lifecycle
- Parse → OCR + extraction
- Review → human validation + approval
- Rules → aliases, noise filtering
- Pricing → item updates & corrections
- Analytics → summaries & history
- System → health & admin

---

## Endpoint Matrix

| Endpoint | Domain | Purpose | Owner | Status |
|----------|--------|--------|------|--------|
| POST /api/driver/receipt-capture | Capture | Create receipt capture | capture.routes.js | Active |
| GET /api/driver/receipt-capture/:captureId | Capture | Fetch capture | capture.routes.js | Active |
| POST /api/driver/receipt-capture/:captureId/expire | Capture | Expire capture | capture.routes.js | Active |
| GET /api/driver/receipt-capture/:captureId/items | Capture | Get parsed items | capture.routes.js | Active |
| POST /api/driver/upload-receipt-image | Capture | Upload receipt image | capture.routes.js | Active |
| POST /api/driver/receipt-parse | Parse | Trigger parse | parse.routes.js | Active |
| POST /api/driver/receipt-parse-frame | Parse | Parse single frame | parse.routes.js | Active |
| POST /api/driver/receipt-parse-live | Parse | Live parsing | parse.routes.js | Active |
| GET /api/receipts | Review | List parse jobs | review.routes.js | Canonical |
| GET /api/receipts/:jobId | Review | Job detail | review.routes.js | Canonical |
| POST /api/receipts/:jobId/approve | Review | Approve job | review.routes.js | Canonical |
| POST /api/receipts/:jobId/reject | Review | Reject job | review.routes.js | Canonical |
| DELETE /api/receipts/:captureId | Review | Delete job | review.routes.js | Active |
| POST /api/receipts/cleanup-queue | System | Cleanup jobs | admin.routes.js | Admin |
| GET /api/driver/receipt-aliases | Rules | List aliases | rules.routes.js | Active |
| POST /api/driver/receipt-alias | Rules | Create alias | rules.routes.js | Active |
| GET /api/driver/receipt-noise-rules | Rules | List noise rules | rules.routes.js | Active |
| POST /api/driver/receipt-noise-rule | Rules | Create noise rule | rules.routes.js | Active |
| DELETE /api/driver/receipt-noise-rule | Rules | Delete noise rule | rules.routes.js | Active |
| POST /api/driver/receipt-noise-rule/ignore | Rules | Ignore noise | rules.routes.js | Active |
| DELETE /api/driver/receipt-noise-rule/ignore | Rules | Remove ignore | rules.routes.js | Active |
| GET /api/driver/receipt-items/:storeId | Pricing | Store items | pricing.routes.js | Active |
| GET /api/driver/receipt-item-history | Analytics | Price history | analytics.routes.js | Active |
| POST /api/driver/receipt-price-update-manual | Pricing | Manual update | pricing.routes.js | Deprecated |
| POST /api/driver/receipt-fix-price | Pricing | Fix price | pricing.routes.js | Active |
| POST /api/driver/receipt-fix-upc | Pricing | Fix UPC | pricing.routes.js | Active |
| GET /api/driver/receipt-store-summary | Analytics | Store metrics | analytics.routes.js | Active |
| GET /api/driver/receipt-captures-summary | Analytics | Capture stats | analytics.routes.js | Active |
| POST /api/driver/receipt-refresh | System | Refresh metadata | admin.routes.js | Active |
| GET /api/driver/receipt-health | System | Health check | admin.routes.js | Active |

---

## Deprecations

- /api/driver/receipt-parse-jobs/* → replaced by /api/receipts/*
- /api/driver/receipt-price-update-manual → migrate to approval flow

**Sunset Target:** 2026-09-30

---

## Rules

- Each domain owns its own route file
- Controllers must not contain business logic
- Services handle all DB access
- Legacy endpoints must be removed after sunset
