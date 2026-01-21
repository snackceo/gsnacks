# Cloudinary Setup for Receipt Uploads

## Overview

Receipts are **legal/financial artifacts** and must be stored server-side with proper:
- Secure storage (Cloudinary)
- Permanent audit trail
- Compliance with retention policies
- Access via Gemini URLs (not base64)

## Architecture

```
Frontend
   ↓ (File upload)
Server /api/driver/receipt-capture
   ↓ (Convert to base64)
Cloudinary (Secure Storage)
   ↓ (Return HTTPS URL)
Database (Store URL reference)
   ↓ (Use URL in Gemini requests)
Gemini Vision API (Parse items from image)
```

## Setup Steps

### 1. Create Cloudinary Account

1. Go to https://cloudinary.com
2. Sign up for free account
3. Go to Settings → API Keys
4. Copy your credentials:
   - Cloud Name
   - API Key
   - API Secret

### 2. Set Environment Variables

Add to your `server/.env`:

```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Optional: Custom folder name
CLOUDINARY_RECEIPT_FOLDER=gsnacks/receipts
```

### 3. Deployment (Render, Railway, etc.)

Add these same variables as environment variables in your deployment platform dashboard.

### 4. Test Upload

1. Upload a receipt photo from the app
2. Check Cloudinary Media Library → should see receipts in folder
3. Check browser console → should NOT see "base64 fallback" warning
4. Check server logs → should show `✅ Cloudinary configured`

## How It Works

### Upload Flow

```javascript
// Frontend
const file = /* selected photo */;
const base64 = await readAsDataURL(file);
POST /api/driver/receipt-capture { images: [{url: base64}] }

// Server
const dataUrl = req.body.images[0].url;  // data:image/jpeg;base64,...
const result = await cloudinary.uploader.upload(dataUrl, {
  folder: 'gsnacks/receipts'
});
// Returns: { secure_url: 'https://res.cloudinary.com/...' }

// Database
receipt.images[0].url = result.secure_url;  // Store permanent URL
await receipt.save();
```

### Parsing Flow

```javascript
// Gemini receives URL directly (not base64)
const response = await gemini.generateContent({
  parts: [
    { text: 'Parse this receipt...' },
    { url: receipt.images[0].url }  // ← HTTPS URL from Cloudinary
  ]
});
```

**Benefits**:
- ✅ No payload size limits
- ✅ No memory pressure on server
- ✅ Permanent audit trail
- ✅ Cloudinary handles caching & CDN

## Fallback Mode (Base64)

If Cloudinary is **not** configured:
- Receipts stored as base64 data URLs in database
- ⚠️ Less efficient, larger database
- ⚠️ Server sends base64 to Gemini (payload size issues)
- ⚠️ No CDN caching

Current config logs a warning if not set:
```
⚠️ Cloudinary not configured. Receipt uploads will use base64 fallback.
```

To enable: Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

## Security Best Practices

### ✅ DO:
- Store secrets in environment variables only
- Use API Secret on backend only (never expose to frontend)
- Verify image URLs come from Cloudinary
- Set auto-delete policies (retention: 18 months)
- Enable signed URLs for sensitive receipts

### 🚫 DON'T:
- Expose API Secret in frontend code
- Upload directly from browser to Cloudinary
- Store unencrypted base64 in database
- Use Cloudinary for product images (receipts only)

## Cloudinary Folder Structure

Receipts automatically upload to:
```
gsnacks/receipts/
  ├── [public_id_based_on_timestamp].jpg
  ├── [public_id_based_on_timestamp].jpg
  └── ...
```

View in Cloudinary console:
1. Log in to cloudinary.com
2. Media Library → Folders → gsnacks/receipts
3. See all uploaded receipt photos

## Optional: Enable Advanced Features

### Signed URLs (Security)
```javascript
const signed_url = cloudinary.utils.private_download_url(
  receipt.images[0].publicId,
  'jpg',
  { sign_url: true, expiration: 3600 } // 1 hour expiration
);
```

### Auto-delete After 18 Months
Cloudinary Settings → Upload → Auto delete (set to 18 months)

### Disable Image Moderation (Receipts are Text-Heavy)
- Receipts are primarily text, not images
- Image moderation adds unnecessary delay
- Already disabled by default

## Troubleshooting

### Upload Returns 500 Error

**Check**: Is `CLOUDINARY_CLOUD_NAME` set?
```bash
# Test on server:
echo $CLOUDINARY_CLOUD_NAME
# Should print your cloud name, not empty
```

If empty, update `.env` and restart server.

### Gemini Receives Base64 Instead of URL

**Check**: Is image URL HTTPS?
```javascript
// Good:
https://res.cloudinary.com/abc/image/upload/v12345/gsnacks/receipts/abc.jpg

// Bad:
data:image/jpeg;base64,/9j/4AAQSkZJRg...
```

Server automatically uses URLs for Cloudinary images.

### Receipt Images Not Appearing in Cloudinary Console

**Check**: 
1. Deployment has correct env vars set
2. Server logs show `✅ Cloudinary configured`
3. Folder path is correct (default: `gsnacks/receipts`)

## References

- Cloudinary API: https://cloudinary.com/documentation/image_upload_api_reference
- Gemini Vision: https://ai.google.dev/tutorials/python_quickstart
