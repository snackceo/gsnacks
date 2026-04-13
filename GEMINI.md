# GEMINI Contract

> **Canonical Source (GEMINI):** This file is the single source of truth for non-negotiable system behavior and contracts. Do not place glossary-style definitions here; define terms in [GLOSSARY.md](GLOSSARY.md).

## 1) Backend Authority

- Backend calculations are authoritative for all financial, inventory, and settlement outcomes.
- If UI estimates differ from backend totals, backend totals must win.

## 2) Product Identity Contract

- `sku` is the only business identifier for products.
- SKU format is immutable (`NP-000001`) and server-generated using an atomic counter.
- Client-side SKU generation is forbidden.

## 3) UPC Resolution Contract

Mandatory flow:

```text
UPC -> UPC Registry -> SKU -> Product -> Action
```

- UPCs must not resolve directly to products.
- If no UPC->SKU mapping exists, return explicit unmapped state.
- Silent fallback behavior is forbidden.

## 4) Frontend API Contract

- Use `${BACKEND_URL}/api/...` for API requests.
- Always include `credentials: 'include'`.
- Do not use relative API paths.
- Do not redefine `BACKEND_URL` locally.
- Prefer shared `apiFetch()` wrapper.

## 5) Receipt Scanner Contract

- Receipt scanner is a dedicated full-screen capture flow.
- Parse trigger after capture is immediate and automatic.
- Capture without immediate parse is invalid behavior.
- Receipt flow is separate from shared UPC scanner modes.

## 6) Shared Scanner Contract

- One scan must produce one visible, logged outcome.
- Duplicate scans inside cooldown cannot be silently ignored.
- Unmapped UPCs require explicit operator intent (create new or attach existing).

## 7) Inventory Mutation Contract

- Inventory mutations are server-side only.
- Scan endpoints may return unmapped action but must not invent implicit inventory changes.

## 8) Credits & Payout Eligibility Contract

- Credit origin must be tracked (`RETURN`, `POINTS`, `MANUAL`).
- Only `RETURN` origin credits are cash-payout eligible.
- Credits usage and payout enforcement must happen on backend.

## 9) Receipt Price Intelligence Contract

- Receipt commits must record price observations for matched and unmatched items.
- Unmatched receipt items are retained for later mapping/review (not discarded).
- Product creation from receipt review remains policy-gated.

## 10) Receipt Resolution Order Contract

For receipt approval `CREATE_PRODUCT` and matching workflows, use this order:

1. Bound/suggested product
2. UPC registry mapping (when UPC exists)
3. Normalized-name matching
4. Create stub product (policy-gated)

## 11) Tier Demotion & Review Rules

- Users are automatically demoted one tier for:
  - inactivity of 180 days,
  - spend decay below 75% of the tier minimum,
  - loss of required verification (phone/ID).
- The owner may manually freeze, demote, or revoke tier status at any time for risk management.

## 12) System Invariants

- Michigan container value is fixed at **$0.10** per eligible container.
- Cancellations before capture/delivery must release authorized wallet credits and restock inventory immediately.
