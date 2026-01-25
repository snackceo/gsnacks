# NinpoSnacks Copilot Instructions

> **Audience:** AI agents assisting with code changes  
> **Source of Truth:** [GEMINI.md](../GEMINI.md), [server/GEMINI.md](../server/GEMINI.md), [GLOSSARY.md](../GLOSSARY.md), [README.md](../README.md)

## 0) Project Summary

**NinpoSnacks** is a delivery-first snack business web application with integrated pricing intelligence powered by receipt scanning.

**Core Features:**
- Customer storefront (browse, cart, checkout via Stripe)
- Backend order + payment processing + user accounts (MongoDB)
- Container/returns credit logic (wallet credit vs cash-out for bottle returns)
- **Pricing intelligence system** driven by receipt scanning (Gemini Vision AI) to update store catalog pricing
- Admin/management tools: receipt review, approvals, stores management, UPC registry, audit logs
- Distinct roles: CUSTOMER, DRIVER, MANAGER, OWNER with graduated permissions

**Key Principle:**
Backend is the **source of truth** for inventory, products, stores, and approvals. Frontend does not "invent state"—it requests, displays, allows edits, then submits to backend.

## 1) Roles and What Each Is Allowed to Do

### CUSTOMER
- Browse products and add to cart
- Checkout (Stripe card, Google Pay, or wallet credits)
- View and manage wallet credit balance
- See order receipts and history
- Initiate container returns
- **Cannot:** Access receipt scanning, approvals, or management features

### DRIVER
- Capture/upload receipts from stores (operational scanning)
- View their own receipt capture queue
- **May:** Scan UPCs to assist matching, confirm item suggestions
- **Cannot:** Apply changes to catalog, approve receipts, or mutate inventory globally
- **Cannot:** Access other drivers' data or administrative tools

### MANAGER
- Everything DRIVER can do, plus:
- Review parsed receipts from queue
- Approve/reject receipts
- Apply changes to store inventory pricing (if permitted by Owner)
- Manage stores (view, edit, activate draft stores)
- UPC registry maintenance
- **Cannot:** Access approvals requiring Owner, or override Owner-level decisions

### OWNER
- **Everything in the system**
- Receipt capture, review, and approval
- All management tools: approvals queue, stores, UPC registry, audit logs
- Audit log access and CSV export
- Manual user adjustments (tier, credit, refund approvals)
- System settings and feature toggles
- AI-assisted features (Gemini summaries)

**Username Prefix Convention (enforced in backend):**
- Owner: `owner_` prefix → role = `OWNER`
- Driver: `driver_` prefix → role = `DRIVER`
- Else: role = `CUSTOMER` (default)

## 2) Core Data Concepts

### Store
- A retail store location.
- Fields: `name`, `address`, `phone`, `storeType`, `isPrimarySupplier`
- May be created as a draft from receipt parsing (inactive until owner activates).
- [server/models/Store.js](../server/models/Store.js)

### Product
- Canonical product in catalog.
- Fields: `sku` (immutable, NP-000001), `upc`, `name`, `price`, `deposit`, `stock`, `sizeOz`, `category`, `isGlass`, `isHeavy`, `isTaxable`
- Storage metadata: `brand`, `productType`, `storageZone`, `storageBin`
- [server/models/Product.js](../server/models/Product.js)

### StoreInventory
- Join table: `storeId` + `productId` with pricing observations.
- Tracks `observedPrice`, `priceHistory`, `lastObservedAt`
- Updated when receipts are approved (not during parse).
- [server/models/StoreInventory.js](../server/models/StoreInventory.js)

### UpcItem (UPC Registry)
- Mapping of `upc` (digits only) → `productId` or `sku`, plus metadata.
- Fields: `upc`, `name`, `depositValue`, `containerType` (glass | plastic | aluminum), `sizeOz`, `isEligible`
- Single source of truth for barcode resolution.
- [server/models/UpcItem.js](../server/models/UpcItem.js)

### ReceiptCapture
- A captured receipt record (photo uploaded by Driver/Manager/Owner).
- Fields: `captureRequestId` (idempotency), `storeId`, `storeName`, `status`, `images[]`, `draftItems[]`
- Status lifecycle: `pending_parse` → `parsing` → `parsed` → `review_complete` → `failed`
- [server/models/ReceiptCapture.js](../server/models/ReceiptCapture.js)

### ReceiptParseJob
- Parse results from Gemini Vision.
- Fields: `status` (QUEUED, PARSED, NEEDS_REVIEW, APPROVED, REJECTED)
- Contains: `storeCandidate`, `lineItems[]`, `warnings[]`
- Links to `ReceiptCapture` and triggered via BullMQ worker.
- [server/models/ReceiptParseJob.js](../server/models/ReceiptParseJob.js)

