---

## 12. Loyalty Points & Credits (Authoritative)

### Loyalty Points

- Earned on product spend only
- Used for purchases per tier rules
- Only credits originating from bottle returns are eligible for cash payout

### Additional Safety Clause

- The system must track credit origin (RETURN vs POINTS vs MANUAL) to enforce payout eligibility.
This file defines the centralized system philosophy, contract, and non-negotiable rules for all AI-assisted and future development. For all roles, permissions, scanner modes, and domain terms, see [GLOSSARY.md](GLOSSARY.md). Backend and UI contracts are centralized in this root document.

---

## Receipt Price Intelligence (Unmapped Products + Price Observations)

- Receipt commits must create price observations for matched products and for unmatched items.
- Unmatched receipt lines are tracked as UnmappedProduct entries (unique per store + normalized name) so operators can review, map, or ignore them later.
- Mapping an UnmappedProduct to a Product should not silently discard its price history; migration must be explicit.
- Price observations for unmatched items must be stored with explicit metadata to distinguish unmapped workflows (e.g., `matchMethod: "unmapped"` and `workflowType: "unmapped"`), so receipt approval does not fail on validation and downstream review can filter them reliably.
- For receipt approval `CREATE_PRODUCT` actions, UPC is optional: resolve in this order **bound/suggested product → UPC mapping (if present) → normalized-name match → create stub product**.
- Receipt-created stub products must initialize compatibility fields (`frontendId`), business identifier (`sku` via atomic counter), and required `price`; UPC linking remains a separate optional step when a UPC exists.

## 0. Ground Rules (Non‑Negotiable)

---


* `sku` is the **only business identifier** for products.
* Format: `NP-000001` (prefix `NP-`, 6‑digit zero‑padded sequence).
* SKUs are **immutable** once assigned.
Legacy identifiers:

* Mongo `_id` = persistence identifier (never shown to operators).
* `frontendId` exists **only for backward compatibility**.

* SKUs are generated using an **atomic MongoDB counter**.

  * `findOneAndUpdate` with `$inc` and `{ upsert: true, new: true }`.
  * Counter key: `productSku`.
* Client‑side SKU generation is forbidden.


There is **one UPC registry**.
It serves two roles simultaneously:

1. **UPC → SKU mapping** (inventory resolution)
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

## 3. Receipt Scanner (Dedicated Full-Screen)

### 3.1 Architecture

**Receipt Scanner (Dedicated, Full-Screen, AI-Powered)**
- **ALWAYS full-screen** camera/photo capture experience
- User interface:
  - Big "Capture" button (full-screen camera with live preview)
  - "Upload photo" button (file picker for previous photos)
  - "Flash" toggle (optional, for low-light scenarios)
  - "Cancel" / back button
- **No store selection** inside the scanner itself
- **Automatic immediate parsing** (critical invariant: happens automatically after capture)
- **Completely separate** from barcode/UPC scanners
- End-to-end workflow: Capture → Auto-parse → Review (optional safety screen) → Commit

**Shared UPC Scanners (ScannerModal)**
- Generic reusable barcode/UPC capture for context-specific workflows
- Not for receipt parsing (that's the Receipt Scanner's job)
- Used when barcode scanning is one step within a larger operation
- Supported modes:
  * `INVENTORY_CREATE` — Admin stock intake
  * `UPC_LOOKUP` — UPC registry maintenance
  * `DRIVER_VERIFY_CONTAINERS` — Returns verification
  * `DRIVER_FULFILL_ORDER` — Pack validation
  * `CUSTOMER_RETURN_SCAN` — Customer returns

**Key Distinction:**
- **Receipt Scanner:** Dedicated full-screen experience for **receipt image capture + automatic store/product detection + AI parsing**. Handles the complete receipt-to-inventory workflow.
- **Shared Barcode Scanners:** Generic UPC capture for specific workflows. One step in a larger operation. Caller decides what to do with the scanned UPC.

---

### 3.2 Complete Receipt Capture Workflow (6 Steps)

