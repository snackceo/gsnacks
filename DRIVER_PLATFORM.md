# Driver Platform Documentation

## Overview

The driver platform provides a complete end-to-end workflow for drivers to accept orders, pick up items from stores, navigate to customers, and complete deliveries with proof of delivery. The system includes real-time earnings tracking, performance metrics, and comprehensive order management.

## Architecture

### Backend Components

#### Driver Routes (`server/routes/driver.js`)

**Authentication**: All routes require driver authentication via `driverOnly` middleware.

**Endpoints**:

1. **GET `/api/driver/pending-orders`**
   - Lists orders awaiting assignment (status: PENDING)
   - Drivers browse available work
   - Returns up to 100 orders sorted by creation date
   - Response: `{ ok: true, orders: [...] }`

2. **GET `/api/driver/assigned-orders`**
   - Lists orders assigned to the authenticated driver
   - Includes ASSIGNED, PICKED_UP, ARRIVING statuses
   - Returns earnings breakdown (today, week, month)
   - Response: `{ ok: true, orders: [...], earnings: { today, week, month } }`

3. **POST `/api/driver/accept-order`**
   - Driver accepts an order (PENDING → ASSIGNED)
   - Sets `driverId` and `assignedAt` timestamp
   - Records audit log
   - Request: `{ orderId }`
   - Response: `{ ok: true, order: {...} }`

4. **POST `/api/driver/pickup-order`**
   - Driver marks items picked up (ASSIGNED → PICKED_UP)
   - Records audit log with pickup confirmation
   - Request: `{ orderId }`
   - Response: `{ ok: true, order: {...} }`

5. **POST `/api/driver/start-delivery`**
   - Driver starts delivery route (PICKED_UP → ARRIVING)
   - Records audit log with departure
   - Request: `{ orderId }`
   - Response: `{ ok: true, order: {...} }`

6. **POST `/api/driver/complete-delivery`**
   - Driver completes delivery (ARRIVING → DELIVERED)
   - Captures optional delivery photo (base64)
   - Captures optional customer signature
   - Stores proof in `Order.deliveryProof` and `Order.customerSignature`
   - Records audit log
   - Request: `{ orderId, deliveryPhoto?: string, customerSignature?: string }`
   - Response: `{ ok: true, order: {...} }`

7. **GET `/api/driver/earnings`**
   - Returns driver's earnings breakdown by period
   - Calculations: Sum of all order fees (routeFee, distanceFee, largeOrderFee, heavyItemFee)
   - Periods: today, last 7 days, last 30 days
   - Response: `{ ok: true, earnings: { today, week, month } }`

8. **GET `/api/driver/performance`**
   - Returns driver performance metrics (30-day window)
   - Metrics: Total deliveries, average rating, on-time rate, customer satisfaction
   - Response: `{ ok: true, performance: { deliveries, avgRating, onTimeRate, satisfaction } }`

9. **GET `/api/driver/order/:orderId/shopping-list`**
   - Returns shopping list for an order
   - Breakdown: Store → Items → Quantities/Prices
   - Used during pickup workflow
   - Response: `{ ok: true, shoppingList: [...], itemCount }`

### Frontend Components

#### DriverOrderFlow (`src/components/DriverOrderFlow.tsx`)

A complete workflow component for the delivery lifecycle:

**Props**:
- `order`: Order object with full details
- `onBack`: Callback to close the workflow
- `onRefresh`: Callback to refresh order status

**Workflow Steps**:

1. **Accept** (PENDING)
   - Driver reviews order details
   - Clicks "Accept Order" button
   - Order status → ASSIGNED
   - Moves to next step: Pickup

2. **Pickup** (ASSIGNED → PICKED_UP)
   - Displays shopping list with all items
   - Driver navigates to store(s)
   - Collects items listed
   - Marks as "Picked Up" when ready
   - Status → PICKED_UP
   - Moves to next step: Navigate

3. **Navigate** (PICKED_UP → ARRIVING)
   - Displays delivery address
   - Driver uses navigation app of choice
   - Indicates arrival at customer location
   - Status → ARRIVING
   - Moves to next step: Deliver

4. **Complete Delivery** (ARRIVING → DELIVERED)
   - Optional photo capture (proof of delivery)
   - Optional customer signature
   - Final confirmation
   - Status → DELIVERED
   - Closes workflow

**UI Features**:
- Dark theme (ninpo-black/white)
- Ninpo-lime accent color for actions
- Clear status indicators and progress
- Error handling with user feedback
- Loading states for API calls

#### DriverDashboard (`src/components/DriverDashboard.tsx`)

Real-time driver operational dashboard:

**Display Sections**:

1. **Earnings**
   - Today's earnings
   - Week's earnings (last 7 days)
   - Month's earnings (last 30 days)
   - Color-coded cards with large type

2. **Performance** (30-day)
   - Total deliveries count
   - Average customer rating
   - On-time delivery percentage
   - Customer satisfaction score

3. **Assigned Orders**
   - Orders currently with driver
   - Sorted by status progression
   - Quick links to delivery workflow

4. **Pending Orders**
   - Available orders for driver to accept
   - Carousel display for browsing
   - Click to open and accept

**Auto-Refresh**: Updates every 30 seconds for real-time data

#### DriverView (`src/views/DriverView.tsx`)

Main driver interface that manages two workflow modes:

**Workflow Modes**:
- **Delivery Mode** (new): Uses `DriverOrderFlow` for accept → pickup → navigate → deliver workflow
- **Verification Mode** (existing): Return/container verification workflow

**Key Features**:
- Mode switcher buttons at top
- Order list display
- Integration with both workflows
- Unified driver experience

**Status Badges**:
- PENDING: Orders available for acceptance
- ASSIGNED: Driver has accepted, ready to pickup
- PICKED_UP: Items collected, ready to navigate
- ARRIVING: Driver en route to customer
- DELIVERED: Delivery completed

## Data Model

### Order Schema Updates

```javascript
// Pricing Lock (from checkout)
pricingLock: {
  payload: { tier, fees, distance, ... },
  signature: 'HMAC-SHA256 signature'
}

// Delivery Proof
deliveryProof: {
  photo: 'base64-encoded-image',
  capturedAt: Date
}

// Customer Signature
customerSignature: {
  signature: 'Customer name or signature confirmation',
  signedAt: Date
}

// Driver Assignment
driverId: 'driver-username',
assignedAt: Date,
pickedUpAt: Date,
deliveryStartedAt: Date,
deliveredAt: Date
```

## Workflow Examples

### Basic Delivery Flow

```
1. Driver logs in → sees pending orders
2. Driver clicks "Accept Order" → order assigned to driver
3. Driver navigates to store(s) → collects items
4. Driver marks "Picked Up" → status changes to PICKED_UP
5. Driver clicks "I've Arrived" → status changes to ARRIVING
6. Driver captures photo + signature confirmation
7. Driver clicks "Complete Delivery" → status changes to DELIVERED
8. Order proof is uploaded and driver earnings credited
```

### Acceptance Decision

```
Driver browses PENDING_ORDERS:
  - Views order details (items, total, address)
  - Reviews delivery fee breakdown
  - Checks estimated earnings
  - Accepts or skips order
```

### Earnings Tracking

Real-time earnings displayed:
- **Today**: Sum of all completed delivery fees (routeFee + distanceFee + largeOrderFee + heavyItemFee)
- **Week**: Last 7 days of completed deliveries
- **Month**: Last 30 days of completed deliveries

Earnings calculated from Order fee fields:
```javascript
total_earnings = sum(
  order.routeFee,        // Tier-based route fee
  order.distanceFee,     // Distance-based fee
  order.largeOrderFee,   // Fee if items > 10
  order.heavyItemFee     // Fee for heavy items
)
```

## Security & Validation

### Driver Authentication

- JWT token required for all endpoints
- Token checked via `authRequired` middleware
- Driver identity verified via `req.user.username`

### Order Ownership

- Driver can only accept unassigned orders
- Driver can only modify assigned orders
- Attempts to modify other driver's orders are rejected with 403 error

### Status Validation

- Strict state machine enforcement:
  - PENDING → ASSIGNED (accept)
  - ASSIGNED → PICKED_UP (pickup)
  - PICKED_UP → ARRIVING (start delivery)
  - ARRIVING → DELIVERED (complete delivery)
- Invalid status transitions rejected with error

### Proof Requirements

- Delivery photo and signature optional but recommended
- Photos stored as base64 in Order document
- No size limit enforced at API (handled by client)
- Proof captured at completion time

## Performance Considerations

### Pending Orders Query

```javascript
Order.find({
  status: 'PENDING',
  driverId: { $in: [null, ''] }
})
  .sort({ createdAt: 1 })
  .limit(100)
  .lean()
```

- Indexes: `status`, `driverId`, `createdAt`
- Limit: 100 orders per query
- Lean query: Minimal memory footprint

### Assigned Orders Query

```javascript
Order.find({
  driverId: req.user.username,
  status: { $in: ['ASSIGNED', 'PICKED_UP', 'ARRIVING'] }
})
  .sort({ createdAt: -1 })
  .lean()
```

- Indexes: `driverId`, `status`
- Reverse date sort: Most recent first

### Earnings Calculation