### ReceiptNameAlias
- Alias table for fuzzy matching: maps receipt line item text → productId.
- Example: "Coca Cola 2L Bottle" → productId for "Coke 2L"
- Built from successful receipts (learning feedback loop).
- [server/models/ReceiptNameAlias.js](../server/models/ReceiptNameAlias.js)

### ReceiptNoiseRule
- Filters false positives from receipt parsing.
- Example: "subtotal", "tax", "discount" line items should be ignored (marked as noise).
- Per-store configurable rules.
- [server/models/ReceiptNoiseRule.js](../server/models/ReceiptNoiseRule.js)

### AuditLog
- Immutable record of all system mutations.
- Fields: `type`, `actorId`, `actorRole`, `details`, `timestamp`, `relatedEntityId`
- Logged events: approval, reject, apply, store-created-from-receipt, product-created, upc-linked, inventory-updated
- [server/models/AuditLog.js](../server/models/AuditLog.js)

## 3) Customer Storefront Flows

### A) Browse → Cart → Checkout
1. Customer browses products (filtered by category, search, price).
2. Adds items to cart (cart stored in React state + optional localStorage).
3. Clicks "Checkout":
   - Selects delivery address (or pickup).
   - Reviews fees (Route Fee + Distance Fee, tier-discounted).
   - Chooses payment method: Stripe card, Google Pay, or wallet credits.
4. Backend creates Order (PENDING status).
5. Stripe authorizes charge (if card payment).
6. Order moves to AUTHORIZED → PAID → ASSIGNED → PICKED_UP → DELIVERED.

### B) Wallet / Credits
- Wallet credit is used to reduce payment fees and preserve dignity.
- Certain flows generate credits:
  - **Container returns (Credit Settlement):** $0.10 per container, no Stripe fees, applied to wallet or cart.
  - **Loyalty points:** 1 point per $1 spent (product only), 100 points = $1 credit (non-withdrawable, in-app only).
  - **Manual adjustments:** Owner grants credit for disputes or goodwill.
- Wallet credits offset payment before Stripe charges.
- Only **RETURN** credits are eligible for cash payout (after fees).

### C) Returns / Container Credit
**Two distinct settlement paths (MUST NOT merge):**

**Credit Settlement (Default):**
- Customer returns containers → system calculates $0.10 per eligible container.
- No Stripe fees, no cash handling fee.
- Full deposit value added to wallet or applied to cart.

**Cash Settlement (Exception, Gold/Platinum/Green only):**
- Customer chooses cash instead of credit.
- Fees apply: $0.02 cash handling fee + $0.02 glass surcharge (per container).
- Net cash = (count × $0.10) − fees.
- Payout via external method (Venmo, bank transfer, etc.), NOT Stripe.

**Critical Rule:** If code changes returns logic, **preserve the two-path separation**. Never silently convert between credit and cash flows.

## 4) Receipt Scanning & Pricing Intelligence Workflow

**Goal:** When a receipt is scanned, the system should extract store identity and line items using Gemini Vision, allow human review, then apply approved changes to the catalog.

**Canonical Rule:** **No permanent catalog mutations happen until Manager/Owner approval.** Parsing produces drafts; approval applies.

### Phase 1 — Capture (Driver/Manager/Owner initiates)
1. User uploads or photographs receipt image.
2. Frontend uploads image to Cloudinary (or base64 if supported).
3. Frontend calls backend capture endpoint with image URL(s).
4. Backend creates:
   - `ReceiptCapture` (status: `pending_parse`)
   - `ReceiptParseJob` (status: `QUEUED`)
5. **Expected outcome:** Receipt appears in queue ready for parsing.

### Phase 2 — Parse (Automatic or manual trigger)
1. Backend calls Gemini Vision API with receipt image(s).
2. Gemini returns:
   - `storeCandidate` { name, phone, address, confidence }
   - Extracted line items { raw text, qty, unit price, line total }
3. Backend normalizes line items and runs matching pipeline:
   - **Alias match:** ReceiptNameAlias lookup (learned from past approvals)
   - **UPC match:** If UPC present in item, check UpcItem registry
   - **Fuzzy match:** Levenshtein against existing products in store inventory
   - **Warning detection:** Price bounds, missing size tokens, low confidence
4. Backend stores results as draft items + warnings.
5. **ReceiptCapture** becomes `parsed`; **ReceiptParseJob** becomes `PARSED` or `NEEDS_REVIEW`.

