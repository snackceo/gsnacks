# NinpoSnacks Frontend – Scanner + SKU UX Contract

## Scope

This file documents UI/UX, scanner, and component contract. For all roles, permissions, scanner modes, and domain terms, see [GLOSSARY.md](../GLOSSARY.md). For system philosophy, see [GEMINI.md](../GEMINI.md). For backend rules, see [server/GEMINI.md](../server/GEMINI.md).

---

## Identity
- In operator UI: show SKU (NP-000001) as the primary identifier.
- Replace any “Product ID” label with “SKU”.
- UI may still carry `id` for React list keys, but do not show it as the business identifier.

## Receipt Scanner (Dedicated, Full-Screen)
- **When to use:** Operator captures receipt image for pricing intelligence
- **UX:** Full-screen camera with big "Capture" button, "Upload" button, "Flash" toggle, "Cancel"
- **No store selection required** in the scanner itself
- **Critical:** Frontend must call `POST /api/driver/receipt-parse` immediately after upload
- **Workflow:**
  1. Capture/upload image
  2. Backend creates ReceiptCapture
  3. Frontend triggers parse
  4. Backend extracts store candidate and items
  5. Optional review screen
  6. Commit to catalog

## UPC/Barcode Scanners (Shared When Mechanics Match)
- Use shared ScannerModal component for:
  - Management inventory receiving (Mode A: `INVENTORY_CREATE`)
  - Management UPC whitelist maintenance (`UPC_LOOKUP`)
  - Driver returns intake (Mode C: `DRIVER_VERIFY_CONTAINERS`)
  - Driver fulfillment (Mode D: `DRIVER_FULFILL_ORDER`)
  - Customer returns list building (`CUSTOMER_RETURN_SCAN`)
- **Rule:** Only the callback and mode differ; scanning mechanics must be consistent
- **Do not use for receipt parsing** — use dedicated Receipt Scanner instead

## Scanning UX Rules (Receipt + UPC Scanners)

### Receipt Scanner Rules
1) **Full-screen experience** — no hidden modals or overlays
2) **Auto-parse is critical** — frontend must call `/api/driver/receipt-parse` immediately after upload
3) **No double confirmation** — capture → upload → auto-parse → optional review
4) **Flash toggle** for low-light scenarios

### UPC Scanner Rules (Shared Barcode Scanners)
1) **No silent cooldown ignores**
   - If a scan is blocked by cooldown: show toast "Same UPC — tap to add again"
   - Blocking still counts as an action
2) **Show result panel after each scan**
   - The Create Product form (auto-filled) is the result panel
   - Bottom sheet stays open while camera remains active
   - Do not show preview cards or duplicate panels
   - Display: UPC, Product name, SKU, storageZone/storageBin, status ("Mapped", "Unmapped", etc.)
3) **Unmapped UPC handling**
   - Open UnmappedUpcModal with two options:
     - Create product & link UPC
     - Attach UPC to existing SKU (search by SKU/name)

## Management modes
- Inventory Mode A:
  - Flow: scan UPC → bottom sheet intake UI shows UPC while camera stays open → optional photo capture → auto-fill form → create product.
  - The Create Product form is the intake UI (no separate preview cards).
  - Photo capture is optional and happens from the intake UI; camera closes only after capture completes.
- UPC Whitelist module:
  - scan populates UPC input, then operator saves metadata
  - can also attach sku mapping from this screen

## Driver modes
- Mode C:
  - scan UPCs to verify returns eligibility (deposit program)
  - duplicate handling must prompt (confirm add) instead of “nothing happened”
- Mode D optional:
  - validate items in order by UPC -> SKU.

## Customer returns scan
- Customer scan adds UPC to return list, shows eligibility and estimated credit.
- Must use the same scan normalization and cooldown rules.

## Styling/mobile UX
- Management should use a top horizontal nav on mobile with normal page scroll.
- Scanner actions should be prominent and consistent across modules.
