# GSnacks Glossary

> **Canonical Source (GLOSSARY):** This file is the single source of truth for domain definitions and terminology. Do not place behavioral contracts here; put those in [GEMINI.md](GEMINI.md).

## Usage Rules

- Add new domain terms here before using them in code/docs.
- Use exact canonical names; avoid synonyms for canonical fee and workflow terms.
- Keep entries definitional (what a term means), not prescriptive (what systems must do).

## Core Terms

- **Bottle Return Service**: End-to-end Michigan deposit return workflow (intake, verification, settlement).
- **Credit Settlement**: Return value credited to user wallet.
- **Cash Settlement**: Return value paid out as cash, subject to configured fees.
- **Route Fee**: Base logistics fee for route service.
- **Distance Fee**: Mileage-based fee beyond included miles.
- **Glass Handling Surcharge**: Additional per-glass-container handling fee.
- **SKU**: Immutable business identifier for products.
- **UPC Registry**: Canonical mapping store for UPC metadata and optional SKU link.
- **Unmapped UPC**: UPC with no SKU mapping in registry.
- **Unmapped Product**: Receipt-derived item tracked before being mapped to a product.
- **Price Observation**: Store/item price signal captured from receipts or operations.
- **Receipt Capture**: Uploaded/captured receipt image awaiting or undergoing parse/approval.
- **Receipt Parse Job**: Parsing lifecycle record for a receipt capture.
- **Membership Tier**: User tier category controlling benefits and policy behavior.
- **Credit Origin**: Provenance of credits (`RETURN`, `POINTS`, `MANUAL`).

## Scanner Modes (names)

- `INVENTORY_CREATE`
- `UPC_LOOKUP`
- `DRIVER_VERIFY_CONTAINERS`
- `DRIVER_FULFILL_ORDER`
- `CUSTOMER_RETURN_SCAN`

## Roles (names)

- `CUSTOMER`
- `DRIVER`
- `MANAGER`
- `OWNER`
