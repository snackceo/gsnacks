# Driver Platform - Architecture & Integration

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         GSNACKS PLATFORM                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐   ┌────────────┐ │
│  │   CUSTOMER VIEW  │    │   ADMIN VIEW     │   │ DRIVER VIEW│ │
│  │   (Checkout)     │    │  (Management)    │   │ (NEW!)     │ │
│  └──────────────────┘    └──────────────────┘   └────────────┘ │
│           │                      │                     │        │
│           └──────────────────────┴─────────────────────┘        │
│                         │                                        │
│                    AUTHENTICATION                               │
│                    (JWT Tokens)                                 │
│                         │                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               BACKEND API ROUTES                         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │  Customer:                                              │   │
│  │  ├─ /api/shopping/checkout-preview (pricing lock)      │   │
│  │  ├─ /api/payments/create-session                       │   │
│  │  └─ /api/orders/{id}                                   │   │
│  │                                                          │   │
│  │  Admin:                                                 │   │
│  │  ├─ /api/settings/hub                                  │   │
│  │  ├─ /api/batches                                       │   │
│  │  └─ /api/orders (manage)                               │   │
│  │                                                          │   │
│  │  Driver: (NEW)                                          │   │
│  │  ├─ /api/driver/pending-orders                         │   │
│  │  ├─ /api/driver/assigned-orders                        │   │
│  │  ├─ /api/driver/accept-order                           │   │
│  │  ├─ /api/driver/pickup-order                           │   │
│  │  ├─ /api/driver/start-delivery                         │   │
│  │  ├─ /api/driver/complete-delivery                      │   │
│  │  ├─ /api/driver/earnings                               │   │
│  │  ├─ /api/driver/performance                            │   │
│  │  └─ /api/driver/order/:id/shopping-list                │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                      │
├───────────┼──────────────────────────────────────────────────────┤
│           │                                                      │
│  ┌────────▼────────────────────────────────────────────────┐   │
│  │          MONGODB COLLECTIONS                            │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  Order                                                  │   │
│  │  ├─ pricing lock (signature verification)              │   │
│  │  ├─ driverId, assignedAt (driver assignment)           │   │
│  │  ├─ pickedUpAt, deliveredAt (timestamps)               │   │
│  │  ├─ deliveryProof (photo)                              │   │
│  │  ├─ customerSignature (proof of delivery)              │   │
│  │  └─ fee fields (routeFee, distanceFee, etc)            │   │
│  │                                                          │   │
│  │  Batch                                                  │   │
│  │  ├─ orders (driver assignments)                         │   │
│  │  ├─ capacity constraints                                │   │
│  │  └─ route optimization                                  │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Driver Platform Components

### Frontend Flow

```
DriverView (Main Container)
│
├─ Mode: DELIVERY (NEW)
│  │
│  └─ DriverOrderFlow (Workflow)
│     │
│     ├─ Step 1: Accept
│     │  └─ POST /api/driver/accept-order
│     │     └─ PENDING → ASSIGNED
│     │
│     ├─ Step 2: Pickup
│     │  ├─ GET /api/driver/order/:id/shopping-list
│     │  └─ POST /api/driver/pickup-order
│     │     └─ ASSIGNED → PICKED_UP
│     │
│     ├─ Step 3: Navigate
│     │  └─ POST /api/driver/start-delivery
│     │     └─ PICKED_UP → ARRIVING
│     │
│     └─ Step 4: Deliver
│        ├─ Optional: Photo Capture
│        ├─ Optional: Signature
│        └─ POST /api/driver/complete-delivery
│           └─ ARRIVING → DELIVERED
│
├─ Dashboard (Real-Time)
│  │
│  ├─ DriverDashboard
│  │  ├─ GET /api/driver/earnings
│  │  │  └─ Display today/week/month
│  │  │
│  │  ├─ GET /api/driver/performance
│  │  │  └─ Display 30-day metrics
│  │  │
│  │  ├─ GET /api/driver/assigned-orders
│  │  │  └─ Display current work
│  │  │
│  │  └─ GET /api/driver/pending-orders
│  │     └─ Display available work
│  │
│  └─ Auto-Refresh: 30 seconds
│
└─ Mode: VERIFICATION (Existing)
   └─ DriverVerificationDelivery
      └─ Return container verification
```

### Backend Processing

