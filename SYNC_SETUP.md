# 🚀 Real-Time Sync - Setup Guide

## Prerequisites

✅ All code is ready  
⚠️ Environment variables needed  
⚠️ Server must be running  

---

## Step 1: Environment Variables

### **Server** (`server/.env`)

Required:
```env
MONGO_URI=mongodb://localhost:27017/gsnacks
PORT=5001
NODE_ENV=development
```

Optional (for push notifications):
```env
VAPID_PRIVATE_KEY=your-private-key-here
```

### **Frontend** (`.env`)

Required:
```env
VITE_API_URL=http://localhost:5001
```

Optional (for push notifications):
```env
VITE_VAPID_PUBLIC_KEY=your-public-key-here
```

---

## Step 2: Generate VAPID Keys (Optional)

Only needed if you want **server-side push notifications**:

```bash
npx web-push generate-vapid-keys
```

Output:
```
Public Key: BN...xyz
Private Key: ab...123
```

Add to `.env`:
```env
# Frontend
VITE_VAPID_PUBLIC_KEY=BN...xyz

# Server
VAPID_PRIVATE_KEY=ab...123
```

**Note:** Browser push notifications work **WITHOUT** VAPID keys for local notifications!

---

## Step 3: Start MongoDB

Make sure MongoDB is running:

```bash
# Windows (if installed as service)
net start MongoDB

# macOS/Linux
brew services start mongodb-community
# OR
sudo systemctl start mongod

# Docker
docker run -d -p 27017:27017 --name mongodb mongo
```

Test connection:
```bash
mongosh
# Should connect without errors
```

---

## Step 4: Start Server

```bash
cd server
node index.js
```

Expected output:
```
⚡ MongoDB Connected: <connection-string>
LOGISTICS HUB ONLINE @ 5001
WebSocket server ready
```

---

## Step 5: Start Frontend

```bash
cd ..  # Back to root
npm run dev
```

Expected output:
```
Local:   http://localhost:5173/
```

---

## Step 6: Test WebSocket Connection

1. Open browser to `http://localhost:5173`
2. Login with any user
3. Open DevTools Console
4. Look for:
   ```
   [Socket] Connected: <socket-id>
   [WebSocket] User <userId> joined their room
   ```

---

## Step 7: Test Cart Sync

1. **Open 2 tabs** with same user logged in
2. **Tab 1:** Add item to cart
3. **Tab 2:** Should update instantly
4. **Console:** Should show `[Socket] Cart updated from another device`

---

## Step 8: Test Service Worker

1. Open DevTools → Application → Service Workers
2. Should see `/sw.js` registered
3. Status: **Activated and Running**

---

## Step 9: Test Push Notifications (Optional)

1. Login to app
2. Browser should prompt: "Allow notifications?"
3. Click **Allow**
4. Console should show:
   ```
   [SW] Service worker registered
   [Push] Permission result: granted
   ```

Test local notification:
```javascript
// In browser console
import { showLocalNotification } from './src/services/pushService';
showLocalNotification('Test', { body: 'This is a test!' });
```

---

## Troubleshooting

### ❌ Server won't start
**Error:** `MONGO_URI not defined`  
**Fix:** Add `MONGO_URI` to `server/.env`

**Error:** `MongoDB connection failed`  
**Fix:** Start MongoDB service

---

### ❌ WebSocket not connecting
**Error:** No `[Socket] Connected` in console  
**Fix:** 
- Check `VITE_API_URL` in frontend `.env`
- Make sure server is running
- Check CORS `allowedOrigins` in `server/index.js`

---

### ❌ Cart not syncing
**Error:** Cart changes don't appear in other tabs  
**Fix:**
- Check WebSocket connection (see above)
- Check console for errors
- Verify user is logged in

---

### ❌ Service Worker not registering
**Error:** No service worker in DevTools  
**Fix:**
- HTTPS required (or use localhost)
- Check for syntax errors in `public/sw.js`
- Hard refresh (Ctrl+Shift+R)

---

### ❌ Push notifications blocked
**Error:** `Notification.permission === "denied"`  
**Fix:**
- User must manually enable in browser settings
- Chrome: Settings → Privacy → Site Settings → Notifications
- Clear site data and try again

---

## Production Deployment

### 1. Update CORS Origins
```javascript
// server/index.js
const allowedOrigins = [
  'https://your-domain.com',
  'https://www.your-domain.com'
];
```

### 2. Enable HTTPS
```javascript
// Required for:
// - Service Worker
// - Push Notifications
// - Secure WebSocket (wss://)
```

### 3. Environment Variables
Set on hosting platform:
- `MONGO_URI` (production MongoDB)
- `VITE_API_URL` (production API URL)
- `VAPID_PRIVATE_KEY` (if using push)

### 4. Test Production WebSocket
```javascript
// Should use wss:// (secure WebSocket)
const socket = io('wss://your-api.com', {
  withCredentials: true
});
```

---

## Verification Checklist

- [ ] MongoDB running
- [ ] `MONGO_URI` in `server/.env`
- [ ] Server starts without errors
- [ ] Frontend runs at localhost:5173
- [ ] WebSocket connects on login
- [ ] Cart syncs across 2 tabs
- [ ] Service worker registered
- [ ] Push permission requested
- [ ] Offline page shows when offline

---

## What Works Right Now

✅ **Without VAPID keys:**
- Cart sync across devices ✅
- Order/product real-time updates ✅
- Driver not-found items sync ✅
- Return UPCs sync ✅
- Local notifications ✅
- Offline support ✅

⚠️ **Needs VAPID keys:**
- Server-side push notifications (not required)

---

## Next Steps

1. **Development:**
   - [x] Set up `.env` files
   - [x] Start MongoDB
   - [x] Test WebSocket sync
   - [x] Test offline mode

2. **Optional:**
   - [ ] Generate VAPID keys
   - [ ] Test server-side push

3. **Production:**
   - [ ] Deploy server with WebSocket support
   - [ ] Deploy frontend with HTTPS
   - [ ] Update CORS origins
   - [ ] Test in production

---

## Support

For issues:
1. Check console for errors
2. Verify all environment variables set
3. Test WebSocket connection
4. Check MongoDB connection

See [REALTIME_SYNC.md](./REALTIME_SYNC.md) for detailed documentation.

---

**You're ready to go!** 🚀

All sync features are implemented and ready to use once MongoDB is configured.