### Phase 3 — Review (UI, Draft-only, role-dependent)

**Driver review constraints:**
- Driver can **confirm** matching suggestions.
- Driver can **scan UPCs** to attach to a product.
- Driver **cannot** apply changes to global catalog (no final commit).
- Driver views only their own receipt queue.

**Manager/Owner review:**
- Full edit access:
  - Override store match (select existing store or confirm new draft).
  - Confirm/change matched product for an item.
  - Scan UPC to attach to a product.
  - Create product draft (name, category, size, price, tax, deposit).
  - Mark items as "noise" or "ignore".
- Can approve and apply changes.

### Phase 4 — Approval / Apply (Manager/Owner only)
1. Manager/Owner clicks "Approve & Apply" (or "Reject").
2. Backend approval endpoint:
   - If `storeCandidate` has no existing store match:
     - Create a **draft Store record** (inactive, marked as receipt-sourced)
   - For approved items:
     - Create missing products in catalog
     - **Upsert StoreInventory** price observations (observedPrice, priceHistory)
     - Link UPCs (add/update UpcItem mappings)
   - Mark **ReceiptParseJob** as `APPROVED`
   - Write **AuditLog** entry with all mutations
3. **Critical:** No mutations happen until approval. Parse is draft-only.

### Phase 5 — Store Activation (Manager/Owner)
- Draft stores created from receipts remain **inactive** until manually activated.
- Activation is a separate action from receipt approval.
- Active stores appear in the global store list for future receipts.

**Key File Locations:**
- Receipt routes: [server/routes/receipts.js](../server/routes/receipts.js), [server/routes/receipt-parse.js](../server/routes/receipt-parse.js), [server/routes/receipt-prices.js](../server/routes/receipt-prices.js)
- Receipt models: [server/models/ReceiptCapture.js](../server/models/ReceiptCapture.js), [server/models/ReceiptParseJob.js](../server/models/ReceiptParseJob.js)
- Parse worker: [server/workers/receiptWorker.js](../server/workers/receiptWorker.js) (BullMQ)
- UI components: [src/components/ReceiptCapture.tsx](../src/components/ReceiptCapture.tsx), [src/components/ReceiptCaptureFlow.tsx](../src/components/ReceiptCaptureFlow.tsx)

## 5) Receipt Lifecycle & Status Flow

**ReceiptCapture.status:**
- `pending_parse` — Captured, waiting for Gemini parse
- `parsing` — Parse in progress
- `parsed` — Parse complete, items in draft state
- `review_complete` — All items reviewed and approved
- `failed` — Parse failed

**ReceiptParseJob.status:**
- `QUEUED` — Waiting for parse worker
- `PARSED` — Parse complete, results stored
- `NEEDS_REVIEW` — Human review required
- `APPROVED` — Approval given, mutations applied
- `REJECTED` — Rejected, no mutations

## 6) Admin / Management Tooling Flows

### A) Approvals Queue
- Management reviews pending approvals (NEEDS_REVIEW, awaiting action).
- Approve/Reject triggers:
  - State transitions (ReceiptParseJob)
  - Audit log creation
  - Optional: inventory/price updates (on approve)

### B) Stores Management
- View list of all stores (active + draft/inactive)
- Draft stores created from receipts should display:
  - Origin metadata ("Created from receipt capture")
  - Activation button
  - Can edit name, address, phone before activation
- Activate draft → store becomes active
- View/edit store details (name, address, location)

### C) UPC Registry
- CRUD UPC entries
- Link UPC to product SKU
- Set deposit value, container type, size
- Mark eligible/ineligible for returns
- Used by receipt review and scanning flows

### D) Audit Logs
- Immutable log of all system mutations
- Filterable by:
  - Event type (approval, reject, apply, store-created-from-receipt, product-created, upc-linked, inventory-updated)
  - Actor (user/role)
  - Time range
- CSV export capability
- Optional: AI-powered text summaries (Gemini model, never leak secrets)

## 7) UI Structure Expectations

### Driver Page
- **Receipt Capture:** Upload/photograph receipts
- **Queue:** View driver's own receipt queue (not global)
- **Review Tooling:** Confirm matches, scan UPCs (no approval/apply)
- **Cannot see:** Global approvals, settings, management controls

### Owner / Admin Page (All-in-one)
Owner needs a single unified control center:
1. **Receipt Capture/Upload** — Same as driver
2. **Receipt Queue** — All receipts (global view, not just own)
3. **Review Screen** — Edit, confirm, scan, create products
4. **Approvals Module** — Approve/Reject with reason
5. **Stores Module** — List, edit, activate draft stores
6. **UPC Registry** — Manage barcode mappings
7. **Audit Logs** — Searchable, filterable, export to CSV
8. **Role Checks:** Show approve/apply only to OWNER/MANAGER

