# Maintenance Runbook

> **Canonical Source (MAINTENANCE):** This file is the operational source for routine maintenance procedures and remediation scripts.

## Incident triage verification (receipt approvals)

When investigating receipt approval anomalies, verify all three signals together:

1. **UI body mode** (`safe`, `selected`, `locked`, `all`) used in management receipt flow.
2. **API build id** from `POST /api/receipts/:jobId/approve` (`backendBuildId` in response).
3. **Audit line** for `receipt_approved` includes the same `backendBuildId`.

## Receipt queue cleanup (stale jobs)

Use when BullMQ retains `receipt-parse` jobs that reference missing `ReceiptCapture` records.

```bash
cd server
npm run cleanup-receipt-queue
```

Optional filters:

```bash
npm run cleanup-receipt-queue -- --capture-id <captureId>
npm run cleanup-receipt-queue -- --dry-run
```

Admin API alternative:

```text
POST /api/receipts/cleanup-queue
```

Body options:
- `captureIds` (optional array)
- `dryRun` (boolean)

Monitoring endpoint:

```text
GET /api/driver/receipt-health
```

Track `staleReceiptJobs` and alert if stale count is non-zero.

## Store normalization backfill

Normalizes `storeNumber` and `phoneNormalized` on Store records.

Dry run:

```bash
cd server
npm run backfill-store-normalization -- --dry-run
```

Apply:

```bash
npm run backfill-store-normalization
```

Only fill missing fields:

```bash
npm run backfill-store-normalization -- --only-missing
```

## Store inventory index rebuild

Use after index definition changes for StoreInventory (`productId`, `unmappedProductId`, `observedAt`).

```bash
cd server
npm run rebuild-store-inventory-indexes
```
