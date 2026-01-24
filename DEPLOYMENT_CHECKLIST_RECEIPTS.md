# Receipt Upload Deployment Checklist

## Pre-Deployment Checklist

### 1. Cloudinary Configuration

- [ ] Created Cloudinary account at https://cloudinary.com
- [ ] Located API credentials in Settings → API Keys
- [ ] Have these values:
  - [ ] `CLOUDINARY_CLOUD_NAME`
  - [ ] `CLOUDINARY_API_KEY`
  - [ ] `CLOUDINARY_API_SECRET`
- [ ] Created folder structure in Media Library (auto-created on first upload)

### 2. Environment Variables

**Development (.env)**:
```bash
CLOUDINARY_CLOUD_NAME=___________
CLOUDINARY_API_KEY=___________
CLOUDINARY_API_SECRET=___________
GEMINI_API_KEY=___________
GOOGLE_MAPS_API_KEY=___________
ENABLE_RECEIPT_QUEUE=true
REDIS_URL=redis://localhost:6379
```

**Production (Render/Railway/etc.)**:
- [ ] Set each variable in deployment dashboard
- [ ] Set Redis connection string (`REDIS_URL`)
- [ ] Set `ENABLE_RECEIPT_QUEUE=true` for background processing
- [ ] Verified values are NOT in git history
- [ ] Used `server/.env.example` as reference

### 3. Code Review

- [ ] `server/config/cloudinary.js` created with proper config
- [ ] `server/routes/receipt-prices.js` imports from config
- [ ] `handleReceiptImageUpload()` uses Cloudinary client
- [ ] Receipt parse endpoint uses Cloudinary URLs (not base64)
- [ ] Gemini Vision calls receive URLs, not base64

### 4. Database

- [ ] MongoDB connection string set in `MONGODB_URI`
- [ ] ReceiptCapture schema updated (images.url as string)
- [ ] Migration not needed (schema is flexible)
- [ ] Test database has write permissions

### 5. Security Review

- [ ] No secrets in environment variables files
- [ ] No hardcoded API keys in code
- [ ] CLOUDINARY_API_SECRET never exposed to frontend
- [ ] Receipt URLs validated before using in Gemini
- [ ] Only HTTPS URLs allowed (no data: URLs in production)

---

## Local Testing Checklist

### 1. Start Server

```bash
cd server
npm install
npm start
```

Check logs:
```
✅ Cloudinary configured for receipt uploads
🚀 Server listening on port 3000
```

If you see:
```
⚠️ Cloudinary not configured. Receipt uploads will use base64 fallback.
```

Then `CLOUDINARY_*` env vars are not set. Fix:
```bash
export CLOUDINARY_CLOUD_NAME=your_value
export CLOUDINARY_API_KEY=your_value
export CLOUDINARY_API_SECRET=your_value
npm start
```

If you see:
```
⚠️ BullMQ connection not configured; receipt queue is disabled.
```

Then set the Redis connection string and enable the queue:
```bash
export ENABLE_RECEIPT_QUEUE=true
export REDIS_URL=redis://localhost:6379
npm start
```

### 2. Test Upload (curl)

```bash
# Create test image
curl -s https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png -o /tmp/test.png

# Convert to base64
base64 /tmp/test.png > /tmp/test.b64
base64_data=$(cat /tmp/test.b64 | tr -d '\n')

# Upload
curl -X POST http://localhost:3000/api/driver/upload-receipt-image \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$(your_token)" \
  -d "{\"image\":\"data:image/png;base64,$base64_data\"}"
```

Expected response:
```json
{
  "ok": true,
  "url": "https://res.cloudinary.com/abc/image/upload/...",
  "thumbnailUrl": "https://res.cloudinary.com/abc/image/upload/..."
}
```

If you see `url: data:image/png;base64,...`, then Cloudinary not configured.

### 3. Test Receipt Capture

```bash
curl -X POST http://localhost:3000/api/driver/receipt-capture \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$(your_token)" \
  -d '{
    "captureRequestId": "test-123",
    "storeName": "Test Store",
    "images": [{
      "url": "https://res.cloudinary.com/abc/image/upload/..." 
    }]
  }'
```

Expected response:
```json
{
  "ok": true,
  "captureId": "507f1f77bcf86cd799439011",
  "status": "pending_parse"
}
```

### 4. Test Gemini Parsing

```bash
curl -X POST http://localhost:3000/api/driver/receipt-parse \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$(your_token)" \
  -d '{"captureId": "507f1f77bcf86cd799439011"}'
```

Expected response:
```json
{
  "ok": true,
  "captureId": "507f1f77bcf86cd799439011",
  "items": [
    {"receiptName": "...", "quantity": 1, "totalPrice": 9.99}
  ]
}
```

### 5. Verify Cloudinary Upload

1. Log into cloudinary.com
2. Go to Media Library
3. Navigate to Folders → gsnacks → receipts
4. Should see uploaded test images

