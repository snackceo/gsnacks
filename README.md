# NinpoSnacks – Internal Spec: Payments, Bottle Return Service, and Fees

> **Audience:** Operators & Developers only
> **Visibility:** Not customer-facing
> **Purpose:** This document explains *how the system is intended to run*, including business rationale, tier rules, and exact payment math. This is an authoritative reference and should be treated as a contract.

---

## 1. Naming Standard (Do Not Deviate)

This document uses **one unified vocabulary**. Code, admin UI, receipts, and support scripts must use these exact terms.

### Core Concepts

* **Bottle Return Service**: the overall service offering for Michigan deposit returns
* **MI-Eligible Container**: an eligible refundable container under Michigan’s 10¢ deposit program
* **Settlement Mode**: how container value is settled

  * **Credit Settlement** (default)
  * **Cash Settlement** (cash-out)
* **Payment Rail**: how the customer pays any remaining balance

  * **Stripe** (card)

### Fees (Two Categories Only)

**A) Route Fees (route-level, never per-container)**

* **Route Fee**: base fee for dispatching and operating a vehicle (applies once per order)
* **Distance Fee**: incremental mileage charge after the included threshold (applies once per order)

**B) Cash Settlement Fees (per-container, cash-out only)**

* **Cash Handling Fee**: $0.02 × total containers
* **Glass Handling Surcharge**: $0.02 × glass containers

### Order Types (Receipt / Admin UI)

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

## 2. Container (Bottle/Can) Value – Legal Baseline (MI-Eligible Containers)

* **Each Michigan-eligible container = $0.10 (by law)**
* This value is **fixed** and must not be altered
* No promotions, multipliers, or dynamic pricing apply

The *only* time container value is reduced is when a customer **explicitly chooses cash-out**, in which case legally permitted service fees apply.

---

## 3. Global Logistics Fees (Applies System-Wide)

### Route Fee Model (Standardized Naming)

There is **one base fee for dispatching and operating a vehicle**, regardless of what is happening on that route.

**Locked term:** **Route Fee**

The Route Fee **always includes product delivery** when a delivery occurs.

* The Route Fee applies to:

  * Product delivery
  * Bottle return pickup
  * Combined product delivery + bottle pickup
* The Route Fee is charged **once per route**
* There is no separate base “delivery fee” or “pickup fee”

> Rationale: the primary cost is moving the vehicle, not the specific action performed.

---

### Distance Fee (Tiered, Per Mile After Threshold)

Distance is calculated **one-way from operator location to customer address**.

* Distance is computed to the **nearest 0.1 mile**
* Distance is always **rounded down**

The first **3.0 miles are included** in the Route Fee.

Additional distance fees are applied **once per route** using tiered bands:

| Distance Band   | Fee Applied    |
| --------------- | -------------- |
| 4.0–10.0 miles  | $0.50 per mile |
| 11.0–20.0 miles | $0.75 per mile |
| 21.0+ miles     | $1.00 per mile |

Example:

```
Distance = 12.8 miles → rounded down to 12.8
Billable distance = 12.8 − 3.0 = 9.8 miles
7.0 miles × $0.50 + 2.8 miles × $0.75
```

Distance fees may be offset or waived based on tier rules.

---|---|
| 0–3 miles | Included |
| 4–10 miles | $0.50 per mile |
| 11–20 miles | $0.75 per mile |
| 21+ miles | $1.00 per mile |

Distance fees may be waived or offset by tier rules.

---

### Pickup-Only Routes

For routes that include **pickup only** (no delivery):

* The **Route Fee** still applies
* A **Pickup-Only Discount** may be applied via configuration (e.g. 50%)

This is a **route-level discount**, not a container-based fee.

---

## 4. Customer Tiers (Documented vs Hidden)

### Public / Documented Tiers

These tiers must be documented clearly in code and internal docs:

* **Common**
* **Bronze**
* **Silver**
* **Gold**

Each tier defines:

* Whether wallet credits may offset logistics fees
* Eligibility for cash-out
* Any fee reductions

### Hidden / Special Tiers

* **Secret Platinum**

  * Mentioned *vaguely* in documentation
  * Full logistics fee waiver **at operator discretion**
  * Waiver must be configurable in management settings

* **Green Tier (Future)**

  * $1 flat delivery/pickup fee
  * Bottle return credits may be used for:

    * Products
    * Delivery fees
    * Distance fees

---

## 5. Wallet Credits – Core Rules (Tier-Driven)

Wallet credits originate from bottle return **credit settlement** and are governed strictly by **tier rules**. There is **no global or user-selectable credit priority**.

Credits may only be applied to parts of an order that the customer’s tier explicitly allows.

---

### Universal Credit Properties

* Credits are denominated in USD
* Credits are stored off-Stripe
* Credits never represent cash
* Credits reduce card processing exposure

---

### Credit Application by Tier (Authoritative)

#### Common & Bronze

* Credits may apply to **products only**
* Credits may NOT apply to Route Fee or Distance Fee
* If credit exceeds product subtotal:

  * Remaining balance stays in wallet

---

#### Silver & Gold

* Credits may apply to the **entire order**, including:

  * Products
  * Delivery fee
  * Pickup fee
  * Distance fee
* Order may be fully covered if sufficient credit exists

---

#### Secret Platinum

* Same credit scope as Silver & Gold
* Operator-controlled waivers via management settings may include:

  * Route Fee discounts or full waiver
  * Distance Fee waiver
  * Cash Handling Fee bypass
  * Glass Handling Surcharge bypass

> Platinum users should only ever pay for products unless the operator explicitly chooses otherwise.

---

#### Green (Future)

* Flat **$1 Route Fee** per order
* **No distance fee** regardless of mileage
* Credits may apply to:

  * Products
  * Route Fee

> Rationale: Green tier is intended for low-income access and assumes shorter travel distances.

---

### Credit Application Principle

Credits automatically apply **only within the tier’s allowed scope**. Any charges outside that scope are untouchable by credits and must be paid normally.

----|----|----|----|
| Common / Bronze | ✅ | ❌ | ❌ |
| Silver | ✅ | ✅ | ✅ |
| Gold | ✅ | ✅ | ✅ |
| Secret Platinum | ✅ | ✅ | ✅ |
| Green (future) | ✅ | ✅ | ✅ |

Credits may:

* Partially offset a cart
* Fully cover a cart (if balance allows)

---

## 7. Bottle Return Service – Credit Settlement (Default)

### Purpose

This is the **primary and encouraged** settlement path.

### How It Works

1. Customer returns containers
2. System calculates value:

   * `container_count × $0.10`
3. Customer chooses:

   * Apply credit to current cart
   * Store credit in wallet

### Fees

* **No container-level fees**
* **No cash handling fee**
* **No glass handling surcharge**

> Deposit value must be preserved in full when settled as credit.

### Logistics Fees

#### Return Pickup Fee (Reduced Route Rate)

* Applied when an order includes **pickup only** (no delivery)
* Calculated as:

  * `standard_delivery_fee × pickup_only_multiplier`
* Default multiplier: **0.5** (configurable)

#### Distance Fee

* Applies if triggered
* Charged **once per route**

(unless waived by tier)

### Bottle-Only Orders

Customers may request **bottle return pickup without purchasing products**:

* Credits are stored directly in wallet
* Pickup/distance fees still apply (tier rules apply)

---

## 8. Bottle Return Service – Cash Settlement (Cash-Out, Discouraged)

### Purpose

Cash-out exists as a **legal and operational exception**, not a primary path.

### Eligibility

* **Gold**
* **Secret Platinum**
* **Green (future)**

### Settlement Rules

* Cash only
* No Stripe payouts

### Cash-Out Fees (Per-Container)

#### Cash Handling Fee

