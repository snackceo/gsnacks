# Multi-Store Shopping & Batching System

## Overview

This system enables intelligent multi-store shopping with delivery batching and route optimization for cost-effective fulfillment.

## Architecture Components

### 1. Data Models

#### Store (`server/models/Store.js`)
- **Fields**: name, phone, address, location (lat/lng), storeType, reliabilityScore, outOfStockRate
- **Store Types**: walmart, kroger, aldi, target, meijer, hub
- **Purpose**: Physical store locations with routing coordinates

#### StoreInventory (`server/models/StoreInventory.js`)
- **Fields**: storeId, productId, cost, markup, available, stockLevel
- **Purpose**: Per-store product availability and pricing
- **Index**: Compound index on (storeId, productId) for fast lookups

#### Product (Enhanced)
- **New Field**: `handlingPoints` - Weighted capacity score
  - Normal item: 1
  - Bulky item (cereal, chips multipack): 2
  - Heavy item (milk gallon, 12-pack): 3
  - Very heavy (24/40-pack water): 6-10

#### Batch (`server/models/Batch.js`)
- **Fields**: batchId, status, orderIds, storeStops, customerStops, capacity metrics, route details
- **Purpose**: Groups orders for shared delivery runs
- **Capacity Constraints**:
  - Max batch load: 45 handling points
  - Max heavy points: 20 (prevents all-water batches)
  - Max customers: 4
  - Delivery window: 30 minutes
  - Zone radius: 5 miles

### 2. Core Services

#### Batching Logic (`server/utils/batching.js`)
```javascript
// Calculate order capacity
const { totalLoad, heavyPoints } = await calculateOrderLoad(items);

// Find eligible batch
const batch = await findEligibleBatch({
  items, deliveryAddress, createdAt, storeIds
});

// Create new batch or add to existing
if (batch) {
  await addOrderToBatch(batch.batchId, orderData);
} else {
  await createBatch(orderData);
}
```

**Batching Rules** (all must be true):
1. Same run window (within 30 minutes)
2. Same store plan or overlapping stores
3. Same delivery zone (within 5 mile radius)
4. Batch capacity not exceeded
5. Max 4 customers per batch

#### Store Routing (`server/utils/storeRouting.js`)
```javascript
// Find cheapest stores for cart
const { storePlans, unfulfilled } = await findCheapestStores(cartItems);

// Optimize (consolidate to fewer stores if cost-effective)
const optimized = await optimizeStoreSelection(fulfillment);

// Calculate multi-waypoint route (hub → stores → customers)
const route = await calculateMultiStopRoute(storeStops, customerAddresses);
```

**Store Selection Algorithm**:
1. Find all stores carrying each product
2. Pick cheapest store per item
3. Check if primary store (most items) can fulfill everything at <15% price difference
4. Consolidate to single store if possible, otherwise use multi-store plan

#### Pricing System – Single Source of Truth (`server/utils/deliveryFees.js`)

**All pricing calculations now route through centralized `getDeliveryOptions()`** to prevent fee drift and bugs.

**Public API**:
- `getDeliveryOptions({ orderType, tier, distanceMiles, items, productsByFrontendId })` → Returns all fees
- `applyTierDiscount({ baseRouteFee, orderType, tier, ... })` → Applies tier-based discounts to route fee

**Used by**:
- `POST /api/shopping/checkout-preview` – customer price preview
- `POST /api/shopping/quote` – delivery options
- `POST /api/payments/quote` – fee estimate
- `POST /api/payments/create-session` – order creation & payment
- `POST /api/payments/credits` – credit-based checkout

**Implementation Details**:
- Route fees: Tier discounts (Bronze 10%, Silver 20%, Gold 30%, Platinum free, Green $1)
- Distance fees: 3-mile included; then $0.50/$0.75/$1.00 per mile in bands; Green tier $0
- Heavy items: $1.50 per unit
- Large orders: $0.30 per item over 10
- All fields calculated fresh; pricingLock signature overrides if valid and not expired

**Deprecated** (do not use):
- `calculateRouteFee()` → use `applyTierDiscount()` from deliveryFees
- `calculateDistanceFee()` → use `getDeliveryOptions()` from deliveryFees
- `getRouteFeeConfig()`, `getDistanceFeeConfig()`, `getHandlingFeeConfig()` → config baked into deliveryFees
- `calculateLargeOrderFee()`, `calculateHeavyItemFee()` → use `getDeliveryOptions()` from deliveryFees