### Future: Manager Page
- Similar to Owner but limited scope/permissions per role
- Review only their assigned receipts
- May have restrictions on which stores they can manage

## 8) Implementation Constraints for Copilot

**CRITICAL:**

1. **Do not create new backend contracts unless necessary.**
   - Use existing endpoints if they exist.
   - If a new endpoint is required, document it explicitly and update frontend+backend consistently.

2. **Do not auto-create receipts via timers.**
   - Receipt creation must be explicit (user action), to avoid duplicates.
   - Use `captureRequestId` for idempotency.

3. **Do not mutate Store/Product/Inventory during parse.**
   - Parse produces drafts only.
   - Apply happens only on approval.

4. **Preserve role permissions.**
   - Driver cannot apply/approve.
   - Manager/Owner can.
   - Check `isOwnerUsername()` or `isManagerRequired()` middleware.

5. **All mutations must be logged in AuditLog.**
   - Types: approval, reject, store-created-from-receipt, product-created, upc-linked, inventory-updated
   - Call [server/utils/audit.js](../server/utils/audit.js) helper or equivalent.

6. **Two-path separation for returns (critical).**
   - Credit Settlement: $0.10 per container, no fees, to wallet/cart
   - Cash Settlement: $0.10 per container, fees apply, external payout
   - Never silently merge these flows.

7. **Do not accept client-provided SKUs.**
   - SKU generation is server-side only.
   - Use atomic MongoDB counter: [server/utils/sku.js](../server/utils/sku.js)

## 9) Copilot Pre-Change Checklist

**Before touching ANY code, locate and review these in the repo:**

- [ ] Where receipt routes/controllers live (`server/routes/receipt-*.js`)
- [ ] ReceiptCapture and ReceiptParseJob schema/models (`server/models/ReceiptCapture.js`, `ReceiptParseJob.js`)
- [ ] Store, Product, StoreInventory models (`server/models/Store.js`, `Product.js`, `StoreInventory.js`)
- [ ] AuditLog write helpers (`server/utils/audit.js` or equivalent)
- [ ] Existing approvals endpoints (search `approvals` in routes)
- [ ] Existing role middleware/guards (`authRequired`, `ownerRequired`, `managerOrOwnerRequired` in `server/utils/helpers.js`)
- [ ] Frontend API constants (`src/constants.tsx` for `BACKEND_URL`)
- [ ] Scanner components and modes (`src/components/ScannerModal.tsx`, `src/types.ts` for ScannerMode enum)
- [ ] Order/Payment models and routes (`server/models/Order.js`, `server/routes/payments.js`, `stripe.js`)
- [ ] User model and tier/credit logic (`server/models/User.js`)

**If any are missing, DO NOT GUESS. Reference actual files or ask for clarification.**

## 10) Copilot Prompt Templates

Use these verbatim when requesting analysis:

### A) "Explain current receipt endpoints and align UI"
> Inspect the backend routes/controllers related to receipt capture/parse/review/commit/apply. List the existing endpoints and payloads. Identify which endpoint currently mutates inventory. Propose a role-neutral endpoint map for Owner/Manager/Driver UIs without changing behavior.

### B) "Implement Owner all-in-one page"
> Build an Owner control center page that composes existing modules: receipt capture/upload, receipt queue, receipt review, approvals, stores, UPC registry, audit logs. Ensure role checks: show approve/apply only to OWNER/MANAGER. Do not change parsing logic, only wiring and layout.

### C) "Receipt apply must be backend-authoritative"
> Modify frontend so final catalog mutations happen only via a backend approve/apply endpoint. Remove any frontend "commit" that mutates inventory directly. Ensure receipt review is draft-only. Add audit log on successful apply.

## 11) Critical Knowledge Required

### Authentication & API Calls

**Rule:** All frontend API calls **must** include `credentials: 'include'` to attach JWT cookies automatically.

```tsx
// ✅ CORRECT
const res = await fetch(`${BACKEND_URL}/api/orders`, { credentials: 'include' });

// ❌ WRONG - breaks auth
const res = await fetch(`${BACKEND_URL}/api/orders`);
```

- `BACKEND_URL` is defined once in [src/constants.tsx](../src/constants.tsx)—import it, never redefine
- JWT cookies are httpOnly; JavaScript never reads them directly
- Browser attaches cookies automatically if `credentials: 'include'` is set
- [server/utils/helpers.js](../server/utils/helpers.js): `setAuthCookie()`, `clearAuthCookie()` handle token lifecycle (7-day expiry)