```
Request: /api/driver/accept-order
│
├─ Middleware: authRequired ✓
├─ Middleware: driverOnly ✓
│
├─ Validate orderId
├─ Fetch Order from DB
├─ Validate order status = PENDING
├─ Validate no existing driverId
│
├─ Update order:
│  ├─ driverId = req.user.username
│  ├─ status = ASSIGNED
│  ├─ assignedAt = now
│  └─ save() with transaction
│
├─ Record audit log
│  └─ type: ORDER_ASSIGNED
│      actor: driver username
│
├─ Response: 200 OK
│  └─ JSON: { ok: true, order: {...} }
│
└─ Error cases:
   ├─ 400: Missing orderId
   ├─ 404: Order not found
   ├─ 409: Order not in PENDING status
   ├─ 409: Order already assigned
   └─ 403: Not a driver
```

## Data Flow: Complete Delivery

```
1. PENDING STATE
   ├─ Order created by customer
   ├─ Status: PENDING
   ├─ driverId: null
   └─ Waiting for driver to accept

2. DRIVER ACCEPTS (accept-order)
   ├─ Driver clicks "Accept Order"
   ├─ POST /api/driver/accept-order
   ├─ Order updates:
   │  ├─ status → ASSIGNED
   │  ├─ driverId → "driver-username"
   │  └─ assignedAt → timestamp
   └─ Audit log recorded

3. DRIVER PICKS UP (pickup-order)
   ├─ Driver navigates to store(s)
   ├─ Driver collects items
   ├─ Driver clicks "Mark Picked Up"
   ├─ POST /api/driver/pickup-order
   ├─ Order updates:
   │  ├─ status → PICKED_UP
   │  └─ pickedUpAt → timestamp
   └─ Audit log recorded

4. DRIVER NAVIGATES (start-delivery)
   ├─ Driver leaves store
   ├─ Driver navigates to customer address
   ├─ Driver clicks "I've Arrived"
   ├─ POST /api/driver/start-delivery
   ├─ Order updates:
   │  ├─ status → ARRIVING
   │  └─ deliveryStartedAt → timestamp
   └─ Audit log recorded

5. DRIVER COMPLETES (complete-delivery)
   ├─ Driver arrives at customer location
   ├─ Driver optional: Captures photo
   ├─ Driver optional: Collects signature
   ├─ Driver clicks "Complete Delivery"
   ├─ POST /api/driver/complete-delivery
   ├─ Order updates:
   │  ├─ status → DELIVERED
   │  ├─ deliveredAt → timestamp
   │  ├─ deliveryProof → { photo, capturedAt }
   │  ├─ customerSignature → { signature, signedAt }
   │  └─ (saved in transaction)
   │
   ├─ Earnings calculated:
   │  ├─ routeFee (tier-based discount)
   │  ├─ distanceFee (distance band)
   │  ├─ largeOrderFee (if items > 10)
   │  └─ heavyItemFee (if heavy items)
   │
   ├─ Audit log recorded
   └─ Dashboard auto-refreshes (30s)

6. FINAL STATE
   ├─ Order: DELIVERED
   ├─ Driver: Can see earnings update
   ├─ Customer: Delivery confirmed
   └─ Proof: Photo + signature stored
```

## Earnings Calculation

```
Order Total Fees:
├─ routeFee (Tier-Based)
│  ├─ Bronze: 10% discount → routeFee * 0.9
│  ├─ Silver: 20% discount → routeFee * 0.8
│  ├─ Gold: 30% discount → routeFee * 0.7
│  ├─ Platinum: Free → routeFee * 0
│  └─ Green: $1 fixed → $1.00
│
├─ distanceFee (Distance Band)
│  ├─ 0-2 miles: $0.50
│  ├─ 2-5 miles: $1.00
│  ├─ 5-10 miles: $1.50
│  └─ 10+ miles: $2.00
│
├─ largeOrderFee
│  └─ If items > 10: $0.30 per item
│
└─ heavyItemFee
   └─ If heavy items: $1.50 per unit

Driver Earnings (Per Delivery):
= routeFee + distanceFee + largeOrderFee + heavyItemFee

Dashboard Breakdown:
├─ Today: Sum of all DELIVERED today
├─ Week: Sum of all DELIVERED (last 7 days)
└─ Month: Sum of all DELIVERED (last 30 days)
```

## Security & Validation

```
Request Processing:

1. Authentication
   ├─ Extract JWT token from header
   ├─ Verify signature
   └─ Extract req.user.username

2. Authorization
   ├─ Check isDriverUsername(req.user.username)
   ├─ Verify driver role exists
   └─ Reject if not driver

3. Order Ownership
   ├─ Fetch order from DB
   ├─ Check order.driverId === req.user.username
   └─ Reject if not owner

4. Status Validation
   ├─ Verify current status matches expected
   ├─ Enforce state machine
   └─ Reject invalid transitions

5. Audit Logging
   ├─ Log all state changes
   ├─ Include timestamp
   ├─ Include actor (driver username)
   └─ Include details

6. Database Transaction
   ├─ Wrap updates in transaction
   ├─ Atomic operations
   └─ Rollback on error
```