These old functions remain in `payments.js` for backward compatibility but should not be called; all new code routes through `deliveryFees.js`.

### 3. API Endpoints

#### POST `/api/shopping/checkout-preview` ⭐ Main Endpoint
**Purpose**: Calculate route from hub → stores → customer and show pricing preview

**Request**:
```json
{
  "cartItems": [
    { "productId": "...", "quantity": 2 },
    { "productId": "...", "quantity": 1 }
  ],
  "deliveryAddress": {
    "lat": 42.3314,
    "lng": -83.0458
  }
}
```

**Response**:
```json
{
  "ok": true,
  "items": [
    { "name": "Coke 12pk", "quantity": 2, "price": 5.99, "total": 11.98 },
    { "name": "Doritos", "quantity": 1, "price": 3.49, "total": 3.49 }
  ],
  "listAmount": 15.47,
  "fees": {
    "routeFee": 3.49,
    "distanceFee": 2.50,
    "largeOrderFee": 0.00,
    "heavyItemFee": 3.00,
    "total": 8.99
  },
  "total": 24.46,
  "deliveryOptions": {
    "standard": {
      "type": "standard",
      "eta": "55 minutes",
      "description": "Direct delivery - fastest",
      "fees": 8.99,
      "total": 24.46
    },
    "batch": {
      "type": "batch",
      "eta": "85-145 minutes",
      "description": "Grouped delivery - may take longer but same price",
      "fees": 8.99,
      "total": 24.46,
      "batchId": "B-20260120-001",
      "customersInBatch": 2
    }
  },
  "route": {
    "distance": 8.5,
    "duration": 25
  },
  "capacity": {
    "orderLoad": 18,
    "heavyPoints": 6
  },
  "tier": {
    "name": "GOLD",
    "discount": 0.3
  },
  "stores": [
    { "name": "Walmart Supercenter", "type": "walmart" }
  ]
}
```

**What Customer Sees**:
- Item list with YOUR website prices (Product.price)
- Fee breakdown (route, distance, heavy, large order)
- Total amount
- Delivery options (standard vs batch)
- ETA for each option

**What Customer DOESN'T See**:
- Which stores you're shopping at
- Your wholesale costs (StoreInventory.cost)
- Your profit margins

#### POST `/api/ai/explain-checkout` 🤖 Gemini Explanation
**Purpose**: Explain pricing and fees in conversational English

**Request**:
```json
{
  "checkoutData": { /* entire checkout-preview response */ },
  "question": "Why is my delivery fee so high?"
}
```

**Response**:
```json
{
  "ok": true,
  "explanation": "Your delivery is 8.5 miles from our hub, which adds $2.50 in distance fees. You also have 2 heavy items (12-packs) which cost $1.50 each to handle safely. As a Gold member, you're already saving 30% on the route fee! The batch option is available if you don't mind waiting a bit longer - same price, just grouped with 2 other nearby customers.",
  "model": "gemini-2.5-flash",
  "summary": {
    "itemCount": 3,
    "listAmount": 15.47,
    "fees": 8.99,
    "total": 24.46,
    "tier": "GOLD",
    "distance": 8.5,
    "batchAvailable": true
  }
}
```

**What Gemini DOES**:
- Reads checkout preview data
- Explains fees in plain English
- Answers customer questions about pricing
- Suggests tier upgrades or batch options

**What Gemini NEVER DOES**:
- Calculate routes or fees
- Choose stores
- Make pricing decisions
- Change any numbers

#### POST `/api/shopping/find-stores`
**Purpose**: Find cheapest stores to fulfill cart (internal use)

**Request**:
```json
{
  "cartItems": [
    { "productId": "...", "quantity": 2 },
    { "productId": "...", "quantity": 1 }
  ]
}
```

**Response**:
```json
{
  "ok": true,
  "storePlans": [
    {
      "storeId": "...",
      "storeName": "Walmart Supercenter",
      "storeType": "walmart",
      "items": [...],
      "totalCost": 45.50
    }
  ],
  "unfulfilled": [],
  "consolidated": true,
  "storeCount": 1
}
```

#### POST `/api/shopping/quote` (Deprecated)
**Purpose**: Legacy endpoint - use `/checkout-preview` instead

