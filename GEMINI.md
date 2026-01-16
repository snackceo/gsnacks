# NinpoSnacks — GEMINI System Contract (Authoritative)

## Scope

This file defines the system philosophy, contract, and non-negotiable rules for all AI-assisted and future development. For all roles, permissions, scanner modes, and domain terms, see [GLOSSARY.md](GLOSSARY.md). Backend and UI contracts are detailed in [server/GEMINI.md](server/GEMINI.md) and [src/GEMINI.md](src/GEMINI.md).

---

> This file is the **source-of-truth contract** for AI-assisted changes and future development.
> If code behavior conflicts with this document, the code is wrong.

---

## 0. Ground Rules (Non‑Negotiable)

* **Do not guess.** If behavior is unclear, locate the existing implementation and extend it.
* **Full file replacements only** when editing code, unless explicitly requested otherwise.
* **Backend is authoritative** for money, inventory, SKU identity, and scan resolution.
* UI may estimate or preview, but the server decides final state.

---

## 1. Product Identity (Authoritative)

### 1.1 SKU

* `sku` is the **only business identifier** for products.
* Format: `NP-000001` (prefix `NP-`, 6‑digit zero‑padded sequence).
* SKUs are **immutable** once assigned.
* SKUs are **generated server‑side only**.

Legacy identifiers:

* Mongo `_id` = persistence identifier (never shown to operators).
* `frontendId` exists **only for backward compatibility**.
* Operator UI must display and reference **SKU**, not legacy IDs.

### 1.2 SKU Generation

* SKUs are generated using an **atomic MongoDB counter**.
* Implementation:

  * `findOneAndUpdate` with `$inc` and `{ upsert: true, new: true }`.
  * Counter key: `productSku`.
* SKUs are never reused, even if products are deleted.
* Client‑side SKU generation is forbidden.

---

## 2. UPC Registry (Single Source of Truth)

### 2.1 Purpose

There is **one UPC registry**.
It serves two roles simultaneously:

1. **UPC → SKU mapping** (inventory resolution)
2. **Deposit eligibility metadata** (MI 10¢ program)

There must never be a second UPC table.

### 2.2 Data Model (Conceptual)

* `upc` (string, digits only, unique)
* `sku` (optional; links UPC to Product.sku)
* Deposit metadata:

  * `isEligible`
  * `containerType` (`glass | plastic | aluminum`)
  * `sizeOz`
  * `price`

### 2.3 Scan Resolution Rule (Mandatory)

```
UPC → UPC Registry → SKU → Product → Action
```

* UPCs **never** resolve directly to products.
* If no SKU mapping exists:

  * the system must surface an **explicit Unmapped UPC state**.
  * silent fallback is forbidden.

---

## 3. Scanner System (One Scanner, Many Modes)

### 3.1 Single Scanner Component

* There is **one shared ScannerModal** across the entire system.
* ScannerModal responsibilities:

  * camera lifecycle
  * barcode detection
  * UPC normalization (digits only)
  * cooldown / dedup logic
  * beep + visual feedback
  * `onScan(upc)` callback

ScannerModal must **not**:

* mutate inventory
* create products
* decide business logic

### 3.2 Scanner Modes

Scanner behavior after a scan is determined by **mode**, not by separate scanners.

Supported modes:

* **Mode A — Inventory Add Stock (Receiving)**
* **Mode B — Inventory Count / Audit**
* **Mode C — Returns Intake (Driver / Warehouse)**
* **Mode D — Pick / Pack Orders (optional, future)**

Management‑only auxiliary flow:

* **UPC Registry Maintenance** (still uses the same ScannerModal)

Modes must be explicit. Using ad‑hoc strings or `as any` is forbidden.

---

## 4. Scanning UX Invariants (Must Not Drift)

### 4.1 One Scan = One Action

* Every scan produces:

  * a beep
  * a visible result
  * a recorded outcome

### 4.2 Cooldown / Duplicate Handling

* Duplicate scans within cooldown **must not be silently ignored**.
* If blocked:

  * show a toast (e.g. `Same UPC — tap to add again`).
* Blocking still counts as an action.

### 4.3 Always Show What Was Detected

After each scan, the UI must display:

* UPC digits
* matched product name (if mapped)
* SKU
* storage location (zone / bin)
* a confidence or fallback message

### 4.4 Unmapped UPC Handling

If a UPC cannot be resolved:

* Show an **Unmapped UPC screen** with exactly two actions:

  1. **Create new product with this UPC**
  2. **Attach UPC to existing SKU** (search by SKU or name)

Automatic creation without operator intent is forbidden.

---

## 5. Inventory & Audits

### 5.1 Inventory Mutations

* Inventory changes are **server‑side only**.
* Primary scan endpoint:

  * `POST /api/upc/scan`
* Behavior:

  * mapped UPC → increment Product.stock
  * unmapped UPC → return `action: unmapped`

### 5.2 Inventory Audits

* Audits are **separate from live inventory**.
* Audit records:

  * reference Product by ObjectId (persistence)
  * display SKU to operators (business identity)
* Audit sessions are applied only when explicitly finalized.

---

## 6. Storage Grouping (Shelf Organization)

Products support storage metadata:

* `brand`
* `productType`
* `storageZone`
* `storageBin`

Management lists must group and sort:

```
storageZone → brand → productType → SKU
```

These fields are operator‑facing and configurable.

---

## 7. AppSettings (Configurable Behavior)

### 7.1 Scanner Configuration

Stored in AppSettings:

* `defaultIncrement`
* `cooldownMs`
* `requireSkuForScanning`
* `scanningModesEnabled.{A|B|C|D}`

### 7.2 Inventory Configuration

* `shelfGroupingEnabled`

### 7.3 Storage Lists

* `storageZones`
* `productTypes`

AppSettings **schema is authoritative**.
Routes must be updated when new fields are added.

---

## 8. Role‑Specific Scan Flows

### 8.1 Management

* Uses Mode A and Mode B.
* UPC Registry maintenance uses the same scanner.
* Operators may map UPCs to SKUs and edit deposit metadata.

### 8.2 Driver

* Uses Mode C.
* Focused on return verification and eligibility.
* Identity verification gates are workflow rules, not scanner rules.

### 8.3 Customer

* Uses the same scanner UX.
* Scans add UPCs to a return list.
* Eligibility and estimated credit are shown immediately.
* Customer scans never mutate inventory directly.

---

## 9. Terminology Lock

Use these exact terms:

* SKU (never “Product ID”)
* UPC Registry (internal; UI label may differ)
* Scanner Mode A/B/C/D
* Inventory Audit

Forbidden drift terms:

* duplicate scanners
* product‑id (for business identity)
* silent scan ignore

---

## 10. Enforcement Principle

This file exists to prevent system drift.

If a future change introduces:

* a second scanner
* a second UPC table
* client‑generated SKUs
* silent scan failures

…the change is invalid and must be rejected.
