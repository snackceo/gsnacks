# Receipt API Matrix

This matrix maps receipt endpoints to ownership boundaries.

## Current Canonical Boundaries

| Endpoint | Purpose | Owner route file |
|---|---|---|
| `GET /api/driver/receipt-settings` | Read receipt ingestion/settings flags for operators. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-settings` | Update receipt ingestion/settings flags. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-store-candidates` | List store candidates from receipt matching pipeline. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-store-candidates` | Upsert store candidate metadata. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-noise-rule` | Create receipt OCR noise rule. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-noise-rule` | Fetch one receipt noise rule. | `server/routes/receipt-prices.js` |
| `DELETE /api/driver/receipt-noise-rule` | Delete receipt noise rule. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-aliases` | List receipt aliases for matching. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-noise-rules` | List receipt noise rules. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-alias` | Create receipt alias binding. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-noise-rule/ignore` | Ignore a noisy token/rule. | `server/routes/receipt-prices.js` |
| `DELETE /api/driver/receipt-noise-rule/ignore` | Remove ignored noise rule entry. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-upload` | Legacy combined upload/parse path. | `server/routes/receipt-prices.js` |
| `POST /api/driver/upload-receipt-image` | Upload receipt image and return hosted URLs. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-capture` | Create `ReceiptCapture` before parse trigger. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-capture/:captureId` | Fetch receipt capture by ID. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-parse` | Trigger parse for capture (`capture -> parse` invariant). | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-parse-frame` | Parse single frame from live capture. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-parse-live` | Parse from continuous live capture flow. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-parse-jobs` | Legacy parse-job listing endpoint. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-parse-jobs/:captureId/approve` | Legacy approve by capture ID. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-parse-jobs/:captureId/reject` | Legacy reject by capture ID. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-items/:storeId` | List receipt-derived items by store. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-item-history` | Receipt item price history query. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-price-update-manual` | Manual receipt item ingestion/update (legacy/manual flow). | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-captures-summary` | Summary counts for dashboard stats. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-refresh` | Refresh receipt-derived pricing/inventory metadata. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-lock` | Lock capture review edits. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-unlock` | Unlock capture review edits. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-store-summary` | Store-level receipt metrics summary. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-fix-upc` | Patch UPC mapping from receipt workflow. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-fix-price` | Patch price from receipt workflow. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-reset-review` | Reset capture review state. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-capture/:captureId/items` | Read normalized parsed items for capture. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-capture/:captureId/expire` | Expire capture/review lifecycle state. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-store-aliases` | List store alias mappings. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-alias-history` | Receipt alias change history. | `server/routes/receipt-prices.js` |
| `GET /api/driver/receipt-health` | Receipt parser/queue health status. | `server/routes/receipt-prices.js` |
| `POST /api/driver/receipt-confirm-match` | Confirm receipt-name to SKU mapping. | `server/routes/receipt-prices.js` |
| `GET /api/receipts` | Canonical parse-job queue listing. | `server/routes/receipts.js` |
| `GET /api/receipts/:jobId` | Canonical parse-job detail. | `server/routes/receipts.js` |
| `POST /api/receipts/:jobId/approve` | Canonical approval endpoint. | `server/routes/receipts.js` |
| `POST /api/receipts/:jobId/reject` | Canonical reject endpoint. | `server/routes/receipts.js` |
| `DELETE /api/receipts/:captureId` | Delete capture + parse job records. | `server/routes/receipts.js` |
| `POST /api/receipts/cleanup-queue` | Admin cleanup for stale queue jobs. | `server/routes/receipts.js` |

## Deprecations + Sunset Plan

- **Legacy approval routes** (`/api/driver/receipt-parse-jobs/:captureId/approve|reject`) are deprecated in favor of `/api/receipts/:jobId/approve|reject`.
- **Legacy/manual ingestion alias** (frontend alias to `/api/driver/receipt-price-update-manual`) should be removed after migration to canonical review approval flow.
- **Target sunset date:** **2026-09-30**.
- **Sunset gate:** remove legacy endpoints only after dashboard callers and operator runbooks no longer reference them.
