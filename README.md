# Feature Toggles & Experimental Features

The following feature toggles and experimental/future features are available in AppSettings (see server/routes/settings.js):

- **maintenanceMode**: If true, disables all customer-facing endpoints except health.
- **requirePhotoForRefunds**: If true, customers must upload a photo for refund requests.
- **allowGuestCheckout**: If true, allows orders without user registration.
- **showAdvancedInventoryInsights**: Enables advanced inventory analytics in admin UI.
- **allowPlatinumTier**: Enables Platinum loyalty tier (future/experimental).
- **platinumFreeDelivery**: If true, Platinum tier users get free delivery (future/experimental).
- **allowReceiptApprovalCreateProduct**: If true, receipt approvals may create products from review actions (disabled by default; recommended off).
- **autoUpdateProductPriceFromReceipt**: If true, receipt approvals can update `Product.price` from latest observed receipt cost using retail rules (disabled by default; recommended off unless catalog sync is desired).

See also: GLOSSARY.md for definitions.
# NinpoSnacks – Internal Spec: Payments, Bottle Return Service, and Fees

> **Audience:** Operators & Developers only
> **Visibility:** Not customer-facing
> **Purpose:** This document explains *how the system is intended to run*, including business rationale, tier rules, and exact payment math. This is an authoritative reference and should be treated as a contract.


## Doc Map

| Doc | Purpose |
|-----|---------|
| [README.md](README.md) | Project overview, tech, usage, doc map |
| [GLOSSARY.md](GLOSSARY.md) | Canonical definitions for all terms |
| [GEMINI.md](GEMINI.md) | Centralized system philosophy, backend/frontend contract, scanner, and rules |

---

> Contract note: scoped contract docs are centralized in root [GEMINI.md](GEMINI.md); there are currently no `server/GEMINI.md` or `src/GEMINI.md` files in this repo.

## Operations & Maintenance

### Incident triage verification (receipt approvals)

When investigating receipt approval anomalies, verify all three signals together:

1. **UI body mode** used for approval (`safe`, `selected`, `locked`, `all`) from the Management receipt flow.
2. **API build id** returned by `POST /api/receipts/:jobId/approve` (`backendBuildId` in response).
3. **Audit line** for `receipt_approved`, confirming the same `backendBuildId` appears in audit details.

This “UI body mode + API build id + audit line” check helps confirm operators are validating behavior against the expected backend deployment.

### Receipt queue cleanup (stale jobs)

When receipt captures are deleted out-of-band, BullMQ can retain `receipt-parse` jobs that reference missing `ReceiptCapture` records. These jobs should be purged to prevent repeated retries and queue drift.

**On-demand cleanup (script):**

```
cd server
npm run cleanup-receipt-queue
```

Optional filters:

```
npm run cleanup-receipt-queue -- --capture-id <captureId>
npm run cleanup-receipt-queue -- --dry-run
```

**On-demand cleanup (admin API):**

```
POST /api/receipts/cleanup-queue
```

Body options:
- `captureIds`: array of captureIds to target (optional)
- `dryRun`: boolean to preview without removing jobs

**Monitoring:** check `GET /api/driver/receipt-health` for the `staleReceiptJobs` summary. This returns counts for queued jobs that reference missing captures.

**Recommendation:** schedule `npm run cleanup-receipt-queue` via cron (daily or weekly) and alert on non-zero `staleReceiptJobs.stale` to catch drift early.

### Store normalization backfill (storeNumber + phoneNormalized)

Normalize existing Store records so receipt matching uses consistent store numbers and normalized phones.

**Dry run (recommended first):**

```
cd server
npm run backfill-store-normalization -- --dry-run
```

**Apply updates:**

```
npm run backfill-store-normalization
```

**Optional (only fill missing fields):**

```
npm run backfill-store-normalization -- --only-missing
```

### Store inventory index rebuild (productId + unmappedProductId + observedAt)

