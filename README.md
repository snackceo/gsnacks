# NinpoSnacks – Internal Spec: Payments, Bottle Return Service, and Fees

> **Audience:** Operators & Developers only
> **Visibility:** Not customer-facing
> **Purpose:** This document explains *how the system is intended to run*, including business rationale, tier rules, and exact payment math. This is an authoritative reference and should be treated as a contract.

---

## 1. Naming Standard (Do Not Deviate)

This document uses **one unified vocabulary**. Code, admin UI, receipts, and support scripts must use these exact terms.

### 1.1 Core Concepts

* **Bottle Return Service**: the overall service offering for Michigan deposit returns
* **MI-Eligible Container**: an eligible refundable container under Michigan’s 10¢ deposit program
* **Settlement Mode**: how container value is settled

  * **Credit Settlement** (default)
  * **Cash Settlement** (cash-out)
* **Payment Rail**: how the customer pays any remaining balance

  * **Stripe** (card)

### 1.2 Fees (Two Categories Only)

#### A) Route Fees *(route-level, never per-container)*

* **Route Fee**: base fee for dispatching and operating a vehicle (applies once per order)
* **Distance Fee**: incremental mileage charge after the included threshold (applies once per order)

#### B) Cash Settlement Fees *(per-container, cash-out only)*

* **Cash Handling Fee**: `$0.02 × total_containers`
* **Glass Handling Surcharge**: `$0.02 × glass_containers`

### 1.3 Order Types (Receipt / Admin UI)

* **Delivery Order**: product delivery (may also include bottle pickup)
* **Pickup-Only Order**: bottle pickup with no products

> **Forbidden synonyms** in UI/receipts: delivery fee, pickup fee, processing fee (except “Cash Handling Fee”), bottle fee, return fee.

---

## 2. Business Overview

NinpoSnacks is a **delivery-first snack business** that also operates a **Michigan 10¢ bottle return service** as part of its logistics system.

Bottle returns are **a service**, not a giveaway. The system is designed to:

* Encourage reuse and legal deposit recovery
* Reduce Stripe/card processing volume via credits
* Discourage cash handling while still allowing it under strict rules

Cash handling is **exceptional**, not default.

---

## 3. Container Value – Legal Baseline (MI-Eligible Containers)

* **Each Michigan-eligible container = $0.10 (by law)**
* This value is **fixed** and must not be altered
* No promotions, multipliers, or dynamic pricing apply

**Deposit value must never be reduced except by the Cash Settlement Fees defined in this spec (Cash Handling Fee and Glass Handling Surcharge) during Cash Settlement.**

---

## 4. Global Logistics Fees (Applies System-Wide)

### 4.1 Route Fee (Standardized Naming)

There is **one base fee for dispatching and operating a vehicle**, regardless of what is happening on that route.

**Locked term:** **Route Fee**

The Route Fee **always includes product delivery** when a delivery occurs.

* The Route Fee applies to:

  * Product delivery
  * Bottle return pickup
  * Combined product delivery + bottle pickup
* The Route Fee is charged **once per order**
* There is no separate base “delivery fee” or “pickup fee”

> Rationale: the primary cost is moving the vehicle, not the specific action performed.

---

### 4.2 Pickup-Only Orders (Reduced Route Rate)

For orders that include **pickup only** (no delivery):

* The **Route Fee** still applies
* The **Distance Fee** still applies (if triggered)
* A **Pickup-Only Discount** may be applied via configuration using a multiplier

**Configuration:** `pickup_only_multiplier` (default **0.5**)

#### Authoritative Rule

When `pickup_only_multiplier` is enabled for a Pickup-Only Order, the multiplier applies to **all route-level logistics charges**, including:

* Route Fee
* Distance Fee

In other words:

* `effective_route_fee = base_route_fee × pickup_only_multiplier`
* `effective_distance_fee = base_distance_fee × pickup_only_multiplier`

This is a **route-level discount**, not a container-based fee.

> Note: Pickup-Only Orders do not include product delivery. The multiplier exists to reduce the overall logistics charge relative to a Delivery Order.

---

### 4.3 Distance Fee (Tiered, Per Mile After Threshold)

Distance is calculated **one-way from operator location to customer address**.

* Distance is measured in **0.1 mile increments** and always **rounded down** to the nearest **0.1 mile**

The first **3.0 miles are included** in the Route Fee.

#### Distance Bands

| Band (absolute distance) | Fee Applied    |
| ------------------------ | -------------- |
| 0.0–3.0 miles            | Included       |
| 4.0–10.0 miles           | $0.50 per mile |
| 11.0–20.0 miles          | $0.75 per mile |
| 21.0+ miles              | $1.00 per mile |

#### Band Application Rule (Authoritative)

Distance fee bands are applied based on **absolute trip distance**, after excluding the included threshold (3.0 miles).

> Bands apply based on *absolute distance from origin*, not on “billable miles” after subtraction.

Example:

```
Distance = 12.8 miles → rounded down to 12.8
Included miles = 3.0
Charged miles in 4.0–10.0 band = 7.0 miles
Charged miles in 11.0–12.8 band = 2.8 miles
Distance Fee = 7.0×$0.50 + 2.8×$0.75
```

Distance fees may be offset or waived based on tier rules.

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

### 5.2 Hidden / Special Tiers

#### Secret Platinum

* Mentioned *vaguely* in documentation
* Full logistics fee waiver **at operator discretion**
* Waiver must be configurable in management settings

> Platinum users should only ever pay for products unless the operator explicitly chooses otherwise.

#### Green Tier (Future)

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
| Green (future)  |          ✅         |          ✅          | ❌ *(Distance Fee is always $0 in Green)* |

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
* **Green (future)**

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

## 11. System Invariants (Must Not Drift)

1. Michigan container value is fixed at $0.10
2. Bottle returns are a **service**
3. Two settlement paths only:

   * Credit (default)
   * Cash settlement (exception)
4. Every delivery and pickup has a Route Fee by default
5. Tier rules govern all exceptions
6. Cash handling is discouraged

---

## 12. Calculation Order & Rounding Rules (Implementation Contract)

### 12.1 Calculation Order (Authoritative)

All order totals MUST be computed in this order:

1. Compute **Product Subtotal**
2. Compute **Route Fee** and **Distance Fee**
3. If **Pickup-Only Order**, apply `pickup_only_multiplier` to Route Fee and Distance Fee
4. Apply any **tier/operator waivers** (if applicable)
5. Apply **wallet credits** (tier-scoped)
6. Any remaining payable balance is charged via **Stripe**

### 12.2 Currency Rounding Rule (Authoritative)

All monetary amounts are stored and processed in **USD cents**, and all computed totals MUST be rounded to the nearest cent at the **final order total**.

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
