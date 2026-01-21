# Receipt Upload Pipeline (Complete Architecture)

## High-Level Flow

```
📱 Frontend (User)
   ↓
📸 Capture/Select Photo
   ↓
🔄 Convert to Base64
   ↓
📤 POST /api/driver/receipt-capture
   ↓
🔐 Server (Authentication)
   ↓
☁️ Cloudinary (Upload Image)
   ↓
💾 Database (Store URL + Metadata)
   ↓
🤖 Gemini Vision (Parse Items)
   ↓
📝 Save Parsed Items
   ↓
✅ Frontend: Display in Queue
```

---

## Step 1: Frontend Captures/Selects Photo

### Components (Updated 2026-01-21)

**ScannerPanel.tsx** (Unified Scanner)
- Single camera interface with UPC scanning + photo capture
- ⚡ Lightning button for instant photo + auto-upload
- Auto-parse with Gemini Vision API
- Used across all roles: Management, Driver, Customer

**DriverOrderDetail.tsx** (Driver Auto-Upload)
- "Auto Receipt" button opens unified scanner
- Driver clicks ⚡ to capture photo
- Instant upload to Cloudinary → Auto-parse → Success toast
- No manual steps required

**Deprecated (DELETED):**
- ❌ ReceiptPhotoCapture.tsx - Replaced by ScannerPanel
- ❌ LiveReceiptScanner.tsx - Replaced by ScannerPanel

### Code Flow (Updated)

```typescript
// ReceiptPhotoCapture.tsx
const file = /* user selected file */;
const reader = new FileReader();
reader.readAsDataURL(file);
const base64Data = reader.result;  // "data:image/jpeg;base64,..."

// Send to backend
const response = await fetch('/api/driver/receipt-capture', {
  method: 'POST',
  body: JSON.stringify({
    captureRequestId: uuid(),
    storeName: userSelectedStore,
    images: [{ url: base64Data }]
  })
});
```

---

## Step 2: Server Receives Base64

### Endpoint: POST /api/driver/receipt-capture

**Location**: `server/routes/receipt-prices.js`

**Request Body**:
```json
{
  "captureRequestId": "unique-id-for-idempotency",
  "storeName": "Walmart Dearborn",
  "images": [
    {
      "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "thumbnailUrl": "..." // optional
    }
  ]
}
```

**Server Validation**:
- ✅ Auth check (owner or driver)
- ✅ Image count (1-3)
- ✅ Image validation (magic bytes)
- ✅ Base64 size (max 5MB per image)
- ✅ Idempotency (prevent duplicate captures on retry)

**Store Handling**:
- Find store by name
- If not found, auto-create with geocoding
- Save store location (lat/lng) for routing

---

## Step 3: Upload to Cloudinary

### Handler: handleReceiptImageUpload()

```javascript
// server/routes/receipt-prices.js

const handleReceiptImageUpload = async (base64Data) => {
  // 1. Ensure data URL format
  const dataUrl = base64Data.startsWith('data:')
    ? base64Data
    : `data:image/jpeg;base64,${base64Data}`;
  
  // 2. Validate image (magic bytes check)
  if (!isAllowedImageDataUrl(dataUrl)) {
    throw new Error('Image validation failed');
  }
  
  // 3. Fallback if Cloudinary not configured
  if (!hasCloudinary) {
    return { url: dataUrl, thumbnailUrl: dataUrl };
  }
  
  // 4. Upload to Cloudinary
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: RECEIPT_UPLOAD_FOLDER,  // 'gsnacks/receipts'
    resource_type: 'image',
    transformation: [{ width: 1600, crop: 'limit' }],
    eager: [{ width: 400, crop: 'limit' }]
  });
  
  // 5. Return HTTPS URL
  return {
    url: result.secure_url,  // "https://res.cloudinary.com/..."
    thumbnailUrl: result.eager[0].secure_url
  };
};
```

**Output**:
```json
{
  "url": "https://res.cloudinary.com/abc/image/upload/v123456/gsnacks/receipts/xyz.jpg",
  "thumbnailUrl": "https://res.cloudinary.com/abc/image/upload/w_400/gsnacks/receipts/xyz.jpg"
}
```

---

## Step 4: Save to Database

### Model: ReceiptCapture

```javascript
// server/models/ReceiptCapture.js

const capture = new ReceiptCapture({
  captureRequestId,  // For idempotency
  storeId: store._id,
  storeName: store.name,
  images: [
    {
      url: cloudinaryUrl,        // HTTPS URL from Cloudinary
      thumbnailUrl: cloudinaryUrl,
      uploadedAt: new Date(),
      sequence: 1
    }
  ],
  status: 'pending_parse',       // Ready for Gemini parsing
  createdBy: username,
  createdAt: new Date()
});

await capture.save();
```

**Database Record**:
```json
{
  "_id": ObjectId("..."),
  "captureRequestId": "live_1234567890_abc",
  "storeId": ObjectId("..."),
  "storeName": "Walmart Dearborn",
  "images": [
    {
      "url": "https://res.cloudinary.com/...",  // ← Permanent URL
      "thumbnailUrl": "https://res.cloudinary.com/...",
      "uploadedAt": "2026-01-21T14:30:00Z",
      "sequence": 1
    }
  ],
  "status": "pending_parse",
  "createdBy": "driver1",
  "createdAt": "2026-01-21T14:30:00Z"
}
```

---

## Step 5: Gemini Parses Items

### Endpoint: POST /api/driver/receipt-parse

**Location**: `server/routes/receipt-prices.js`