#### **Step 1: Open Receipt Scanner (Full-Screen)**
- Display full-screen camera with prominent "Capture" button
- Include "Upload photo" file picker button
- Provide "Flash" toggle for low-light scenarios
- "Cancel" / back button to exit
- **No store selection** required here

#### **Step 2: Capture/Upload → Create ReceiptCapture**
- Frontend captures image from camera OR selects from file picker
- Send image to: `POST /api/driver/receipt-capture`
- Backend uploads image to Cloudinary (or accepts data URL)
- Creates `ReceiptCapture` record with `status=pending_parse`
- Returns `captureId`

#### **Step 3: Immediately Trigger Parsing (Automatic & Critical)**
- Frontend **must immediately** call: `POST /api/driver/receipt-parse { captureId }`
- **Critical invariant:** Without immediate parse trigger, capture gets stuck in `pending_parse` forever
- This should happen automatically without user action

#### **Step 4: Backend Parse (Three Concurrent Operations)**

**A) Extract storeCandidate + items from receipt image**
- Gemini Vision API processes receipt image
- Returns:
  - Store name, address, phone (whatever is visible on receipt)
  - Items array: `[{ receiptName, quantity, totalPrice, unitPrice, upc? }]`

**B) Resolve store automatically**
- Backend matches extracted store info against existing stores (by name/phone/address)
- If match found: use that store
- If no match: auto-create new store record (as draft, inactive until owner approves)

**C) Resolve products + prices automatically**
- For each line item:
  - If UPC present: match product by UPC in registry
  - Else: fuzzy match by name/size/brand against store inventory
  - If no match: create product record (draft or active per your config)
- Write store-specific price observation to `StoreInventory`

#### **Step 5: Review Screen (Optional but Recommended Safety Step)**
- Display detected store with override option
- Show extracted items with confidence scores
- Highlight new products that will be created
- Show price changes detected
- Provide two paths:
  - **Auto-apply** if confidence is high and few unknowns
  - **Manual approve** if confidence is low or many new items need verification

#### **Step 6: Commit Updates (Backend)**
When approved (auto or manual):
- Create/activate store record (if new)
- Create/activate product records (if new)
- Update `StoreInventory` with price observations
- Create audit log entry
- Set `ReceiptParseJob.status = APPROVED`
- Frontend clears scanner and shows success

### 3.3 Shared Scanners (Separate from Receipt Scanner)

**When NOT using Receipt Scanner:**

If other workflows need simple barcode/UPC capture, use the shared **ScannerModal** component for:
- **INVENTORY_CREATE** — Admin stock receiving
- **UPC_LOOKUP** — UPC registry maintenance
- **DRIVER_VERIFY_CONTAINERS** — Return verification
- **DRIVER_FULFILL_ORDER** — Pack validation
- **CUSTOMER_RETURN_SCAN** — Customer return building

**Shared Scanner Responsibilities:**
* Camera lifecycle management
* Barcode detection and normalization (digits only)
* Cooldown / dedup logic (1200ms default)
* Beep + visual feedback
* `onScan(upc)` callback to handler

**Shared Scanner Must NOT:**
* Mutate inventory directly
* Create products without explicit user intent
* Decide business logic (handler decides intent)

**Result Panel Requirement:**
* The **Create Product form** is the required result panel for product creation flows
* Preview cards are **not** used; all edits happen directly in forms
* Scanners stay open for continuous scanning; close only when explicitly dismissed

---

## 4. Scanner Invariants

### 4.1 Receipt Scanner Invariants

* **Full-screen camera** with prominent capture button
* **No confirmation dialog** — capture → upload → auto-parse → review
* **Flash toggle** for low-light scenarios
* **Cancel** always returns to previous screen
* **Auto-parsing is critical:** without immediate parse trigger, captures get stuck in pending_parse

### 4.2 Shared UPC Scanner Invariants

* **One Scan = One Action:**
  * Every scan produces a beep, a visible result, and a recorded outcome

* **Cooldown / Duplicate Handling:**
  * Duplicate scans within cooldown **must not be silently ignored**
  * Show toast: "Same UPC — tap to add again"
  * Blocking still counts as an action