**Never confuse these:**

| Identifier | Purpose | Mutability | Owner | Format |
|-----------|---------|-----------|-------|--------|
| `sku` | Business identifier, UI reference | Immutable | Server-generated | `NP-000001` |
| `upc` | Barcode for scanning | Mutable | UPC Registry | Digits only |
| `frontendId` | Legacy ID (backward compat only) | N/A | Deprecated | Any |
| `_id` | MongoDB persistence key | N/A | Never shown | Mongo ObjectId |

**Rules:**
- `sku` is generated server-side using atomic MongoDB counter: `findOneAndUpdate({ _id: 'productSku' }, { $inc: { seq: 1 } }, { upsert: true, new: true })`
- Operator UI displays and references **SKU**, never legacy IDs
- SKUs are **never reused**, even if products are deleted
- Product model: [server/models/Product.js](../server/models/Product.js)

### 3. Barcode Scanning: One Scanner, Many Modes

**One shared ScannerModal** (`src/components/ScannerModal.tsx`) across entire system.

**Supported Modes** (from [src/types.ts](../src/types.ts)):
- `INVENTORY_CREATE` — Admin adding stock (creates new product)
- `UPC_LOOKUP` — UPC registry maintenance
- `DRIVER_VERIFY_CONTAINERS` — Driver return intake
- `DRIVER_FULFILL_ORDER` — Driver pack validation (Mode D)
- `CUSTOMER_RETURN_SCAN` — Customer container returns
- `RECEIPT_PARSE_LIVE` — Receipt parsing with live camera

**Scan Flow:**
```
UPC (normalized to digits) → UpcItem lookup → SKU mapping → Product update OR "unmapped" state
```

**Rules:**
- ScannerModal **never** creates products directly
- If UPC unmapped: surface explicit **Unmapped UPC state**, never silent fallback
- For `INVENTORY_CREATE` mode: result panel is a **form** (bottom sheet), not preview cards
- Camera stays active; user edits directly in form
- ScannerModal responsibilities: camera lifecycle, dedup (cooldown 1200ms), UPC normalization, beep, `onScan(upc)` callback

**Example Implementation Pattern:**
```tsx
const [scannerMode, setScannerMode] = useState<ScannerMode | null>(null);
const handleScan = (upc: string) => {
  // Mode-specific logic: route to appropriate handler
  if (scannerMode === ScannerMode.INVENTORY_CREATE) {
    // Resolve UPC → SKU, show product form
  }
};
```

### 4. Data Model: Users, Credits, and Tiers

**User Fields** ([server/models/User.js](../server/models/User.js)):
- `username`, `usernameLower` (normalized; unique)
- `role`: `'CUSTOMER' | 'DRIVER' | 'OWNER' | 'ADMIN'` (OWNER/ADMIN are equivalent)
- `creditBalance` (wallet dollars), `authorizedCreditBalance` (pending)
- `loyaltyPoints` (1 point per $1 spent; 100 points = $1)
- `membershipTier`: `COMMON | BRONZE | SILVER | GOLD | PLATINUM | GREEN`
- `ordersCompleted`, `phoneVerified`, `photoIdVerified`

**Credit Origin** (authoritative, must track):
- `RETURN` — From verified bottle returns (eligible for cash payout)
- `POINTS` — From loyalty points (non-withdrawable, in-app only)
- `MANUAL` — Owner adjustment (non-withdrawable)

**Tier Rules** (from GEMINI.md section 12):
- Earn loyalty points **product spend only** (not fees)
- Credits from POINTS/MANUAL are **never** eligible for cash payout
- Only RETURN credits can be withdrawn as cash
- Tier advancement: based on completed orders, lifetime product spend, verification (phone, photo ID)
- Platinum: invite-only (manual owner assignment)
- GREEN: support tier (manual assignment; no auto-advance; may waive fees)

### 5. Order & Payment Flow

**Order Status Sequence** ([src/types.ts](../src/types.ts)):
```
PENDING → AUTHORIZED → PAID → ASSIGNED → PICKED_UP → ARRIVING → DELIVERED → CLOSED
(refunds: REFUND_REQUESTED → REFUNDED)
```

