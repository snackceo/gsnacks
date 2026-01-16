# NinpoSnacks Frontend – Scanner + SKU UX Contract

## Scope

This file documents UI/UX, scanner, and component contract. For all roles, permissions, scanner modes, and domain terms, see [GLOSSARY.md](../GLOSSARY.md). For system philosophy, see [GEMINI.md](../GEMINI.md). For backend rules, see [server/GEMINI.md](../server/GEMINI.md).

---

## Identity
- In operator UI: show SKU (NP-000001) as the primary identifier.
- Replace any “Product ID” label with “SKU”.
- UI may still carry `id` for React list keys, but do not show it as the business identifier.

## ScannerModal (single scanner everywhere)
- Use the shared ScannerModal component for:
  - Management inventory receiving/audit
  - Management UPC whitelist maintenance
  - Driver returns intake
  - Customer returns scan list
- Only the callback changes; scanning mechanics must be consistent.

## “Not off” scanning rules (must implement)
1) No silent cooldown ignores.
   - If a scan is blocked by cooldown:
     - show toast “Same UPC — tap to add again”
     - optionally show a small “Tap to force add” affordance.
2) After each scan, show a result panel:
   - UPC
   - Product name (if mapped)
   - SKU
   - storageZone/storageBin
   - message: “Mapped”, “Unmapped”, “Eligibility only”, etc.
3) Unmapped UPC handling:
   - Open UnmappedUpcModal with:
     - Create product & link UPC
     - Attach UPC to existing SKU (search by SKU/name)

## Management modes
- Inventory Mode A:
  - Flow: scan UPC → show UPC in intake UI → optional photo capture → auto-fill form → create product.
  - The Create Product form is the intake UI (no separate preview cards).
  - Photo capture is optional and happens from the intake UI before create.
- Inventory Mode B:
  - scan -> /api/upc/scan (separate audit flow, not used for create intake)
  - do not mutate stock automatically unless explicitly confirmed
  - track audit counts separately
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
- Management should not feel like a single endless page on mobile:
  - module navigation should be sticky (top) or bottom-tabbed
  - scanner actions should be prominent and consistent across modules
