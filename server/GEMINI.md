# NinpoSnacks Backend – SKU, UPC, Inventory Rules

## Scope

This file documents backend enforcement, data model, and API contract. For all roles, permissions, scanner modes, and domain terms, see [GLOSSARY.md](../GLOSSARY.md). For system philosophy, see [GEMINI.md](../GEMINI.md). For UI/UX, see [src/GEMINI.md](../src/GEMINI.md).

---

## Data models
### Product
- Must contain:
  - `sku` (string, unique, indexed) — NP-000001 format
  - `name`, `price`, `deposit`, `stock`, `sizeOz`, etc.
  - Storage fields: `brand`, `productType`, `storageZone`, `storageBin`
- `sku` is the lookup key for inventory operations.

### Counter (atomic)
- Collection: `counters`
- Document example:
  - `{ _id: "productSku", seq: 123 }`
- SKU generator must:
  - `findOneAndUpdate` with `$inc` and `{ upsert: true, new: true }`
  - format to `NP-${seq.padStart(6,"0")}`

### UpcItem (UPC mapping + deposit metadata)
- `upc` unique.
- `sku` optional index:
  - If set, it maps UPC to Product.sku.
- Other fields store deposit/eligibility metadata.

## Endpoints
### POST /api/upc/scan
Contract:
- Input: `{ upc: string, qty?: number }`
- Flow:
  1) normalize UPC (digits only, trim)
  2) find UpcItem by upc
  3) if UpcItem.sku exists:
     - increment Product.stock by qty
     - return `{ action: "updated", product }`
  4) else:
     - return `{ action: "unmapped", upc, upcEntry }`
- Do not create products silently on scan unless explicitly chosen by operator via unmapped flow.

### POST /api/upc (upsert whitelist)
- Allows saving deposit metadata and optional sku mapping.
- Must not break scan flow.

## SKU migration + compatibility
- Existing products may have legacy `frontendId` or `_id`.
- For existing rows:
  - if `sku` missing, populate via migration script.
  - keep legacy identifiers only for internal references; operators see SKU.

## Settings
- Persist AppSettings fields for:
  - scanner and inventory behavior
  - configurable storage lists (zones/types/etc.)
- Backend must validate that selected `storageZone` etc. are in allowed lists (or allow freeform with warnings—choose one approach and stick to it).

## Guardrails
- Server computes authoritative inventory changes.
- Do not accept client-provided SKU generation.
- Ensure uniqueness at Mongo layer + handle duplicate key errors gracefully.


### Receipt approval CREATE_PRODUCT (UPC optional)
- During receipt approval, `CREATE_PRODUCT` must not require UPC.
- Product resolution order is: `boundProductId`/`suggestedProduct` -> UPC registry mapping (only if UPC present) -> normalized-name lookup -> create receipt stub product.
- Receipt stub creation must initialize `frontendId`, `sku` (via atomic counter), and required `price`.
- If UPC is present, linking via `UpcItem` remains a separate optional step.