This endpoint still exists but returns batch eligibility info without pricing details.

#### GET `/api/batches/:batchId`
**Purpose**: Check batch capacity and status

**Response**:
```json
{
  "ok": true,
  "totalLoad": 32,
  "maxLoad": 45,
  "loadPercent": 71,
  "customerCount": 3,
  "maxCustomers": 4,
  "canAddMore": true
}
```

## Implementation Workflow

### Checkout Flow

1. **Cart Review** → User adds items to cart
2. **Enter Address** → User provides delivery address
3. **Preview** → Call `/api/shopping/checkout-preview`
   - System finds fastest/cheapest stores automatically
   - Calculates route: hub → stores → customer
  - Shows items, fees, total, delivery options
  - Returns a signed `pricingLock` snapshot (payload + signature)
4. **Ask Questions** (Optional) → Call `/api/ai/explain-checkout`
   - "Why is this expensive?"
   - "What's the difference between standard and batch?"
   - Gemini explains in plain English
5. **Choose Delivery** → User picks standard or batch
6. **Confirm Order** → User confirms and pays
  - Frontend must include `pricingLock` in `POST /api/payments/create-session` (and `/api/payments/credits`)
  - Backend verifies the signature and charges exactly the previewed fees
7. **Shopping** → Driver shops stores in optimized order
8. **Delivery** → Driver delivers to customer(s)

### Order Processing

```javascript
// Frontend calls checkout-preview
const preview = await fetch('/api/shopping/checkout-preview', {
  method: 'POST',
  body: JSON.stringify({ cartItems, deliveryAddress })
});

// User sees: items, fees, total, ETA
// User confirms order

// Backend on order creation:
const orderData = {
  items: cart,
  deliveryAddress,
  createdAt: new Date()
};

// Calculate capacity
const { totalLoad, heavyPoints } = await calculateOrderLoad(items);

// Auto-assign to batch if eligible (transparent to customer)
const batch = await findEligibleBatch(orderData);

if (batch) {
  await addOrderToBatch(batch.batchId, orderData);
  order.batchId = batch.batchId;
  // Customer pays same fees, business saves time/money
}
```

## Capacity Model

### Handling Points System

Products are assigned handling points based on bulk/weight:

| Category | Points | Examples |
|----------|--------|----------|
| Normal | 1 | Single cans, small snacks, candy |
| Bulky | 2 | Cereal boxes, chip multipacks, large items |
| Heavy | 3 | Milk gallons, 12-pack sodas, juice bottles |
| Very Heavy | 6-10 | 24-pack water, 40-pack water, cases |

### Batch Capacity Calculation

```
OrderLoad = Σ (handlingPoints × quantity)
BatchLoad = Σ OrderLoad for all orders in batch

Constraints:
- BatchLoad ≤ 45
- HeavyPoints ≤ 20
- Customers ≤ 4
```

**Example Scenarios**:
- ✅ 4 customers × 10 normal items = 40 points
- ✅ 2 customers × 20 normal items = 40 points
- ✅ 3 customers × 15 normal items = 45 points
- ❌ 1 customer × 5 cases of water = 50 points (exceeds limit)

## Route Optimization

### Multi-Waypoint Routing

All routes start from hub (your warehouse) and use Google Directions API:

**Single Customer**:
```
Hub → Store1 → [Store2] → Customer
```

**Batch (Multiple Customers)**:
```
Hub → Store1 → [Store2] → Customer1 → Customer2 → Customer3
```

**Optimization Strategy**:
1. Google API with `optimize:true` flag (automatic reordering)
2. Fallback: Nearest-neighbor heuristic (custom implementation)

### ETA Calculation

```
Standard Delivery:
  ETA = route_duration + 30 minutes (shopping time)

Batch Delivery:
  ETA = route_duration + 60-120 minutes (shopping + multiple stops)
  Range accounts for variability in shared runs
```

## Fee Calculation

### Pricing Philosophy

**Customers pay the same fees whether their order is batched or not.**

Batching benefits:
- ✅ **Business**: Serve multiple customers in one efficient route (higher profit per hour)
- ✅ **Environment**: Fewer trips, less fuel
- ❌ **Customer pricing**: No discounts (same fees as standard delivery)

### Fee Components