## Performance Optimizations

```
Query Optimization:
├─ Indexes
│  ├─ status: Speeds up PENDING/ASSIGNED queries
│  ├─ driverId: Speeds up driver's orders
│  ├─ createdAt: Speeds up sorting
│  ├─ assignedAt: Speeds up driver metrics
│  └─ deliveredAt: Speeds up earnings calc
│
├─ Lean Queries (.lean())
│  ├─ Reduces memory footprint
│  ├─ Speeds up data transfer
│  └─ Used for list endpoints
│
├─ Pagination
│  ├─ Limit 100 orders per query
│  └─ Prevents oversized responses
│
└─ In-Memory Calculations
   ├─ Earnings calculated in Node
   ├─ No additional DB queries
   └─ Fast aggregation

Caching Opportunities:
├─ Driver performance (compute daily, cache 24h)
├─ Hub location (cache until next refresh)
└─ Store inventory (cache with TTL)
```

## Integration with Existing Systems

```
Multi-Store Shopping ←→ Driver Platform
├─ Pricing Lock
│  ├─ Created at checkout
│  ├─ Verified in payments
│  └─ Persisted with order
│
├─ Fee Calculations
│  ├─ Centralized in deliveryFees.js
│  ├─ Used by shopping, payments, driver
│  └─ Ensures consistency
│
├─ Order Model
│  ├─ Extended with driver fields
│  ├─ No breaking changes
│  └─ All fields optional for existing orders
│
├─ Batch System
│  ├─ Driver assignment included
│  ├─ Capacity constraints honored
│  └─ Route optimization utilized
│
└─ Returns Workflow
   ├─ Driver can verify returns
   ├─ Separate verification mode
   └─ Both modes available in DriverView
```

## Deployment Architecture

```
Production Setup:

┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER                            │
└────┬────────────────────────────────────────────────────────┘
     │
     ├─ frontend (React + Vite)
     │  ├─ DriverView component
     │  ├─ DriverOrderFlow component
     │  ├─ DriverDashboard component
     │  └─ Static assets
     │
     ├─ backend (Node.js + Express)
     │  ├─ /api/driver/* endpoints
     │  ├─ auth middleware
     │  ├─ mongodb connection pool
     │  └─ audit logging
     │
     └─ database (MongoDB)
        ├─ orders collection + indexes
        ├─ drivers collection
        ├─ batches collection
        └─ audit logs collection

Redis Cache (Optional):
├─ Driver performance metrics
├─ Hub location
└─ Recent order listings
```

## Files & Integration Points

```
Backend Files:
├─ server/routes/driver.js (NEW - 268 lines)
│  └─ Mounted in server/index.js
│
├─ server/models/Order.js (UPDATED)
│  └─ Added driver assignment fields
│
└─ server/index.js (UPDATED)
   └─ Mount driverRouter at /api/driver

Frontend Files:
├─ src/components/DriverOrderFlow.tsx (NEW - 297 lines)
│  └─ Imported in DriverView
│
├─ src/components/DriverDashboard.tsx (NEW - 280+ lines)
│  └─ Displays earnings/performance
│
└─ src/views/DriverView.tsx (UPDATED)
   ├─ Import DriverOrderFlow
   ├─ Conditional rendering
   ├─ Mode switching
   └─ handleAccept updated

Documentation Files:
├─ DRIVER_PLATFORM.md (NEW - ~500 lines)
│  └─ Complete API reference
│
├─ DRIVER_IMPLEMENTATION.md (NEW - ~350 lines)
│  └─ Implementation details
│
├─ DRIVER_QUICK_START.md (NEW - ~400 lines)
│  └─ Quick start guide
│
├─ DRIVER_COMPLETION.md (NEW - ~300 lines)
│  └─ Completion checklist
│
└─ DRIVER_ARCHITECTURE.md (THIS FILE)
   └─ Architecture overview
```

## Summary

The driver platform is a complete, production-ready system featuring:

✅ **9 REST API endpoints** for complete driver workflow
✅ **4-step delivery workflow** (Accept → Pickup → Navigate → Deliver)
✅ **Real-time earnings dashboard** with daily/weekly/monthly breakdown
✅ **30-day performance metrics** for driver visibility
✅ **Delivery proof capture** (photo + signature)
✅ **Security & validation** throughout
✅ **Performance optimization** with indexes and lean queries
✅ **Audit logging** for all changes
✅ **Comprehensive documentation** with examples
✅ **Seamless integration** with existing systems

---

**Status: Complete and Production Ready ✅**