**Payment Processing:**
- Stripe integration: [server/routes/stripe.js](../server/routes/stripe.js)
- Payment method options: `STRIPE_CARD | GOOGLE_PAY | CREDITS`
- UI captures payment via PaymentCaptureFlow, backend authorizes/charges
- Route Fee + Distance Fee = logistics cost (tier-dependent discounts: BRONZE 10%, SILVER 20%, GOLD 30%)
- Pickup-only orders: `pickupOnlyMultiplier` (default 0.5) reduces fees

### 6. Receipt Upload & AI Parsing

**Receipt Capture Flow:**
- Manual photo capture from camera (`onPhotoCaptured`)
- Sent to backend for OCR/AI parsing
- Parsed items appear in receipt bucket; operator assigns SKU mappings
- ReceiptCapture components: [src/components/ReceiptCapture.tsx](../src/components/ReceiptCapture.tsx), [ReceiptCaptureFlow.tsx](../src/components/ReceiptCaptureFlow.tsx)
- Receipt schema: [server/models/ReceiptCapture.js](../server/models/ReceiptCapture.js)
- Worker processes receipts: [server/workers/receiptWorker.js](../server/workers/receiptWorker.js) (BullMQ)

### 7. Role-Based Access (Three Operator Roles)

**CUSTOMER:**
- Browse products, place orders, pay
- Scan own returns, view refunds, manage wallet

**DRIVER:**
- Assigned to orders (DriverView component)
- Scan returns intake (`DRIVER_VERIFY_CONTAINERS`)
- Scan order fulfillment (`DRIVER_FULFILL_ORDER`)
- Track real-time delivery status

**OWNER/ADMIN:**
- Full inventory management (scan products in, set pricing)
- UPC registry maintenance
- View analytics, settings, approvals
- Manual user adjustments (tier, credits, refunds)
- Access ManagementView component

**Username Prefix Convention:**
- Owner: prefix `owner_` (enforced in [server/utils/helpers.js](../server/utils/helpers.js) `isOwnerUsername()`)
- Driver: prefix `driver_` (enforced `isDriverUsername()`)
- Else: customer

### 8. Project-Specific Conventions & Patterns

**Type Safety:**
- Use enums from [src/types.ts](../src/types.ts): `UserRole`, `OrderStatus`, `ScannerMode`, `UserTier`
- Never use string literals or `as any` for modes or statuses

**File Organization:**
- Feature toggles live in AppSettings model: `maintenanceMode`, `allowPlatinumTier`, `showAdvancedInventoryInsights`, etc.
- Routes: `server/routes/` (one file per domain: products, orders, payments, etc.)
- Models: `server/models/` (one per entity)
- Views: `src/views/` (CustomerView, DriverView, ManagementView, LoginView)
- Components: `src/components/` (reusable UI, ScannerModal is central)

**Authoritative References:**
- GEMINI.md: System contract, non-negotiable rules
- server/GEMINI.md: Backend enforcement, data model, API contract
- GLOSSARY.md: All domain definitions (roles, tiers, scanner modes, flags)
- When code conflicts with docs, **code is wrong; update it**