| Component | Calculation | Example |
|-----------|-------------|----------|
| Route Fee | Base fee with tier discount | $4.99 → $3.49 (Gold 30% off) |
| Distance | Tiered bands after 3 free miles | 8 miles → $2.50 (5mi × $0.50) |
| Heavy Items | $1.50 per heavy item | 2 gallons milk → $3.00 |
| Large Order | $0.30 per item over 10 | 15 items → $1.50 |

### Tier Discounts

Applied to route fee only:

| Tier | Route Fee Discount | Distance Fee |
|------|----------|----------|
| Common | 0% | Normal |
| Bronze | 10% off | Normal |
| Silver | 20% off | Normal |
| Gold | 30% off | Normal |
| Platinum | Free delivery | Normal |
| Green | $1 flat fee | $0 (free) |

## Admin Operations

### Store Inventory Management

```javascript
// Add/update store inventory
POST /api/store-inventory
{
  "storeId": "...",
  "productId": "...",
  "cost": 2.99,
  "markup": 1.3,
  "available": true
}
```

### Batch Monitoring

```javascript
// List active batches
GET /api/batches

// Get specific batch
GET /api/batches/:batchId
```

## Testing Checklist

### Data Setup
- [ ] Create hub store record with lat/lng
- [ ] Create retail store records (Walmart, Kroger, Aldi, Target, Meijer) with locations
- [ ] Populate StoreInventory with wholesale costs for products
- [ ] Set Product.handlingPoints for all products (1=normal, 2=bulky, 3=heavy, 6-10=cases)
- [ ] Verify Product.price (customer-facing prices) are set

### API Testing
- [ ] Test `/api/shopping/checkout-preview` with various carts
- [ ] Verify route calculation from hub → stores → customer
- [ ] Verify customer sees only website prices, not wholesale costs
- [ ] Test fee calculations with different tiers (Bronze, Silver, Gold, Platinum, Green)
- [ ] Test batch assignment (should be transparent to customer)
- [ ] Test capacity constraints (45 points max, 20 heavy max, 4 customers max)

### Business Logic
- [ ] Verify cheapest store selection works
- [ ] Verify store consolidation (single store if <15% price difference)
- [ ] Verify customers pay same fees whether batched or not
- [ ] Verify batching saves YOU time/money (multiple customers per route)

## Environment Variables

```bash
# Google Maps (required for routing)
GOOGLE_MAPS_API_KEY=your_api_key

# Pricing Lock (required for deterministic fees)
PRICING_SECRET=strong_random_value
```

**Hub Location**:
- Preferred: Create a Store record with `storeType: 'hub'` and your hub coordinates
- Fallback: Set environment variables `HUB_LAT` and `HUB_LNG` (used when no hub Store exists)

## Pricing Lock

- Purpose: Ensure the customer is charged exactly what was shown in checkout preview.
- How it works: `/checkout-preview` returns `{ pricingLock: { payload, signature } }` signed with `PRICING_SECRET`.
- Usage: Send the exact `pricingLock` object to `/api/payments/create-session` or `/api/payments/credits`.
- Enforcement: Server verifies the signature and overrides route, distance, and handling fees using the locked values.
- Expiry: Locks expire after a short window; expired or invalid locks fall back to normal calculation.

## Next Steps

### Backend Setup
1. **Create Hub**: Add Store record with `storeType: 'hub'` and your warehouse lat/lng
2. **Add Retail Stores**: Create Store records for Walmart, Kroger, Aldi, Target, Meijer with locations
3. **Populate Inventory**: Add StoreInventory records with wholesale costs (what you pay)
4. **Set Handling Points**: Update Product records with handlingPoints (1-10 scale)
5. **Verify Prices**: Ensure Product.price is set (what customers pay)

### Frontend Integration
1. **Checkout Page**: Call `/api/shopping/checkout-preview` when user enters address
2. **Display Preview**: Show items, fees breakdown, total, ETA
3. **Hide Internals**: Don't show which stores, wholesale costs, or batch status
4. **Confirm Order**: Submit order with cart + address

### Operations
1. **Monitor Batches**: Check batch formation efficiency
2. **Track Metrics**: Orders per route, profit per hour, batch rate
3. **Optimize**: Adjust batching windows/zones based on real data

---

**Last Updated**: January 20, 2026  
**Status**: Backend Complete - Checkout Preview Endpoint Ready
