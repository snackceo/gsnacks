# Receipt API Matrix (Finalized)

## Purpose

Complete, enforceable map of all receipt-related endpoints, grouped by domain, ownership, access, and lifecycle status.

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

## Lifecycle Flow

1. Capture created
2. Image uploaded
3. Parse triggered
4. Review decision (approve/reject)
5. Pricing updated
6. Analytics updated

---

## Endpoint Matrix

| Endpoint | Domain | Purpose | Owner | Access | Status |
|----------|--------|--------|------|--------|--------|

### Capture
| POST /api/driver/receipt-capture | Capture | Create receipt capture | capture.routes.js | Driver | Active |
| GET /api/driver/receipt-capture/:captureId | Capture | Fetch capture | capture.routes.js | Driver | Active |
| POST /api/driver/receipt-capture/:captureId/expire | Capture | Expire capture | capture.routes.js | Driver | Active |
| GET /api/driver/receipt-capture/:captureId/items | Capture | Get parsed items | capture.routes.js | Driver | Active |
| POST /api/driver/upload-receipt-image | Capture | Upload receipt image | capture.routes.js | Driver | Active |

### Parse
| POST /api/driver/receipt-parse | Parse | Trigger parse | parse.routes.js | Driver | Active |
| POST /api/driver/receipt-parse-frame | Parse | Parse single frame | parse.routes.js | Driver | Active |
| POST /api/driver/receipt-parse-live | Parse | Live parsing | parse.routes.js | Driver | Active |
| GET /api/driver/receipt-parse-jobs | Parse | Legacy parse jobs | parse.routes.js | Driver | Deprecated |
| POST /api/driver/receipt-parse-jobs/:captureId/approve | Parse | Legacy approve | parse.routes.js | Driver | Deprecated |
| POST /api/driver/receipt-parse-jobs/:captureId/reject | Parse | Legacy reject | parse.routes.js | Driver | Deprecated |

### Review (Canonical)
| GET /api/receipts | Review | List parse jobs | review.routes.js | Admin | Canonical |
| GET /api/receipts/:jobId | Review | Job detail | review.routes.js | Admin | Canonical |
| POST /api/receipts/:jobId/approve | Review | Approve job | review.routes.js | Admin | Canonical |
| POST /api/receipts/:jobId/reject | Review | Reject job | review.routes.js | Admin | Canonical |
| DELETE /api/receipts/:captureId | Review | Delete job | review.routes.js | Admin | Active |
| POST /api/driver/receipt-lock | Review | Lock review | review.routes.js | Admin | Active |
| POST /api/driver/receipt-unlock | Review | Unlock review | review.routes.js | Admin | Active |
| POST /api/driver/receipt-reset-review | Review | Reset review | review.routes.js | Admin | Active |
| POST /api/driver/receipt-confirm-match | Review | Confirm mapping | review.routes.js | Admin | Active |

### Rules
| GET /api/driver/receipt-aliases | Rules | List aliases | rules.routes.js | Driver | Active |
| POST /api/driver/receipt-alias | Rules | Create alias | rules.routes.js | Driver | Active |
| GET /api/driver/receipt-alias-history | Rules | Alias history | rules.routes.js | Admin | Active |
| GET /api/driver/receipt-store-aliases | Rules | Store aliases | rules.routes.js | Driver | Active |
| GET /api/driver/receipt-noise-rules | Rules | List noise rules | rules.routes.js | Driver | Active |
| POST /api/driver/receipt-noise-rule | Rules | Create noise rule | rules.routes.js | Driver | Active |
| DELETE /api/driver/receipt-noise-rule | Rules | Delete noise rule | rules.routes.js | Driver | Active |
| POST /api/driver/receipt-noise-rule/ignore | Rules | Ignore noise | rules.routes.js | Driver | Active |
| DELETE /api/driver/receipt-noise-rule/ignore | Rules | Remove ignore | rules.routes.js | Driver | Active |

### Pricing
| GET /api/driver/receipt-items/:storeId | Pricing | Store items | pricing.routes.js | Driver | Active |
| POST /api/driver/receipt-price-update-manual | Pricing | Manual update | pricing.routes.js | Driver | Deprecated |
| POST /api/driver/receipt-fix-price | Pricing | Fix price | pricing.routes.js | Driver | Active |
| POST /api/driver/receipt-fix-upc | Pricing | Fix UPC | pricing.routes.js | Driver | Active |
| POST /api/driver/receipt-refresh | Pricing | Refresh pricing | pricing.routes.js | Admin | Active |

### Analytics
| GET /api/driver/receipt-item-history | Analytics | Price history | analytics.routes.js | Driver | Active |
| GET /api/driver/receipt-store-summary | Analytics | Store metrics | analytics.routes.js | Driver | Active |
| GET /api/driver/receipt-captures-summary | Analytics | Capture stats | analytics.routes.js | Driver | Active |

### System / Admin
| GET /api/driver/receipt-settings | System | Get settings | admin.routes.js | Admin | Active |
| POST /api/driver/receipt-settings | System | Update settings | admin.routes.js | Admin | Active |
| GET /api/driver/receipt-store-candidates | System | Store candidates | admin.routes.js | Admin | Active |
| POST /api/driver/receipt-store-candidates | System | Upsert candidates | admin.routes.js | Admin | Active |
| GET /api/driver/receipt-health | System | Health check | admin.routes.js | Admin | Active |
| POST /api/receipts/cleanup-queue | System | Cleanup jobs | admin.routes.js | Admin | Active |

---

## Deprecations

- `/api/driver/receipt-parse-jobs/*` → replaced by `/api/receipts/*`
- `/api/driver/receipt-price-update-manual` → migrate to approval flow

**Sunset Target:** 2026-09-30

---

## Rules

- Each domain owns its own route file
- Controllers must not contain business logic
- Services handle all DB access
- All endpoints must be listed here
- PRs adding endpoints must update this file
- Legacy endpoints must be removed after sunset