* **$0.02 × total containers**
* Applies **only** when the customer chooses cash
* Covers counting, storage, compliance, and cash risk

#### Glass Handling Surcharge

* **$0.02 × glass containers**
* Applies **only** to glass
* Cash-out only

### Formula Example

```
Base value = containers × $0.10
Cash handling fee = containers × $0.02
Glass handling surcharge = glass_containers × $0.02
Net cash = Base value − (cash handling fee + glass handling surcharge)
```

### Logistics

* Return Pickup Fee applies
* Distance fee applies (charged once per route)
* Delivery fee applies if paired with delivery

Cash-out is **discouraged but allowed**.

---

## 9. Stripe (Payment Rail) vs Settlement Modes

### Settlement Paths vs Payment Rails (Critical Distinction)

The system has **two settlement paths** for bottle returns:

1. **Credit Settlement** (wallet / cart credit)
2. **Cash Settlement** (cash-out)

These describe **how bottle value is settled**, not how money is technically moved.

**Stripe is not a settlement path.** Stripe is a **payment rail** used only when a card payment is required.

---

### Stripe Usage Rules

* Stripe processes **card payments only**

* Stripe is used when:

  * Product totals
  * Logistics fees (delivery, pickup, distance)
  * Any remaining payable balance
    are not fully covered by wallet credits

* Stripe is **never** used for:

  * Bottle value itself
  * Wallet credit creation
  * Cash-out payouts

---

### Credit Settlement + Stripe Example

1. Customer returns bottles
2. Bottle value becomes wallet credit
3. Credits reduce cart total
4. Any remaining balance → Stripe

---

### Cash Settlement (No Stripe)

1. Customer returns bottles
2. Cash handling and glass handling fees applied
3. Net value paid **in cash**
4. Stripe is not involved

---

## 10. Billing Unit and Receipt Wording (No Double Charging)

### Route Billing Unit

Route Fees are billed **per customer order**, not per driver trip.

* Each order generates its own Route Fee
* Multiple orders on one driver run are still billed separately

This avoids cross-customer subsidy and simplifies accounting.

---

### Combined Delivery + Pickup (Single Order)

If an order includes:

* Product delivery **and**
* Bottle return pickup

Then:

* **One Route Fee** applies
* **One Distance Fee** applies (unless tier-waived)

---

### Separate Orders (Expected Scenario)

If a customer places:

1. A product delivery order, and later
2. A separate bottle return pickup order

Then:

* Each order has its own Route Fee
* This is **not** double charging; it reflects two distinct routes

---

### Receipt Wording (Required)

To avoid confusion, receipts must label charges clearly:

* **Route Fee – Delivery**
* **Route Fee – Bottle Pickup**
* **Distance Fee** (if applicable)

Receipts should never display:

* “Processing fee”
* “Bottle fee”
* Per-container deductions outside cash settlement

---

### Combined Delivery + Pickup Orders

If a route includes:

* Product delivery **and**
* Bottle pickup

Then:

* Delivery fee applies (once)
* Pickup fee does **not** stack as a second delivery fee
* Distance fee applies once

---

### Pickup-Only Orders

If a route includes:

* Bottle pickup only

Then:

* **Return Pickup Fee (Reduced Route Rate)** applies
* Distance fee applies once

---

## 9. System Invariants (Must Not Drift)

1. Michigan container value is fixed at $0.10
2. Bottle returns are a **service**
3. Two settlement paths only:

   * Credit (default)
   * Cash-out (exception)
4. Every delivery and pickup has a fee by default
5. Tier rules govern all exceptions
6. Cash handling is discouraged

---

## 10. Why the System Is Designed This Way

* Encourages sustainable behavior without penalizing small returns
* Preserves dignity by defaulting to credit, not cash friction
* Reduces payment processing costs
* Keeps logistics economically viable
* Allows operator control over exceptional users and scenarios

---

**This document is the operational truth.**
If code behavior conflicts with this spec, the code is wrong.
