# 🚀 Real-Time Sync & Push Notifications

## Overview

GSnacks now has **real-time cross-device synchronization** using WebSockets and **FREE browser push notifications** - no Twilio or external services needed!

---

## ✅ What's Synced in Real-Time

### 1. **Shopping Cart**
- **What**: Cart items, quantities
- **How**: Debounced 1s sync to MongoDB + instant WebSocket push
- **When**: On any cart change (add/remove items)
- **Result**: Cart updates instantly across all logged-in devices

### 2. **Orders (Dashboard)**
- **What**: Order status, driver assignment, delivery updates
- **How**: WebSocket events on order updates
- **When**: Order created, status changed, driver assigned
- **Result**: Dashboard shows live order updates without refresh

### 3. **Products (Dashboard)**
- **What**: Product changes, stock updates
- **How**: WebSocket events on product updates
- **When**: Product edited by staff
- **Result**: Product listings update instantly

### 4. **Driver Not-Found Items**
- **What**: Items marked "not found" by drivers
- **How**: Synced to MongoDB + WebSocket push
- **When**: Driver marks items unavailable
- **Result**: Lost on device switch - now synced!

### 5. **Return UPCs (Bottle Returns)**
- **What**: Customer bottle return scans, eligibility cache
- **How**: Synced to MongoDB + WebSocket push
- **When**: Customer scans bottles for return
- **Result**: Return progress preserved across devices

---

## 🔌 WebSocket Architecture

### **Server Side** (`server/index.js`)
```javascript
// Socket.IO server initialized with CORS
const io = new SocketIOServer(httpServer, {
  cors: { origin: allowedOrigins, credentials: true }
});

// User-specific rooms for targeted updates
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user:${userId}`);
  });
});

// Available to all routes via app.locals.io
app.locals.io = io;
```

### **Client Side** (`src/services/socketService.ts`)
```javascript
import { connectSocket, onCartUpdate, onOrderUpdate } from '../services/socketService';

// Connect on login
connectSocket(userId);

// Listen for events
onCartUpdate((data) => {
  setCart(data.items); // Update cart from another device
});
```

### **Emitting Events** (in routes)
```javascript
// In cart.js, orders.js, products.js
req.app.locals.io.to(`user:${userId}`).emit('cart:updated', { items });
req.app.locals.io.to(`user:${userId}`).emit('order:updated', order);
```

---

## 🔔 Push Notifications (FREE)

### **What This Is**
Browser push notifications using the **Web Push API** - built into Chrome, Firefox, Safari. **No Twilio, no monthly fees.**

### **How It Works**
1. **Service Worker** (`public/sw.js`) registers on app load
2. **Push Permission** requested on login
3. **Push Subscription** created and saved to server
4. **Notifications** shown via service worker

### **Setup Push Notifications**

#### 1. Generate VAPID Keys (one-time)
```bash
npx web-push generate-vapid-keys
```

#### 2. Add to `.env`
```env
VITE_VAPID_PUBLIC_KEY=your-public-key-here
VAPID_PRIVATE_KEY=your-private-key-here
```

#### 3. Server-Side Push (future)
```javascript
import webPush from 'web-push';

