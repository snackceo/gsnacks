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