* **Always Show What Was Detected:**
  * After each scan, display a result panel (Create Product form, search result, etc.)

* **Unmapped UPC Handling:**
  * Show UnmappedUpcModal with two options:
    1. Create new product with this UPC
    2. Attach UPC to existing SKU (search by SKU/name)
  * Automatic creation without operator intent is forbidden

---

## 5. Inventory & Audits

### 5.1 Inventory Mutations

* Inventory changes are **server‑side only**.
* Primary scan endpoint:

  * `POST /api/upc/scan`
* Behavior:

* mapped UPC → increment Product.stock
* unmapped UPC → return `action: unmapped`
* Inventory scanning keeps the scanner open after a UPC scan.
* Inventory scanning closes the scanner only after photo capture completes.
* The post-scan bottom sheet Create Product form is the single result panel during continuous scanning.

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

* `defaultIncrement` — Default quantity to add per scan (Inventory mode)
* `cooldownMs` — Scan dedup window (1200ms default)
* `requireSkuForScanning` — If true, items must have SKU before scanning
* `beepEnabled` — If true, scanner emits beep on scan
* `scanningModesEnabled` — Feature toggles for scanner modes:
  - `inventoryCreate` — Admin stock intake
  - `upcLookup` — UPC registry maintenance
  - `driverVerifyContainers` — Returns verification
  - `customerReturnScan` — Customer returns

### 7.2 Inventory Configuration

* `shelfGroupingEnabled`

### 7.3 Storage Lists

* `storageZones`
* `productTypes`

AppSettings **schema is authoritative**.
Routes must be updated when new fields are added.

---

## 8. Role‑Specific Workflows

### 8.1 Management

* **Receipt Scanner:** For capturing receipts with auto-parse and price detection
* **INVENTORY_CREATE:** Admin stock intake via shared scanner
* **UPC_LOOKUP:** UPC registry maintenance via shared scanner
* Operators may map UPCs to SKUs and edit deposit metadata

### 8.2 Driver

* **DRIVER_VERIFY_CONTAINERS:** Return verification via shared scanner
* **DRIVER_FULFILL_ORDER:** Pack validation via shared scanner
* Focused on return verification and eligibility
* Identity verification gates are workflow rules, not scanner rules

### 8.3 Customer

* **CUSTOMER_RETURN_SCAN:** Build return lists via shared scanner UX
* Scans add UPCs to a return list.
* Eligibility and estimated credit are shown immediately.
* Customer scans never mutate inventory directly.

---

## 9. Terminology Lock

Use these exact terms:

* SKU (never “Product ID”)
* UPC Registry (internal; UI label may differ)
* Scanner modes: `INVENTORY_CREATE`, `UPC_LOOKUP`, `DRIVER_VERIFY_CONTAINERS`, `DRIVER_FULFILL_ORDER`, `CUSTOMER_RETURN_SCAN`
* Receipt Scanner (dedicated, full-screen)
* ScannerModal (shared, for barcode capture)
* Inventory Audit

Forbidden drift terms:

* duplicate scanners (only one Receipt Scanner, one shared ScannerModal)
* product‑id (for business identity)
* silent scan ignore
* Mode A/B/C/D (use explicit mode names instead)

---


## 10. Enforcement Principle

This file exists to prevent system drift.

If a future change introduces:

* a second scanner
* a second UPC table
* client‑generated SKUs
* silent scan failures

…the change is invalid and must be rejected.

---

## 11. Tier Demotion & Review Rules

### Automatic Demotion Triggers

A user is demoted one tier if any of the following occur:

**Inactivity**

- No completed orders in 180 days

**Spend Decay**

- Lifetime product spend falls below 75% of the tier’s minimum due to refunds or abuse

**Trust Regression**

- Phone verification revoked → cannot remain Silver+
- ID revoked → cannot remain Gold+

**Abuse / Risk Flags**

- Excessive refunds
- Return fraud
- Chargeback patterns
- Owner-flagged risk

### Manual Review Override

The owner may freeze, demote, or revoke tier status at any time for risk management.