webPush.setVapidDetails(
  'mailto:your-email@example.com',
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Send push notification
webPush.sendNotification(subscription, JSON.stringify({
  title: 'Order Ready!',
  body: 'Your order #12345 is ready for pickup',
  icon: '/logo.png'
}));
```

#### 4. Local Notifications (No Push Service)
```javascript
import { showLocalNotification } from '../services/pushService';

showLocalNotification('Order Status', {
  body: 'Your order has been delivered!',
  icon: '/logo.png',
  requireInteraction: true
});
```

---

## 📦 MongoDB Models

### **Cart Model** (`server/models/Cart.js`)
```javascript
{
  userId: ObjectId,          // Unique per user
  items: [{
    productId: String,
    quantity: Number,
    addedAt: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### **DriverNotFound Model** (`server/models/DriverNotFound.js`)
```javascript
{
  driverId: ObjectId,
  orderId: String,
  items: [{
    productId: String,
    reason: String
  }],
  createdAt: Date,
  updatedAt: Date
}
// Index: (driverId, orderId) for fast lookups
```

### **ReturnUpcs Model** (`server/models/ReturnUpcs.js`)
```javascript
{
  userId: ObjectId,          // Unique per user
  upcs: [String],            // Array of scanned UPCs
  eligibilityCache: Map,     // { upc: { eligible, deposit, ... } }
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🛣️ API Endpoints

### **Cart Sync**
```
GET    /api/cart                 - Fetch user's cart
PUT    /api/cart                 - Update user's cart
DELETE /api/cart                 - Clear user's cart
```

### **Driver Not-Found Items**
```
GET    /api/cart/driver-not-found/:orderId  - Fetch not-found items
PUT    /api/cart/driver-not-found/:orderId  - Update not-found items
DELETE /api/cart/driver-not-found/:orderId  - Clear not-found items
```

### **Return UPCs**
```
GET    /api/cart/return-upcs     - Fetch return UPCs
PUT    /api/cart/return-upcs     - Update return UPCs
DELETE /api/cart/return-upcs     - Clear return UPCs
```

---

## 🎯 WebSocket Events

### **Client → Server**
- `join` - Join user-specific room (userId)

### **Server → Client**
- `cart:updated` - Cart changed on another device
- `order:updated` - Order status/details changed
- `order:created` - New order placed
- `product:updated` - Product details changed
- `driver-not-found:updated` - Driver marked items unavailable
- `driver-not-found:deleted` - Not-found items cleared
- `return-upcs:updated` - Return UPCs changed
- `return-upcs:deleted` - Return UPCs cleared

---

## 🔧 Frontend Integration

### **useNinpoCore Hook** (`src/hooks/useNinpoCore.ts`)

```javascript
// Auto-connects on login
useEffect(() => {
  if (currentUser?.id) {
    connectSocket(currentUser.id);
    registerServiceWorker();
    requestNotificationPermission();
  }
}, [currentUser]);

// Listens for WebSocket events
useEffect(() => {
  if (!currentUser) return;

  // Cart updates
  const unsubCart = onCartUpdate((data) => {
    setCart(data.items);
    setLastSyncTime(new Date());
  });

  // Order updates
  const unsubOrder = onOrderUpdate((order) => {
    setOrders(prev => prev.map(o => o.id === order._id ? order : o));
  });

  return () => {
    unsubCart();
    unsubOrder();
  };
}, [currentUser]);
```

---

## 🚦 Offline Support

### **Service Worker** (`public/sw.js`)
- **Network First** for API calls (always fresh)
- **Cache Fallback** for assets (offline-ready)
- **Offline Page** shown when network unavailable
- **Background Sync** (future) for queued actions

### **Testing Offline Mode**
1. Open DevTools → Application → Service Workers
2. Check "Offline" checkbox
3. Reload page - should show offline.html
4. Uncheck "Offline" - app works normally

---

## 📊 Sync Status Indicator

The `lastSyncTime` state tracks when data was last synced:

```javascript
// In components
const { lastSyncTime } = useNinpoCore();

<div>
  Last synced: {lastSyncTime?.toLocaleTimeString() || 'Never'}
</div>
```

---

## 🔐 Security

### **Authentication**
- All WebSocket connections require valid session cookie
- User can only join their own room (`user:${userId}`)
- CORS restricted to allowed origins

### **Authorization**
- Cart endpoints verify `req.user._id` matches cart owner
- Driver endpoints verify driver assignment
- Return UPCs private to user

---

## 📈 Performance

### **Debouncing**
- Cart changes debounced 1s before sync (prevents spam)
- Dashboard refresh throttled to 30s polling (fallback)

### **Selective Updates**
- Only affected users receive WebSocket events
- No broadcast storms - room-based targeting

### **Efficient Queries**
- Indexed lookups (userId, orderId, driverId)
- Lean queries where possible
- Projection limits returned fields

---

## 🧪 Testing WebSocket Sync

1. **Open app in 2 tabs** (same user)
2. **Add item to cart** in Tab 1
3. **Tab 2 updates instantly** (no refresh needed)
4. **Check console** for `[Socket] Cart updated from another device`

---

## 🛠️ Troubleshooting

### **WebSocket Not Connecting**
```javascript
// Check console for:
[Socket] Connected: <socket-id>
[WebSocket] User <userId> joined their room

// If missing, check:
- BACKEND_URL in .env
- Server running with Socket.IO
- CORS allowedOrigins includes frontend URL
```

### **Push Notifications Blocked**
```javascript
// Check permission:
console.log(Notification.permission); // "granted", "denied", or "default"

// If denied, user must manually enable in browser settings
```

### **Service Worker Not Registering**
```javascript
// Check console for:
[SW] Service worker registered

// If missing:
- HTTPS required (or localhost)
- /sw.js must be in public/ folder
- Check for syntax errors in sw.js
```

---

## 🎉 What's FREE

✅ **WebSocket sync** - Socket.IO (free open-source)  
✅ **Browser push** - Web Push API (built into browsers)  
✅ **Service worker** - Browser feature (free)  
✅ **MongoDB** - Using existing database  

❌ **NOT using Twilio** - Would cost money for SMS  
❌ **NOT using Firebase** - Would require Google account  
❌ **NOT using external push services** - Browser API is enough  

---

## 📚 Resources

- [Socket.IO Docs](https://socket.io/docs/v4/)
- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [VAPID Keys](https://github.com/web-push-libs/web-push#command-line)

---

## 🚀 Next Steps

1. ✅ **WebSocket sync** - DONE
2. ✅ **Push notifications** - READY (needs VAPID keys)
3. 📋 **Background sync queue** - TODO
4. 📋 **Conflict resolution** - TODO (last-write-wins currently)
5. 📋 **Image caching** - TODO (for receipts)

**All critical sync features are now live!** 🎉