When updating StoreInventory index definitions (such as partial unique indexes for productId or unmappedProductId, or the observedAt sort index), rebuild indexes during a low-traffic window to align MongoDB with the current schema.

**Rebuild indexes (script):**

```
cd server
npm run rebuild-store-inventory-indexes
```

## Tech Stack

- MongoDB (database)
- Stripe (payments)
- Cloudinary (media)
- (Potential) Socket.io (realtime)
- (Potential) Twilio (SMS/phone)
---


## API Authentication & Cookie Handling

The frontend does not read cookies directly; the browser attaches them automatically to API requests when `credentials: 'include'` is set. Removing this option will break authentication.

**Recommended:** All API requests should go through a shared `apiFetch()` wrapper that always sets `credentials: 'include'`.

## Usage & Project Purpose

NinpoSnacks is a delivery-first snack business with integrated Michigan 10¢ bottle return service. This system manages product delivery, deposit returns, and wallet credits, with strict backend authority for all financial and inventory operations. See [GEMINI.md](GEMINI.md) for system contract and [GLOSSARY.md](GLOSSARY.md) for all term definitions.

---

## Glossary

All roles, permissions, scanner modes, and flags are defined in [GLOSSARY.md](GLOSSARY.md). Do not redefine terms here.

* Photo capture is manual from the bottom sheet; the camera only closes after photo capture completes.

* **Bottle Return Service**: the overall service offering for Michigan deposit returns
  * **Credit Settlement** (default)
  * **Cash Settlement** (cash-out)
* **Payment Rail**: how the customer pays any remaining balance

  * **Stripe** (card)

* **Glass Handling Surcharge**: `$0.02 × glass_containers`

### 1.3 Order Types (Receipt / Admin UI)

If UI estimates disagree with server totals, **the server wins**.

---

Cash handling is **exceptional**, not default.

---

## 3. Container Value – Legal Baseline (MI-Eligible Containers)
### 4.1 Route Fee (Standardized Naming)

For the definition and rationale of "Route Fee", see [GLOSSARY.md](GLOSSARY.md).
---
For orders that include **pickup only** (no delivery):


**Configuration:** `pickupOnlyMultiplier` (default **0.5**)

#### Authoritative Rule

When `pickupOnlyMultiplier` is enabled for a Pickup-Only Order, the multiplier applies to **all route-level logistics charges**, including:

* `effective_route_fee = base_route_fee × pickupOnlyMultiplier`
* `effective_distance_fee = base_distance_fee × pickupOnlyMultiplier`

Distance is calculated **one-way from operator location to customer address**.

#### Distance Bands

#### Band Application Rule (Authoritative)