- Done in-memory from Order documents
- Uses `.lean()` for speed
- No additional DB queries needed
- Computed on each request (can be cached)

## Frontend Integration

### Hook into DriverView

```typescript
// In DriverView.tsx
import DriverOrderFlow from '../components/DriverOrderFlow';

// When user clicks "Accept Order":
const handleAccept = (orderId: string) => {
  const order = orders.find(o => o.id === orderId);
  if (order) {
    setActiveOrder(order);
    setWorkflowMode('delivery');  // Switch to delivery workflow
    setIsVerifying(true);
  }
};

// Render the workflow:
{activeOrder && workflowMode === 'delivery' && (
  <DriverOrderFlow
    order={activeOrder}
    onBack={() => setActiveOrder(null)}
    onRefresh={() => refetchOrders()}
  />
)}
```

### Environment Variables

```env
# Backend
BACKEND_URL=http://localhost:5000
VITE_BACKEND_URL=http://localhost:5000

# Driver hub location fallback
HUB_LAT=37.7749
HUB_LNG=-122.4194
```

## Testing

### Manual Testing Checklist

1. **Accept Order**
   - [ ] Driver sees PENDING orders
   - [ ] Click accept → order assigned
   - [ ] Order appears in "Assigned Orders"
   - [ ] Status changes to ASSIGNED

2. **Pickup**
   - [ ] Shopping list displays correctly
   - [ ] Driver marks picked up
   - [ ] Status changes to PICKED_UP

3. **Navigate**
   - [ ] Arrival button enabled
   - [ ] Click "I've Arrived"
   - [ ] Status changes to ARRIVING

4. **Complete Delivery**
   - [ ] Photo capture works (optional)
   - [ ] Signature field visible (optional)
   - [ ] Click "Complete Delivery"
   - [ ] Status changes to DELIVERED
   - [ ] Order disappears from active list

5. **Earnings Display**
   - [ ] Today's earnings shown
   - [ ] Week's earnings shown
   - [ ] Month's earnings shown
   - [ ] Values update after completion

6. **Performance Metrics**
   - [ ] Delivery count displayed
   - [ ] Average rating shown
   - [ ] On-time percentage shown
   - [ ] Satisfaction score shown

### API Testing

```bash
# Accept order
curl -X POST http://localhost:5000/api/driver/accept-order \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORD-12345"}'

# Complete delivery with photo
curl -X POST http://localhost:5000/api/driver/complete-delivery \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId":"ORD-12345",
    "deliveryPhoto":"data:image/jpeg;base64,...",
    "customerSignature":"John Doe"
  }'

# Get earnings
curl -X GET http://localhost:5000/api/driver/earnings \
  -H "Authorization: Bearer TOKEN"
```

## Future Enhancements

1. **Real-time notifications**
   - Push notifications for new orders
   - Order assignment alerts

2. **Route optimization**
   - Multi-order delivery routes
   - ETA calculations per order

3. **Customer communication**
   - SMS/push notifications to customer
   - Real-time driver location sharing
   - Estimated arrival time updates

4. **Performance incentives**
   - Rating-based bonuses
   - On-time delivery bonuses
   - Customer satisfaction rewards

5. **Advanced analytics**
   - Delivery heat maps
   - Peak earning times
   - Area performance comparison

6. **Signature capture**
   - Digital signature pad component
   - Handwriting support
   - Legal compliance

7. **Photo quality validation**
   - AI-based photo verification
   - Legibility check for addresses
   - Timestamp verification

## Troubleshooting

### Orders not appearing

**Issue**: Driver sees no pending orders
- Check database has orders with `status: 'PENDING'` and no `driverId`
- Verify driver authentication token is valid
- Check `isDriverUsername()` validation passes

### Accept fails

**Issue**: "Failed to accept order"
- Verify order exists with matching `orderId`
- Check order status is PENDING
- Verify driver JWT token hasn't expired

### Delivery photo upload fails

**Issue**: "Delivery photo upload failed"
- Check base64 encoding is valid
- Verify image size is reasonable (max ~5MB recommended)
- Check Cloudinary credentials if using external storage

### Earnings not updating

**Issue**: Completed deliveries not showing in earnings
- Verify order status is DELIVERED
- Check order fee fields are populated (routeFee, etc)
- Verify earnings calculation includes completed orders

## Related Documentation

- [MULTI_STORE_SHOPPING.md](MULTI_STORE_SHOPPING.md) - Checkout and pricing workflow
- [AI_FEATURES.md](AI_FEATURES.md) - AI-powered features (fee explanations, etc)
- [ANALYTICS_SETUP.md](ANALYTICS_SETUP.md) - Analytics and monitoring