---

## Staging/Production Deployment

### 1. Deploy Code

**Git Push**:
```bash
git add server/config/cloudinary.js
git add server/routes/receipt-prices.js
git add server/.env.example
git commit -m "feat: implement proper Cloudinary setup for receipt uploads"
git push origin main
```

**Render/Railway**:
- Connect Git repository
- Set environment variables (see Section 2 above)
- Deploy

### 2. Verify Deployment

```bash
# Check health endpoint
curl https://your-domain/health

# Check Cloudinary config
curl -X POST https://your-domain/api/driver/upload-receipt-image \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$(your_token)" \
  -d '{"image":"data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}'
```

Expected: Real Cloudinary URL (not data: URL)

### 3. Load Testing

Create 5 test receipts:
- [ ] Verify all appear in Cloudinary Media Library
- [ ] Verify all have Cloudinary URLs in database
- [ ] Verify Gemini parsing works on all
- [ ] Verify items appear in queue

### 4. Smoke Tests

- [ ] Upload receipt from web app
- [ ] See receipt in "Receipt Captures" queue
- [ ] Click "Parse with Gemini"
- [ ] See items populated
- [ ] Click item to bind UPC
- [ ] Complete flow without errors

---

## Post-Deployment

### 1. Monitor Logs

First 24 hours, watch for:
- [ ] No "upload failed" errors
- [ ] No "Cloudinary" errors
- [ ] No "base64 fallback" warnings

```bash
# Render logs
render logs --service your-service-id

# Railway logs
railway logs
```

### 2. Performance Monitoring

Track:
- [ ] Average upload time: < 5 seconds
- [ ] Average parse time: < 10 seconds
- [ ] Error rate: < 1%

### 3. Cost Monitoring

Check Cloudinary dashboard:
- [ ] Usage within free tier (200k/month)
- [ ] No unexpected charges
- [ ] API hits reasonable (~1-10 per upload)

---

## Rollback Plan

If issues occur:

### Option A: Revert to Base64 Fallback

```bash
# Remove Cloudinary env vars from production
# Server will automatically use base64 fallback
```

**Consequences**:
- Larger database
- Slower Gemini parsing
- But uploads still work

### Option B: Revert Code

```bash
git revert <commit_hash>
git push origin main
# Render/Railway auto-redeploys
```

---

## FAQ

### Q: Do I need Cloudinary to use this app?

**A**: No, but recommended. Without it, receipts are stored as base64 (less efficient). See CLOUDINARY_SETUP.md for details.

### Q: How do I get my Cloudinary credentials?

**A**: 
1. Sign up at https://cloudinary.com/console
2. Settings → API Keys
3. Copy Cloud Name, API Key, API Secret

### Q: Can I use a different image storage service?

**A**: Yes! The upload handler is modular. Replace `cloudinary.uploader.upload()` with your service. See `server/routes/receipt-prices.js` lines 34-81.

### Q: Why not upload directly from frontend?

**A**: 
- Security: Keeps API keys server-side
- Privacy: Receipts are financial documents
- Compliance: Server-side audit trail
- Control: Can implement retention policies

### Q: What if upload times out?

**A**: 
1. Frontend retries automatically (idempotency via captureRequestId)
2. Server-side retry logic (up to 3 attempts)
3. If persistent: Check internet connection, Cloudinary status

### Q: Can I test with dummy images?

**A**: Yes, but make sure they're valid image formats:
- JPEG, PNG, WebP, HEIC
- At least 50x50 pixels
- Less than 5MB

### Q: How do I see uploaded receipts?

**A**: 
- User-facing: Management → Receipt Captures queue
- Admin: Cloudinary Media Library → gsnacks/receipts folder
- Database: `ReceiptCapture.images[].url`

---

## Support

### Issue: "Image content failed validation"

**Cause**: Image corrupted or wrong format
**Fix**: 
- Try with different image format
- Check image file isn't corrupted
- See CLOUDINARY_SETUP.md → Troubleshooting

### Issue: "Cloudinary upload failed"

**Cause**: Missing/wrong credentials or API credit
**Fix**:
- Verify env vars: `echo $CLOUDINARY_CLOUD_NAME`
- Check Cloudinary account has API credits
- See CLOUDINARY_SETUP.md → Troubleshooting

### Issue: Uploads work but Gemini returns empty

**Cause**: Image quality too low or receipt text too small
**Fix**:
- Ensure receipt is well-lit
- Capture full receipt in frame
- High resolution phone camera preferred

---

## Success Criteria

✅ **Deployment successful when**:
1. Receipts upload to Cloudinary (visible in Media Library)
2. Database stores Cloudinary URLs (not base64)
3. Gemini receives Cloudinary URLs (no base64)
4. Items parsed correctly on first try
5. Users can complete full workflow without errors
6. No "base64 fallback" warnings in logs
7. Cloudinary costs within budget (~$10/month)