Distance fee bands are applied based on **absolute trip distance**, after excluding the included threshold (3.0 miles).
Distance = 12.8 miles → rounded down to 12.8
Included miles = 3.0
Charged miles in 4.0–10.0 band = 7.0 miles
```

Distance fees may be offset or waived based on tier rules.

#### 4.3.X Origin / Hub Configuration

Distance is measured from the **hub origin point** (operator location).

Hub coordinates must be configured using **one** of the following sources:

1. **AppSettings** (recommended)

   * `hubLat`
   * `hubLng`

2. **Environment variables** (deployment fallback)

   * `HUB_LAT`
   * `HUB_LNG`

If hub coordinates are missing, distance resolution must fail with:

* `HUB_NOT_CONFIGURED`
* Message: `Hub coordinates are not configured.`

---

## 5. Customer Tiers (Documented vs Hidden)

### 5.1 Public / Documented Tiers

These tiers must be documented clearly in code and internal docs:

* **Common**
* **Bronze**
* **Silver**
* **Gold**

Each tier defines:

* Whether wallet credits may offset logistics fees
* Eligibility for cash settlement
* Any fee reductions

---



### 5.2 Tier Qualification Requirements (Final Balanced Version)

Tier advancement is primarily based on completed orders. Minimum lifetime product spend thresholds exist to ensure fair use and system sustainability.

#### Common (Default)

- ✅ Account created
- ✅ Email, address, and username required
- ❌ No phone, ID, or full legal name required
- No minimum spend

#### Bronze

- ✅ ≥ 25 completed orders
- ✅ ≥ $250 lifetime product spend
- ✅ Email + address verified
- ❌ No phone or ID required
- ❌ Full legal name not required

*Why $250: $10/order baseline. Blocks micro-order abuse. Still very reachable.*

#### Silver

- ✅ ≥ 50 completed orders
- ✅ ≥ $600 lifetime product spend
- ✅ Phone verified
- ✅ All Bronze requirements

*Why $600: $12/order average. Small gap from Bronze. Aligns with “regular customer” economics.*

#### Gold

- ✅ ≥ 100 completed orders
- ✅ ≥ $1,500 lifetime product spend
- ✅ Photo ID verified
- ✅ Full legal name provided
- ✅ All Silver requirements

*Why $1,500: $15/order average. This is the minimum that justifies: 30% route discount, cash payout eligibility, higher support cost. Gold remains meaningful but not impossible.*

#### Secret Platinum (Invite Only)

- 🔐 Owner-assigned only
- ✅ All Gold requirements
- ✅ Verified loyalty, trust, or in-person relationship

---

### 5.3 Tier Demotion & Review Rules

Tiers are not permanent entitlements. Demotion occurs one tier at a time and is automatic when policy thresholds are met. The owner may manually demote or freeze a tier at any time.

**Demotion triggers include:**

- Prolonged inactivity (no completed orders in 180 days)
- LifetimeProductSpend falling below a tier’s retention threshold
- Loss of required verification (phone or photo ID)
- Abuse, fraud, or excessive refunds

---

### 5.4 Green Program Definition

The Green Program is a manual support program for low-income or unhoused individuals who primarily perform local bottle returns. It is not a tier and does not represent loyalty, trust, or profitability.

**Green Program characteristics:**
- Assigned manually by the owner
- Not earned through orders or spend
- Does not auto-advance to other tiers
- Route Fee and Distance Fee may be waived within defined caps
- Users in Green Program do not earn loyalty points
- Green Program status may be revoked or adjusted manually at any time

Green Program exists to support accessibility and sustainability goals without compromising the tier system or business margins.

---

### 5.3 Route Fee Discounts by Tier (Promotional)

Tiers may receive discounts on the **Route Fee only** (see [GLOSSARY.md](GLOSSARY.md) for tier definitions).

Discounts:

* Apply to **Delivery Orders** and **Pickup-Only Orders**
* Do **not** apply to Distance Fee
* Do **not** apply to any cash settlement fees (Cash Handling Fee, Glass Handling Surcharge)

| Tier   | Route Fee Discount |
| ------ | -----------------: |
| Common |                 0% |
| Bronze |                10% |
| Silver |                20% |
| Gold   |                30% |

Discount math (authoritative):

* `discounted_route_fee = base_route_fee × pickup_only_multiplier × (1 − tier_route_fee_discount)`

---

### 5.4 Hidden / Special Tiers

#### Secret Platinum

* 🔐 Invite-only / hand-selected by owner
* ✅ All Gold requirements
* ✅ Verified loyalty, trust, or in-person relationship
* Hidden tier (not shown publicly). Internal tier identifier is `PLATINUM`, but docs use “Secret Platinum” to limit awareness.

Platinum may receive operator-controlled waivers via management settings, including:

* Route Fee discounts or full waiver
* Distance Fee waiver
* Cash Handling Fee bypass (cash settlement)
* Glass Handling Surcharge bypass (cash settlement)

> Platinum users should only ever pay for products unless the operator explicitly chooses otherwise.

#### Green Tier (Active)

* **$1 flat Route Fee**
* **No Distance Fee** regardless of mileage
* Bottle return credits may be used for:

  * Products
  * Route Fee

---

## 6. Wallet Credits – Core Rules (Tier-Driven)

Wallet credits originate from bottle return **Credit Settlement** and are governed strictly by **tier rules**.

There is **no global or user-selectable credit priority**.

Credits may only be applied to parts of an order that the customer’s tier explicitly allows.

---

### 6.1 Universal Credit Properties

* Credits are denominated in USD
* Credits are stored off-Stripe
* Credits never represent cash
* Credits reduce card processing exposure

---

### 6.2 Credit Application by Tier (Authoritative)

| Tier            | Credits → Products | Credits → Route Fee |          Credits → Distance Fee          |
| --------------- | :----------------: | :-----------------: | :--------------------------------------: |
| Common / Bronze |          ✅         |          ❌          |                     ❌                    |
| Silver          |          ✅         |          ✅          |                     ✅                    |
| Gold            |          ✅         |          ✅          |                     ✅                    |
| Secret Platinum |          ✅         |          ✅          |                     ✅                    |
| Green (active)  |          ✅         |          ✅          | ❌ *(Distance Fee is always $0 in Green)* |

Credits may:

* Partially offset eligible charges
* Fully cover eligible charges (if balance allows)

**Principle:** Credits automatically apply **only within the tier’s allowed scope**. Any charges outside that scope are untouchable by credits and must be paid normally.

---

## 7. Bottle Return Service – Credit Settlement (Default)

### 7.1 Purpose

This is the **primary and encouraged** settlement path.

### 7.2 How It Works

1. Customer returns containers
2. System calculates value:

   * `deposit_value = container_count × $0.10`
3. Customer chooses:

   * Apply credit to current cart
   * Store credit in wallet

### 7.3 Fees

* **No container-level fees**
* **No Cash Handling Fee**
* **No Glass Handling Surcharge**

> Deposit value must be preserved in full when settled as credit.

### 7.4 Logistics Fees

* Route Fee applies (Delivery Order or Pickup-Only Order)
* Distance Fee applies if triggered (unless waived by tier)

---

## 8. Bottle Return Service – Cash Settlement (Cash-Out, Discouraged)

### 8.1 Purpose

Cash settlement exists as a **legal and operational exception**, not a primary path.

### 8.2 Eligibility

* **Gold**
* **Secret Platinum**
* **Green (active)**

### 8.3 Settlement Rules

* Cash only
* No Stripe payouts

### 8.4 Cash Settlement Fees (Per-Container)

#### Cash Handling Fee

* **$0.02 × total containers**
* Applies **only** when the customer chooses cash
* Covers counting, storage, compliance, and cash risk

#### Glass Handling Surcharge

* **$0.02 × glass containers**
* Applies **only** to glass
* Cash settlement only

### 8.5 Formula Example

```
Gross deposit value = containers × $0.10
Cash handling fee = containers × $0.02
Glass handling surcharge = glass_containers × $0.02
Net cash = Gross deposit value − (cash handling fee + glass handling surcharge)
```

### 8.6 Logistics

* Route Fee applies
* Distance Fee applies (charged once per order)

Cash settlement is **discouraged but allowed**.

---

## 9. Stripe (Payment Rail) vs Settlement Modes

### 9.1 Settlement Paths vs Payment Rails (Critical Distinction)

The system has **two settlement paths** for bottle returns:

1. **Credit Settlement** (wallet / cart credit)
2. **Cash Settlement** (cash-out)

These describe **how bottle value is settled**, not how money is technically moved.

**Stripe is not a settlement path.** Stripe is a **payment rail** used only when a card payment is required.

---

### 9.2 Stripe Usage Rules

* Stripe processes **card payments only**

Stripe is used when:

* Product totals
* Route Fee
* Distance Fee
* Any remaining payable balance

are not fully covered by wallet credits.

Stripe is **never** used for:

* Bottle value itself
* Wallet credit creation
* Cash settlement payouts

---

## 10. Receipt Wording & Billing Invariants (No Double Charging)

### 10.1 Route Billing Unit

Route Fees are billed **per customer order**, not per driver trip.

* Each order generates its own Route Fee
* Multiple orders on one driver run are still billed separately

This avoids cross-customer subsidy and simplifies accounting.

---

### 10.2 Combined Delivery + Pickup (Single Order)

If an order includes:

* Product delivery **and**
* Bottle return pickup

Then:

* **One Route Fee** applies
* **One Distance Fee** applies (unless tier-waived)

**Do not stack Route Fees** (e.g., no separate “delivery fee” + “pickup fee”).

---

### 10.3 Separate Orders (Expected Scenario)

If a customer places:

1. A product delivery order, and later
2. A separate bottle return pickup order

Then:

* Each order has its own Route Fee
* This is **not** double charging; it reflects two distinct routes

---

### 10.4 Receipt Wording (Required)

To avoid confusion, receipts must label charges clearly:

* **Route Fee — Delivery Order**
* **Route Fee — Pickup-Only Order**
* **Distance Fee** (if applicable)
* **Cash Handling Fee** (cash settlement only)
* **Glass Handling Surcharge** (cash settlement only)

Receipts should never display:

* “Processing fee” (except Cash Handling Fee)
* “Bottle fee”
* Per-container deductions outside cash settlement

---

## 11. Points (Loyalty) – Earn & Redeem (Non-Cash Credits)

Points are a **loyalty mechanism** that rewards product purchases. Points are **not money** and are not governed by Stripe.

### 11.1 Eligibility

**Points are earned by:**

* **Common**
* **Bronze**
* **Silver**
* **Gold**

**Points are not earned by:**

* **Secret Platinum**
* **Green (future)**

### 11.2 Earning Rate (Products Only)

Points are earned on **product purchases only** (not Route Fee, Distance Fee, Cash Handling Fee, or Glass Handling Surcharge).

Earn rate by tier:

* **Common / Bronze:** `1.0 points per $1.00` of product subtotal
* **Silver:** `1.2 points per $1.00` of product subtotal
* **Gold:** `1.5 points per $1.00` of product subtotal

Points are earned with **cent-level precision**:

* If a customer buys `$0.99` of products, they earn `0.99` points (multiplied by tier rate).

#### Points Storage Rule (Authoritative)

Points are stored as **integer point-units** to avoid floating point drift:

* `100 point-units = 1.00 points`

Example:

* `$0.99` products at `1.0x` earns `99 point-units` (= `0.99` points)

#### Points Earned vs Wallet Credits (Authoritative)

Points are earned only on **product subtotal paid outside the wallet**.

* Product subtotal covered by **wallet credits** does **not** generate points.

### 11.3 Redemption (Points → Wallet Credits)

Bronze, Silver, and Gold may redeem points into **Wallet Credits** using this conversion:

* `100 points = $1.00 wallet credit`

Redemption minimums:

* **Bronze:** minimum `500 points` ($5.00)
* **Silver:** minimum `250 points` ($2.50)
* **Gold:** no minimum

Redeemed credits are stored in the **same wallet** as bottle return credits.

### 11.4 Non-Cash Rule (Critical)

Credits created via points redemption:

* **May be used like Wallet Credits (tier-scoped)**
* **May NOT be redeemed or paid out as cash**

The **only** credits that may be converted to cash are the credits that originate from **MI bottle deposits** and are settled via **Cash Settlement**.

---

## 12. System Invariants (Must Not Drift)

1. Michigan container value is fixed at $0.10
2. Bottle returns are a **service**
3. Two settlement paths only:

   * Credit (default)
   * Cash settlement (exception)
4. Every delivery and pickup has a Route Fee by default
5. Tier rules govern all exceptions
6. Cash handling is discouraged
7. **Cancel before capture/delivery must release authorized wallet credits and restock inventory immediately.**

---

## 13. Why the System Is Designed This Way

* Encourages sustainable behavior without penalizing small returns
* Preserves dignity by defaulting to credit, not cash friction
* Reduces payment processing costs
* Keeps logistics economically viable
* Allows operator control over exceptional users and scenarios

---

**This document is the operational truth.**
If code behavior conflicts with this spec, the code is wrong.