**Common Mistakes to Avoid:**
1. Accepting client-provided SKUs (always server-generates)
2. Forgetting `credentials: 'include'` in fetch calls
3. Using string literals instead of enums for roles/modes/statuses
4. Assuming UI state is authoritative (it isn't; backend decides)
5. Creating products silently on unmapped UPC scans (must surface state explicitly)
6. Redefining BACKEND_URL locally (import from constants.tsx)

## Code Change Protocol

**Before implementing ANY requested change:**

1. **Consult Source of Truth:** Review [GEMINI.md](../GEMINI.md), [server/GEMINI.md](../server/GEMINI.md), [GLOSSARY.md](../GLOSSARY.md), and [README.md](../README.md)
2. **Impact Analysis:** Identify how the change affects:
   - Data models and persistence (MongoDB schema implications)
   - Role-based access and authentication (does it require new permissions?)
   - Scanner workflow or payment flow (breaking changes?)
   - Existing enums/types (SKU generation, OrderStatus, UserRole, etc.)
   - Tier/credit system (does it respect credit origin tracking?)
3. **Recommend Approach:** Propose the best implementation path and highlight any:
   - Conflicts with existing invariants or contracts
   - Opportunities for consolidation (reuse existing patterns)
   - Migration/backward-compatibility concerns
4. **Clarify Scope:** Ask for approval before coding

**Example:**
- User: "Add a refund endpoint"
- Agent: "This requires changes to [Order model], [ApprovalRequest workflow], [Stripe integration]. GEMINI.md section 5 says backend is authoritative for money. Recommending: 1) Create REFUND ApprovalRequest type, 2) Validate refund eligibility per tier (GLOSSARY.md), 3) Call Stripe only after approval. Proceed? [Y/N]"

## 9) Critical Knowledge Required

### Authentication & API Calls

**Rule:** All frontend API calls **must** include `credentials: 'include'` to attach JWT cookies automatically.

```tsx
// ✅ CORRECT
const res = await fetch(`${BACKEND_URL}/api/orders`, { credentials: 'include' });

// ❌ WRONG - breaks auth
const res = await fetch(`${BACKEND_URL}/api/orders`);
```

- `BACKEND_URL` is defined once in [src/constants.tsx](../src/constants.tsx)—import it, never redefine
- JWT cookies are httpOnly; JavaScript never reads them directly
- Browser attaches cookies automatically if `credentials: 'include'` is set
- [server/utils/helpers.js](../server/utils/helpers.js): `setAuthCookie()`, `clearAuthCookie()` handle token lifecycle (7-day expiry)

### Product Identity (Authoritative)

Never confuse these:

| Identifier | Purpose | Mutability | Owner | Format |
|-----------|---------|-----------|-------|--------|
| `sku` | Business identifier, UI reference | Immutable | Server-generated | `NP-000001` |
| `upc` | Barcode for scanning | Mutable | UPC Registry | Digits only |
| `frontendId` | Legacy ID (backward compat only) | N/A | Deprecated | Any |
| `_id` | MongoDB persistence key | N/A | Never shown | Mongo ObjectId |

**Rules:**
- `sku` is generated server-side using atomic MongoDB counter: `findOneAndUpdate({ _id: 'productSku' }, { $inc: { seq: 1 } }, { upsert: true, new: true })`
- Operator UI displays and references **SKU**, never legacy IDs
- SKUs are **never reused**, even if products are deleted
- Product model: [server/models/Product.js](../server/models/Product.js)

### Barcode Scanning: One Scanner, Many Modes

**One shared ScannerModal** (`src/components/ScannerModal.tsx`) across entire system.

**Supported Modes** (from [src/types.ts](../src/types.ts)):
- `INVENTORY_CREATE` — Admin adding stock (creates new product)
- `UPC_LOOKUP` — UPC registry maintenance
- `DRIVER_VERIFY_CONTAINERS` — Driver return intake
- `DRIVER_FULFILL_ORDER` — Driver pack validation
- `CUSTOMER_RETURN_SCAN` — Customer container returns
- `RECEIPT_PARSE_LIVE` — Receipt parsing with live camera

**Scan Flow:**
```
UPC (normalized to digits) → UpcItem lookup → SKU mapping → Product update OR "unmapped" state
```

**Rules:**
- ScannerModal **never** creates products directly
- If UPC unmapped: surface explicit **Unmapped UPC state**, never silent fallback
- For `INVENTORY_CREATE` mode: result panel is a **form** (bottom sheet), not preview cards
- Camera stays active; user edits directly in form
- ScannerModal responsibilities: camera lifecycle, dedup (cooldown 1200ms), UPC normalization, beep, `onScan(upc)` callback

### Data Model: Users, Credits, and Tiers

**User Fields** ([server/models/User.js](../server/models/User.js)):
- `username`, `usernameLower` (normalized; unique)
- `role`: `'CUSTOMER' | 'DRIVER' | 'OWNER'`
- `creditBalance` (wallet dollars), `authorizedCreditBalance` (pending)
- `loyaltyPoints` (1 point per $1 spent; 100 points = $1)
- `membershipTier`: `COMMON | BRONZE | SILVER | GOLD | PLATINUM | GREEN`
- `ordersCompleted`, `phoneVerified`, `photoIdVerified`

**Credit Origin** (must track):
- `RETURN` — From verified bottle returns (eligible for cash payout)
- `POINTS` — From loyalty points (non-withdrawable, in-app only)
- `MANUAL` — Owner adjustment (non-withdrawable)

**Tier Rules** (from GEMINI.md section 12):
- Earn loyalty points **product spend only** (not fees)
- Credits from POINTS/MANUAL are **never** eligible for cash payout
- Only RETURN credits can be withdrawn as cash
- Tier advancement: based on completed orders, lifetime product spend, verification (phone, photo ID)
- Platinum: invite-only (manual owner assignment)
- GREEN: support tier (manual assignment; no auto-advance; may waive fees)

### Order & Payment Flow

**Order Status Sequence** ([src/types.ts](../src/types.ts)):
```
PENDING → AUTHORIZED → PAID → ASSIGNED → PICKED_UP → ARRIVING → DELIVERED → CLOSED
(refunds: REFUND_REQUESTED → REFUNDED)
```

**Payment Processing:**
- Stripe integration: [server/routes/stripe.js](../server/routes/stripe.js)
- Payment method options: `STRIPE_CARD | GOOGLE_PAY | CREDITS`
- UI captures payment via PaymentCaptureFlow, backend authorizes/charges
- Route Fee + Distance Fee = logistics cost (tier-dependent discounts: BRONZE 10%, SILVER 20%, GOLD 30%)
- Pickup-only orders: `pickupOnlyMultiplier` (default 0.5) reduces fees

### Receipt Upload & AI Parsing

**Receipt Capture Flow:**
- Manual photo capture from camera (`onPhotoCaptured`)
- Sent to backend for OCR/AI parsing
- Parsed items appear in receipt bucket; operator assigns SKU mappings
- ReceiptCapture components: [src/components/ReceiptCapture.tsx](../src/components/ReceiptCapture.tsx), [ReceiptCaptureFlow.tsx](../src/components/ReceiptCaptureFlow.tsx)
- Receipt schema: [server/models/ReceiptCapture.js](../server/models/ReceiptCapture.js)
- Worker processes receipts: [server/workers/receiptWorker.js](../server/workers/receiptWorker.js) (BullMQ)

### Role-Based Access (Enforcement)

**Middleware Guards** ([server/utils/helpers.js](../server/utils/helpers.js)):
- `authRequired(req, res, next)` — Requires valid JWT cookie
- `ownerRequired(req, res, next)` — Requires `owner_` username prefix
- `managerOrOwnerRequired(req, res, next)` — Requires MANAGER or OWNER role

**Username Prefix Functions:**
- `isOwnerUsername(username)` — Checks if in OWNER_USERNAMES env list
- `isDriverUsername(username)` — Checks if in DRIVER_USERNAMES env list

**Rules:**
- Role assignment at registration/login: if username matches prefix, role is auto-set
- Owner URLs guarded by ownerRequired (strict username whitelist)
- Manager URLs guarded by managerOrOwnerRequired (role-based check)
- Never assume UI role is authoritative—always verify server-side

### Project-Specific Conventions & Patterns

**Type Safety:**
- Use enums from [src/types.ts](../src/types.ts): `UserRole`, `OrderStatus`, `ScannerMode`, `UserTier`
- Never use string literals or `as any` for modes or statuses

**File Organization:**
- Feature toggles live in AppSettings model
- Routes: `server/routes/` (one file per domain: products, orders, payments, etc.)
- Models: `server/models/` (one per entity)
- Views: `src/views/` (CustomerView, DriverView, ManagementView, LoginView)
- Components: `src/components/` (reusable UI, ScannerModal is central)

**Authoritative References:**
- GEMINI.md: System contract, non-negotiable rules
- server/GEMINI.md: Backend enforcement, data model, API contract
- GLOSSARY.md: All domain definitions
- **When code conflicts with docs, code is wrong; update it**

**Common Mistakes to Avoid:**
1. Accepting client-provided SKUs (always server-generates)
2. Forgetting `credentials: 'include'` in fetch calls
3. Using string literals instead of enums for roles/modes/statuses
4. Assuming UI state is authoritative (it isn't; backend decides)
5. Creating products silently on unmapped UPC scans (must surface state explicitly)
6. Redefining BACKEND_URL locally (import from constants.tsx)

## Build & Development

**Frontend:**
```bash
npm run dev        # Start Vite dev server (localhost:5173)
npm run build      # Production build
npm run lint       # ESLint check
npm run glossary:audit  # Validate term usage against GLOSSARY.md
```

**Backend:**
```bash
npm start                    # Start Express server (localhost:5000)
npm run create-owner         # Seed owner user
npm test                     # Run tests
npm run worker:receipts      # Start receipt processing worker
npm run cleanup-abandoned-orders  # Cleanup script
```

**Databases & Services:**
- MongoDB connection: [server/db/connect.js](../server/db/connect.js)
- Redis: for session storage, BullMQ queues
- Cloudinary: media uploads (config in [server/config/cloudinary.js](../server/config/cloudinary.js))
- Sentry: error & performance tracking (initialized in [server/instrument.js](../server/instrument.js), [src/main.tsx](../src/main.tsx))

## Testing & Debugging

- Frontend tests via Vite
- Backend unit tests: `npm test` (Node test runner)
- Sentry dashboard: view errors, performance metrics, session replays
- API endpoints documented per route file; use Postman or curl for exploration
- Database: check MongoDB Atlas or local mongo CLI for state inspection

---

**Last Updated:** January 2026  
**Maintainer:** Refer to GEMINI.md for system philosophy