**Flow**:
1. Get ReceiptCapture from database
2. For each image:
   - Get the CLOUDINARY URL (not base64)
   - Send to Gemini Vision API
   - Extract items and address
3. Save parsed items to ReceiptCapture

**Critical**: Use Cloudinary URL, not Base64

```javascript
// Before: ❌ Sending base64 (inefficient)
const imageBase64 = Buffer.from(imageBuffer).toString('base64');
response = await gemini.generateContent({
  parts: [{
    inline_data: {
      data: imageBase64,  // ❌ Large payload
      mime_type: 'image/jpeg'
    }
  }]
});

// After: ✅ Sending Cloudinary URL (efficient)
const cloudinaryUrl = capture.images[0].url;  // "https://..."
response = await gemini.generateContent({
  parts: [{
    url: cloudinaryUrl  // ✅ Just a URL
  }]
});
```

**Gemini Prompt**:
```
You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE ADDRESS if visible.
THEN, extract ALL line items with prices.

Return ONLY valid JSON:
{
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store address if visible
2. Extract ONLY product line items
3. Use exact product names
4. Skip store name, date, tax, subtotal, total
5. Return empty array [] if unclear
6. Return ONLY valid JSON, no markdown
```

**Gemini Response**:
```json
{
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "quantity": 1, "totalPrice": 3.99},
    {"receiptName": "BOUNTY PAPER TWL", "quantity": 2, "totalPrice": 5.98}
  ]
}
```

---

## Step 6: Save Parsed Items

### Update ReceiptCapture

```javascript
// Save parsed items
capture.draftItems = items.map(item => ({
  receiptName: item.receiptName,
  quantity: item.quantity,
  totalPrice: item.totalPrice,
  needsUpcReview: true,  // Requires UPC binding in next step
  needsPriceReview: false
}));

// Update store address if found
if (extractedAddress) {
  const store = await Store.findById(capture.storeId);
  store.address = parseAddress(extractedAddress);
  store.location = await geocode(extractedAddress);
  await store.save();
}

// Mark as parsed
capture.status = 'parsed';
capture.parseError = null;
await capture.save();
```

**Database After Parsing**:
```json
{
  "status": "parsed",           // ← Changed from "pending_parse"
  "draftItems": [
    {
      "receiptName": "COCA COLA 12PK",
      "quantity": 2,
      "totalPrice": 15.98,
      "needsUpcReview": true
    },
    ...
  ],
  "itemsNeedingReview": 3,
  "parseError": null
}
```

---

## Step 7: Frontend Shows in Queue

### Component: ManagementReceiptScanner

**Display**:
- Receipt image thumbnail (from Cloudinary URL)
- Parsed items with prices
- Button: "Bind UPCs" for product matching
- Button: "Retry Parse" if parse failed

**User Workflow**:
1. See receipt in queue with parsed items
2. Click item → search for matching product
3. Bind item to product (creates ReceiptNameAlias)
4. Click "Save" → items added to order

---

## Complete Data Flow Example

### 1. Frontend Upload
```
User: Selects photo from camera
→ base64: "data:image/jpeg;base64,/9j/4AAQ..."
→ POST /api/driver/receipt-capture
```

### 2. Server Processing
```
Validate image
→ Upload to Cloudinary
→ URL: "https://res.cloudinary.com/abc/image/upload/gsnacks/receipts/xyz.jpg"
→ Save to DB
→ POST /api/driver/receipt-parse
```

### 3. Gemini Parsing
```
Fetch Cloudinary URL
→ Send to Gemini Vision API
→ Parse items: ["COCA COLA 12PK", "LAYS CHIPS", ...]
→ Save to DB with status="parsed"
```

### 4. Frontend Display
```
GET /api/driver/receipt-captures
→ Show in queue with thumbnail + items
→ User clicks "Bind UPCs"
→ System matches items to products
```

---

## Error Handling

### If Image Validation Fails
```
❌ 400 Bad Request: "Image content failed validation"
Solution: Image is corrupted or wrong format
Retry: User re-selects photo
```

### If Cloudinary Upload Fails
```
❌ 500 Server Error: "Cloudinary upload failed: ..."
Solution: Check CLOUDINARY_* env vars, API credits
Fallback: Use base64 (less efficient)
```

### If Gemini Parse Fails
```
❌ 503 Service Unavailable: "Gemini service overloaded"
Solution: Automatic retry, exponential backoff
Fallback: Show empty items list, manual entry
```

### If Network Timeout
```
❌ Timeout fetching image from Cloudinary
Solution: Automatic retry (up to 3 times)
Fallback: Use data URL from memory cache
```

---

## Configuration

### Environment Variables

**Required**:
```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
GEMINI_API_KEY=your_gemini_key
```

**Optional**:
```bash
CLOUDINARY_RECEIPT_FOLDER=gsnacks/receipts
CLOUDINARY_RECEIPT_EXPIRATION=540  # 18 months
```

### Deployment

1. Copy `.env.example` to `.env.production`
2. Fill in all CLOUDINARY_* and GEMINI_API_KEY values
3. Deploy to Render/Railway/etc.
4. Verify: `curl https://your-domain/health` → should return 200

---

## Performance Metrics

- **Upload**: 2-5 seconds (file → Cloudinary)
- **Database save**: 0.1 seconds
- **Gemini parse**: 3-8 seconds (depends on image complexity)
- **Total**: ~5-13 seconds from capture to parsed queue

## Cost Estimation

- **Cloudinary**: ~$0.01 per image (200k free/month)
- **Gemini Vision**: ~$0.00075 per image (1500 req/min free)
- **Google Maps Geocoding**: ~$0.005 per address

**Monthly for 1000 receipts**: ~$10-15
