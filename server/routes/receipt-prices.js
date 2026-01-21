import express from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { GoogleGenAI } from '@google/genai';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import { authRequired, isDriverUsername, isOwnerUsername, driverCanAccessStore } from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { isDbReady } from '../db/connect.js';

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const ensureGeminiReady = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Gemini API key not configured.' };
  }
  return { ok: true, apiKey };
};

// Extract base64 and mime from data URL
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

// Upload handler: Cloudinary if configured, else data URL fallback
const handleReceiptImageUpload = async (base64Data) => {
  if (!base64Data) {
    throw new Error('No image data provided');
  }

  // Ensure data URL format
  const dataUrl = base64Data.startsWith('data:')
    ? base64Data
    : `data:image/jpeg;base64,${base64Data}`;

  // Log initial validation
  const validationResult = isAllowedImageDataUrl(dataUrl);
  if (!validationResult) {
    console.error('Image validation failed. Data URL length:', dataUrl.length);
    console.error('Starts with data:', dataUrl.substring(0, 50));
    throw new Error('Image content failed validation - invalid format or corrupted data');
  }

  // Fallback: return data URL if Cloudinary not configured
  if (!hasCloudinary) {
    return {
      url: dataUrl,
      thumbnailUrl: dataUrl
    };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    console.error('Failed to parse data URL');
    throw new Error('Invalid data URL format');
  }

  try {
    const uploadResult = await cloudinary.uploader.upload(dataUrl, {
      folder: RECEIPT_UPLOAD_FOLDER,
      resource_type: 'image',
      overwrite: false,
      transformation: [{ width: 1600, crop: 'limit' }],
      eager: [{ width: 400, crop: 'limit' }]
    });

    return {
      url: uploadResult.secure_url,
      thumbnailUrl: uploadResult.eager?.[0]?.secure_url || uploadResult.secure_url
    };
  } catch (uploadErr) {
    console.error('Cloudinary upload failed:', uploadErr.message);
    throw new Error(`Cloudinary upload failed: ${uploadErr.message}`);
  }
};

// Validate data URL magic bytes (best-effort) to ensure it's an image
function isAllowedImageDataUrl(dataUrl) {
  if (!dataUrl.startsWith('data:')) {
    console.error('Data URL does not start with data:');
    return false;
  }
  
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    console.error('Data URL does not match base64 format');
    return false;
  }
  
  const mime = (match[1] || '').toLowerCase();
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  
  if (!allowedMimes.includes(mime)) {
    console.error('MIME type not allowed:', mime);
    return false;
  }

  try {
    const base64 = match[2];
    if (!base64 || base64.length === 0) {
      console.error('Base64 data is empty');
      return false;
    }
    
    // For very short base64 (less than 100 chars or ~75 bytes), skip validation
    // These might be partially captured frames or test data
    if (base64.length < 100) {
      console.warn('Base64 data very short, skipping magic byte check:', base64.length, 'chars');
      return true;
    }
    
    // Decode first 12 bytes to check magic numbers
    let buf;
    try {
      buf = Buffer.from(base64.slice(0, 80), 'base64'); // More generous buffer
    } catch (bufErr) {
      console.error('Failed to decode base64 to buffer:', bufErr.message);
      return false;
    }
    
    if (buf.length < 2) {
      console.warn('Buffer too short for magic byte check, accepting anyway');
      return true;
    }

    // Check magic bytes for JPEG (most common for canvas)
    // JPEG: FFD8FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && (buf.length < 3 || buf[2] === 0xff)) {
      console.log('Recognized as JPEG');
      return true;
    }
    
    // PNG: 89504E47
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      console.log('Recognized as PNG');
      return true;
    }
    
    // WebP: RIFF...WEBP
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      console.log('Recognized as WebP');
      return true;
    }
    
    // HEIF/HEIC: ftyp variants
    if (buf.length >= 12) {
      try {
        const brand = buf.toString('ascii', 4, 12);
        const isHeic = brand.includes('ftypheic') || brand.includes('ftypheix') || 
                       brand.includes('ftyphevc') || brand.includes('ftyphevx') || 
                       brand.includes('ftypmif1');
        if (isHeic) {
          console.log('Recognized as HEIC/HEIF');
          return true;
        }
      } catch (err) {
        // Ignore errors reading brand
      }
    }

    // If we get here and mime type is image/jpeg, allow it anyway
    // (Canvas generated JPEGs might not have standard headers in all cases)
    if (mime === 'image/jpeg') {
      console.warn('MIME says JPEG but magic bytes do not match standard JPEG header. Allowing anyway.');
      return true;
    }

    console.warn('Magic bytes do not match known image formats. First bytes:', Array.from(buf.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    return false;
  } catch (err) {
    console.error('Data URL validation failed:', err);
    return false;
  }
}

const router = express.Router();

// Tight rate limit for receipt endpoints to reduce abuse and control OCR costs
const receiptLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60, // 60 actions per 10 minutes per IP
  standardHeaders: true,
  legacyHeaders: false
});

router.use(receiptLimiter);

// Check if Cloudinary is properly configured
const hasCloudinary = isCloudinaryConfigured();
if (!hasCloudinary) {
  console.warn('⚠️ Cloudinary not configured. Receipt uploads will use base64 fallback.');
} else {
  console.log('✅ Cloudinary configured for receipt uploads');
}

// Default Cloudinary folder for receipt uploads
const RECEIPT_UPLOAD_FOLDER = process.env.CLOUDINARY_RECEIPT_FOLDER || 'gsnacks/receipts';

// Normalization rules
const ABBREVIATIONS = {
  'PK': 'PACK', 'P': 'PACK', 'PACK': 'PACK',
  'OZ': 'OZ', 'FL OZ': 'OZ', 'FLOZ': 'OZ', 'OUNCE': 'OZ',
  'LT': 'L', 'LITER': 'L', 'LTR': 'L',
  'BTL': 'BOTTLE', 'BT': 'BOTTLE'
};

const STORE_NOISE = ['WM', 'TGT', 'ALDI', 'MEIJ', 'MEIJER', 'KROG', 'KROGER'];

// Critical tokens that must match
const BRAND_TOKENS = ['COKE', 'COCA', 'COLA', 'PEPSI', 'FAYGO', 'SPRITE', 'FANTA', 'DR PEPPER', 'MTN DEW', 'MOUNTAIN DEW'];
const SIZE_TOKENS = /(\d+)\s*(PACK|PK|P|OZ|L|LT|LITER|ML)/gi;
const DIET_TOKENS = ['DIET', 'ZERO', 'LIGHT', 'LITE'];
const FLAVOR_TOKENS = ['CHERRY', 'VANILLA', 'LEMON', 'LIME', 'ORANGE', 'GRAPE', 'STRAWBERRY'];

// Promo detection keywords
const PROMO_KEYWORDS = ['DISC', 'COUP', 'SAVE', 'SALE', 'PROMO', 'DEAL', '2/$', '3/$', '2 FOR', '3 FOR'];

// Category classification (simple keyword-based)
const CATEGORY_KEYWORDS = {
  'beverage': ['COKE', 'PEPSI', 'SPRITE', 'WATER', 'JUICE', 'SODA', 'POP', 'TEA', 'COFFEE'],
  'dairy': ['MILK', 'CHEESE', 'BUTTER', 'YOGURT', 'CREAM', 'EGGS'],
  'snack': ['CHIPS', 'COOKIES', 'CRACKERS', 'CANDY', 'NUTS', 'POPCORN'],
  'frozen': ['ICE', 'FROZEN', 'PIZZA'],
  'produce': ['APPLE', 'BANANA', 'ORANGE', 'LETTUCE', 'TOMATO']
};

// Category price guardrails (unit price)
const CATEGORY_PRICE_BOUNDS = {
  beverage: { min: 0.5, max: 20 },
  dairy: { min: 0.5, max: 25 },
  snack: { min: 0.25, max: 15 },
  frozen: { min: 1, max: 30 },
  produce: { min: 0.1, max: 20 },
  other: { min: 0.1, max: 50 }
};

function isWithinCategoryBounds(category, unitPrice) {
  const bounds = CATEGORY_PRICE_BOUNDS[category] || CATEGORY_PRICE_BOUNDS.other;
  return unitPrice >= bounds.min && unitPrice <= bounds.max;
}

/**
 * Normalize receipt name for matching
 */
function normalizeReceiptName(name) {
  if (!name) return '';
  
  let normalized = name.toUpperCase().trim();
  
  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, ' ');
  
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Expand abbreviations
  Object.entries(ABBREVIATIONS).forEach(([abbr, full]) => {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    normalized = normalized.replace(regex, full);
  });
  
  // Remove store noise
  STORE_NOISE.forEach(noise => {
    const regex = new RegExp(`\\b${noise}\\b`, 'g');
    normalized = normalized.replace(regex, '');
  });
  
  // Collapse whitespace again
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Classify product category from normalized name
 */
function classifyCategory(normalizedName) {
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => normalizedName.includes(kw))) {
      return category;
    }
  }
  return 'other';
}

/**
 * Detect if price appears to be promotional
 */
function detectPromo(receiptName, context = {}) {
  const upperName = (receiptName || '').toUpperCase();
  return PROMO_KEYWORDS.some(kw => upperName.includes(kw));
}

/**
 * Validate UPC format
 */
function validateUPC(upc) {
  if (!upc) return false;
  return /^\d{8,14}$/.test(upc);
}

/**
 * Validate price and quantity
 */
function validatePriceQuantity(price, quantity) {
  if (typeof price !== 'number' || !isFinite(price) || price < 0 || price > 10000) {
    return { ok: false, error: 'Invalid price (must be 0-10000)' };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
    return { ok: false, error: 'Invalid quantity (must be 1-1000)' };
  }
  return { ok: true };
}

const PRICE_HISTORY_MATCH_METHODS = new Set([
  'upc',
  'sku',
  'alias_confirmed',
  'fuzzy_confirmed',
  'fuzzy_suggested',
  'manual_confirm'
]);
const PRICE_HISTORY_PRICE_TYPES = new Set(['regular', 'net_paid', 'promo', 'unknown']);
const PRICE_HISTORY_WORKFLOW_TYPES = new Set(['new_product', 'update_price']);

function normalizePriceHistoryEnum(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function buildPriceHistoryEntry({
  price,
  observedAt = new Date(),
  storeId,
  captureId,
  orderId,
  quantity,
  receiptImageUrl,
  receiptThumbnailUrl,
  matchMethod,
  matchConfidence,
  confirmedBy,
  priceType,
  promoDetected,
  workflowType
}) {
  return {
    price,
    observedAt,
    storeId,
    captureId: captureId || undefined,
    orderId: orderId || undefined,
    quantity: Number.isFinite(quantity) ? Number(quantity) : undefined,
    receiptImageUrl: receiptImageUrl || undefined,
    receiptThumbnailUrl: receiptThumbnailUrl || undefined,
    matchMethod: normalizePriceHistoryEnum(matchMethod, PRICE_HISTORY_MATCH_METHODS, 'manual_confirm'),
    matchConfidence: typeof matchConfidence === 'number' ? matchConfidence : undefined,
    confirmedBy: confirmedBy || undefined,
    priceType: normalizePriceHistoryEnum(priceType, PRICE_HISTORY_PRICE_TYPES, 'unknown'),
    promoDetected: Boolean(promoDetected),
    workflowType: normalizePriceHistoryEnum(workflowType, PRICE_HISTORY_WORKFLOW_TYPES, undefined)
  };
}

/**
 * Extract critical tokens from normalized name
 */
function extractTokens(normalizedName) {
  const tokens = {
    brand: null,
    sizes: [],
    diet: false,
    flavors: [],
    hasSizeToken: false
  };
  
  // Extract brand
  for (const brand of BRAND_TOKENS) {
    if (normalizedName.includes(brand)) {
      tokens.brand = brand;
      break;
    }
  }
  
  // Extract sizes
  const sizeMatches = normalizedName.matchAll(SIZE_TOKENS);
  for (const match of sizeMatches) {
    tokens.sizes.push(match[0]);
  }
  tokens.hasSizeToken = tokens.sizes.length > 0;
  
  // Check for diet/zero
  tokens.diet = DIET_TOKENS.some(dt => normalizedName.includes(dt));
  
  // Extract flavors
  for (const flavor of FLAVOR_TOKENS) {
    if (normalizedName.includes(flavor)) {
      tokens.flavors.push(flavor);
    }
  }
  
  return tokens;
}

/**
 * Check if critical tokens match between two names
 */
function tokensMatch(tokens1, tokens2) {
  // Brand must match if present in both
  if (tokens1.brand && tokens2.brand && tokens1.brand !== tokens2.brand) {
    return false;
  }
  
  // Size/pack must match if present in both
  if (tokens1.sizes.length > 0 && tokens2.sizes.length > 0) {
    const sizes1 = tokens1.sizes.join(' ');
    const sizes2 = tokens2.sizes.join(' ');
    if (sizes1 !== sizes2) {
      return false; // Different pack size = no auto-match
    }
  }
  
  // Diet/zero must match
  if (tokens1.diet !== tokens2.diet) {
    return false;
  }
  
  // Flavors must match if present in both
  if (tokens1.flavors.length > 0 && tokens2.flavors.length > 0) {
    const flavors1Set = new Set(tokens1.flavors);
    const flavors2Set = new Set(tokens2.flavors);
    const intersection = [...flavors1Set].filter(f => flavors2Set.has(f));
    if (intersection.length === 0) {
      return false; // No common flavors = no match
    }
  }
  
  return true;
}

/**
 * Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Advanced fuzzy matching with token gating
 */
function advancedMatch(receiptName, productName) {
  const norm1 = normalizeReceiptName(receiptName);
  const norm2 = normalizeReceiptName(productName);
  
  // Extract tokens
  const tokens1 = extractTokens(norm1);
  const tokens2 = extractTokens(norm2);
  
  // Check token match first
  if (!tokensMatch(tokens1, tokens2)) {
    return { score: 0, tokensMatch: false, normalized1: norm1, normalized2: norm2 };
  }
  
  // Calculate similarity
  const distance = levenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const score = maxLen === 0 ? 1 : 1 - distance / maxLen;
  
  return { score, tokensMatch: true, normalized1: norm1, normalized2: norm2 };
}

/**
 * POST /api/driver/upload-receipt-image
 * Upload a single receipt image (MVP: base64 data URL)
 * Production: integrate with Cloudinary/S3 for real storage
 */
router.post('/upload-receipt-image', authRequired, async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Image data required' });
    }

    // Enforce size limit (max 5MB per image, consistent with receipt-capture)
    if (typeof image === 'string' && image.length > 5 * 1024 * 1024) {
      const sizeMB = (image.length / (1024 * 1024)).toFixed(1);
      return res.status(413).json({ error: `Image too large: ${sizeMB}MB (max 5MB)` });
    }

    const result = await handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error.message);
    // Return specific error messages so frontend can debug
    res.status(500).json({ 
      error: error.message || 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 * Idempotent: uses captureRequestId to prevent duplicate captures on retry
 */
router.post('/receipt-capture', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, storeName, orderId, images, captureRequestId } = req.body;
    const username = req.user?.username;

    // Authorization check
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to upload receipts' });
    }

    // Idempotency: check if this captureRequestId already exists
    if (captureRequestId && typeof captureRequestId === 'string' && captureRequestId.length >= 8) {
      const existingCapture = await ReceiptCapture.findOne({ 
        captureRequestId,
        createdBy: username
      });
      if (existingCapture) {
        // Return existing capture (idempotent)
        return res.json({
          ok: true,
          captureId: existingCapture._id.toString(),
          status: existingCapture.status,
          imageCount: existingCapture.images.length,
          idempotent: true
        });
      }
    } else if (!captureRequestId) {
      return res.status(400).json({ error: 'captureRequestId required (UUID recommended)' });
    }

    // Validation
    if (!storeName || typeof storeName !== 'string') {
      return res.status(400).json({ error: 'storeName is required' });
    }
    if (!images || !Array.isArray(images) || images.length === 0 || images.length > 3) {
      return res.status(400).json({ error: 'images array required (1-3 photos)' });
    }

    // Find or create store by name
    let store;
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      // If storeId provided, verify it exists
      store = await Store.findById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }
    } else {
      // If no storeId, find or create store by name
      store = await Store.findOne({ name: storeName });
      if (!store) {
        // Auto-create store from receipt with optional geocoding
        const storeData = {
          name: storeName,
          createdFrom: 'receipt_upload',
          createdAt: new Date()
        };

        // Try to geocode the store name if it looks like an address
        // (e.g., "Walmart Dearborn" → geocode "Walmart Dearborn, MI")
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey && storeName.length > 5) {
          try {
            const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
            geocodeUrl.searchParams.set('address', storeName);
            geocodeUrl.searchParams.set('key', apiKey);
            
            const geocodeResp = await fetch(geocodeUrl.toString());
            const geocodeData = await geocodeResp.json();
            
            if (geocodeData.status === 'OK' && geocodeData.results?.[0]?.geometry?.location) {
              const loc = geocodeData.results[0].geometry.location;
              storeData.location = { lat: loc.lat, lng: loc.lng };
              console.log(`Geocoded ${storeName}: ${loc.lat}, ${loc.lng}`);
            }
          } catch (geocodeErr) {
            // Non-blocking - continue without location
            console.warn(`Geocoding failed for ${storeName}:`, geocodeErr.message);
          }
        }

        store = new Store(storeData);
        await store.save();
        console.log(`Auto-created store: ${storeName} (${store._id})${storeData.location ? ' with location' : ''}`);
      }
    }

    // Enforce driver-store binding
    if (isDriver && !driverCanAccessStore(username, store._id.toString())) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    // Validate image URLs and sizes
    for (const img of images) {
      if (!img.url || typeof img.url !== 'string') {
        return res.status(400).json({ error: 'Each image must have a url' });
      }
      // Validate data URL size (max 5MB per image)
      if (img.url.startsWith('data:')) {
        const sizeMB = img.url.length / (1024 * 1024);
        if (sizeMB > 5) {
          return res.status(400).json({ error: `Image too large: ${sizeMB.toFixed(1)}MB (max 5MB)` });
        }

        const mimeMatch = img.url.match(/^data:([^;]+);base64,/i);
        const mime = mimeMatch?.[1] || '';
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
        if (!allowedMimes.includes(mime.toLowerCase())) {
          return res.status(400).json({ error: `Unsupported image type: ${mime || 'unknown'}` });
        }

        if (!isAllowedImageDataUrl(img.url)) {
          return res.status(400).json({ error: 'Image content failed validation (corrupt or unsupported)' });
        }
      } else {
        // Non-data URLs must be valid image URLs (HTTPS, allowed hosts, content-type check)
        if (!img.url.startsWith('https://')) {
          return res.status(400).json({ error: 'Image URLs must use HTTPS' });
        }
        
        const urlObj = new URL(img.url);
        const allowedHosts = ['cloudinary.com', 'res.cloudinary.com'];
        const isAllowedHost = allowedHosts.some(host => urlObj.hostname?.includes(host));
        if (!isAllowedHost) {
          return res.status(400).json({ error: 'Only Cloudinary image URLs are allowed' });
        }
        
        // Verify content-type by HEAD request
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const headResp = await fetch(img.url, { method: 'HEAD', signal: controller.signal });
          clearTimeout(timeoutId);
          const ct = (headResp.headers.get('content-type') || '').toLowerCase();
          const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
          if (!allowedMimes.some(m => ct.includes(m))) {
            return res.status(400).json({ error: `Unsupported content-type: ${ct}` });
          }
        } catch (headErr) {
          console.warn('HEAD request failed for image URL:', img.url, headErr.message);
          // Don't fail entirely, but log for investigation
        }
      }
    }

    // Create ReceiptCapture record
    const capture = new ReceiptCapture({
      captureRequestId, // For idempotency
      storeId: store._id.toString(),
      storeName: store.name,
      orderId: orderId || undefined,
      images: images.map((img, idx) => ({
        url: img.url,
        thumbnailUrl: img.thumbnailUrl || img.url,
        uploadedAt: new Date(),
        sequence: idx + 1
      })),
      status: 'pending_parse',
      createdBy: username || 'unknown'
    });

    await capture.save();

    await recordAuditLog({
      type: 'receipt_capture_create',
      actorId: username || 'unknown',
      details: `store=${storeId} images=${capture.images.length} capture=${capture._id.toString()}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      imageCount: capture.images.length
    });

  } catch (error) {
    console.error('Error creating receipt capture:', error);
    res.status(500).json({ error: 'Failed to create receipt capture' });
  }
});

/**
 * GET /api/driver/receipt-capture/:captureId
 * Get receipt capture status and parsed items
 */
router.get('/receipt-capture/:captureId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    res.json({
      ok: true,
      capture: {
        _id: capture._id,
        storeId: capture.storeId,
        storeName: capture.storeName,
        orderId: capture.orderId,
        status: capture.status,
        images: capture.images,
        draftItems: capture.draftItems,
        stats: {
          totalItems: capture.totalItems,
          itemsNeedingReview: capture.itemsNeedingReview,
          itemsConfirmed: capture.itemsConfirmed,
          itemsCommitted: capture.itemsCommitted
        },
        parseError: capture.parseError,
        createdAt: capture.createdAt,
        reviewExpiresAt: capture.reviewExpiresAt
      }
    });

  } catch (error) {
    console.error('Error fetching receipt capture:', error);
    res.status(500).json({ error: 'Failed to fetch receipt capture' });
  }
});

/**
 * POST /api/driver/receipt-parse
 * Trigger Gemini parse for a receipt capture
 * Extracts line items from receipt images using Gemini Vision API
 * Matches items to products and sets needsReview flags
 */
router.post('/receipt-parse', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    // Authorize: only owner or driver can parse for their stores
    const isOwner = isOwnerUsername(req.user?.username);
    const isDriver = isDriverUsername(req.user?.username);
    if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to parse receipts' });
    }

    // Enforce driver-store binding
    if (isDriver && !driverCanAccessStore(req.user?.username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    if (capture.status !== 'pending_parse' && capture.status !== 'failed') {
      return res.status(400).json({ error: `Cannot parse receipt with status: ${capture.status}` });
    }

    // Check Gemini API availability
    const apiReady = ensureGeminiReady();
    if (!apiReady.ok) {
      capture.status = 'failed';
      capture.parseError = apiReady.error;
      await capture.save();
      return res.status(503).json({ error: apiReady.error });
    }

    // Use transaction for atomic parse
    const parseSession = await mongoose.startSession();
    parseSession.startTransaction();

    try {
      // Mark as parsing (atomic update to prevent race conditions)
      const updated = await ReceiptCapture.findByIdAndUpdate(
        captureId,
        { status: 'parsing', startedParsingAt: new Date() },
        { new: true, session: parseSession }
      );
      if (!updated) {
        await parseSession.abortTransaction();
        await parseSession.endSession();
        return res.status(404).json({ error: 'Receipt capture not found' });
      }

      // Download and parse receipt images
      const draftItems = [];
    
    for (const image of capture.images) {
      try {
        // Fetch image data with timeout (10 seconds) and retry (2 attempts)
        let imageResponse = null;
        let fetchError = null;
        const FETCH_TIMEOUT_MS = 10000;
        const MAX_FETCH_RETRIES = 2;
        
        // Fetch the image to pass to Gemini
        // For Cloudinary URLs, pass URL directly to Gemini
        // For data URLs, convert to base64
        let geminiImageContent;
        
        if (image.url.startsWith('https://') && image.url.includes('cloudinary')) {
          // Cloudinary URL: send URL directly (preferred)
          console.log(`Using Cloudinary URL for Gemini: ${image.url.substring(0, 60)}...`);
          geminiImageContent = {
            url: image.url
          };
        } else if (image.url.startsWith('data:')) {
          // Data URL: extract base64
          const match = image.url.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) {
            console.warn('Invalid data URL format for image:', image.sequence);
            continue;
          }
          const mimeType = match[1];
          const base64Data = match[2];
          geminiImageContent = {
            inline_data: {
              data: base64Data,
              mime_type: mimeType
            }
          };
        } else if (image.url.startsWith('https://')) {
          // HTTPS URL (but not Cloudinary): fetch and convert to base64
          console.log(`Fetching image for Gemini: ${image.url.substring(0, 60)}...`);
          let imageResponse;
          let fetchError;
          
          for (let retry = 0; retry < MAX_FETCH_RETRIES; retry++) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
              imageResponse = await fetch(image.url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (imageResponse.ok) break;
              fetchError = new Error(`HTTP ${imageResponse.status}`);
            } catch (err) {
              fetchError = err;
              if (retry < MAX_FETCH_RETRIES - 1) {
                console.warn(`Fetch retry ${retry + 1}/${MAX_FETCH_RETRIES - 1} for image:`, image.url, err.message);
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, retry))); // Exponential backoff
              }
            }
          }
          
          if (!imageResponse?.ok) {
            console.error(`Failed to fetch image after ${MAX_FETCH_RETRIES} attempts:`, image.url, fetchError?.message);
            continue;
          }
          
          const imageBuffer = await imageResponse.arrayBuffer();
          const imageBase64 = Buffer.from(imageBuffer).toString('base64');
          const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
          
          geminiImageContent = {
            inline_data: {
              data: imageBase64,
              mime_type: mimeType
            }
          };
        } else {
          console.warn('Unsupported image URL format:', image.url);
          continue;
        }

        // Gemini prompt for receipt parsing
        // Sanitized Gemini prompt (no user input injection)
        const prompt = `You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE ADDRESS if visible at the top or bottom of receipt. Return it as:
"address": "123 Main St, City, ST 12345"  (or null if not visible)

THEN, extract ALL line items with prices. Return ONLY valid JSON format:
{
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store address if visible (street, city, state, zip)
2. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment, instructions)
3. Use exact product names from receipt
4. For multi-buy items, calculate quantity * unit price = totalPrice
5. Skip discounts, coupons, tax lines
6. Return empty array [] for items if none found
7. Return ONLY valid JSON, no markdown, no explanation`;

        // Call Gemini Vision API with error handling
        let response;
        try {
          const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
          response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp',
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  geminiImageContent
                ]
              }
            ],
            generationConfig: { 
              temperature: 0.1,
              topP: 0.8,
              topK: 10
            }
          });
        } catch (geminiErr) {
          // Distinguish transient vs permanent Gemini errors
          const isTransient = geminiErr?.message?.includes('429') || geminiErr?.message?.includes('timeout') || geminiErr?.code === 'ECONNRESET';
          const severity = isTransient ? 'warn' : 'error';
          console[severity](`Gemini API error (${image.sequence}):`, geminiErr?.message);
          
          // For rate limits, mark capture as requires_retry instead of failed
          if (isTransient) {
            capture.status = 'requires_retry';
            capture.parseError = `Gemini rate limit / timeout (image ${image.sequence})`;
            await capture.save();
            return res.status(503).json({ error: 'Gemini service overloaded. Retry in 30s.' });
          }
          continue; // Skip this image for permanent errors
        }

        const rawText = response?.text?.trim?.() ?? '';
        if (!rawText) {
          console.warn('No response from Gemini for image:', image.sequence);
          continue;
        }

        // Parse JSON response
        let parsedData = {};
        let extractedItems = [];
        let extractedAddress = null;
        
        try {
          // Remove markdown code blocks if present
          const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          parsedData = JSON.parse(jsonText);
          
          // Extract address if present
          if (parsedData.address && typeof parsedData.address === 'string') {
            extractedAddress = parsedData.address.trim();
          }
          
          // Extract items
          extractedItems = Array.isArray(parsedData.items) ? parsedData.items : 
                          Array.isArray(parsedData) ? parsedData : [];
          
          if (!Array.isArray(extractedItems)) {
            console.warn('Gemini response items is not an array:', jsonText);
            extractedItems = [];
          }
        } catch (parseError) {
          console.error('Failed to parse Gemini JSON:', rawText, parseError);
          continue;
        }

        // If we found an address on first image, save it to store
        if (extractedAddress && image.sequence === 1) {
          try {
            const store = await Store.findById(capture.storeId);
            if (store && !store.address?.street) {
              // Parse the address string into components
              // Format: "123 Main St, City, ST 12345"
              const addressParts = extractedAddress.split(',').map(p => p.trim());
              store.address = {
                street: addressParts[0] || '',
                city: addressParts[1] || '',
                state: addressParts[2]?.split(' ')[0] || '',
                zip: addressParts[2]?.split(' ')[1] || ''
              };
              
              // Try to geocode the new address
              const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
              if (apiKey) {
                try {
                  const geocodeUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
                  geocodeUrl.searchParams.set('address', extractedAddress);
                  geocodeUrl.searchParams.set('key', apiKey);
                  
                  const geocodeResp = await fetch(geocodeUrl.toString());
                  const geocodeData = await geocodeResp.json();
                  
                  if (geocodeData.status === 'OK' && geocodeData.results?.[0]?.geometry?.location) {
                    const loc = geocodeData.results[0].geometry.location;
                    store.location = { lat: loc.lat, lng: loc.lng };
                    console.log(`Auto-geocoded store address: ${extractedAddress} → ${loc.lat}, ${loc.lng}`);
                  }
                } catch (geocodeErr) {
                  console.warn(`Geocoding failed for ${extractedAddress}:`, geocodeErr.message);
                }
              }
              
              await store.save();
              console.log(`Updated store ${store._id} with address from receipt`);
            }
          } catch (addressErr) {
            console.warn('Failed to update store address:', addressErr.message);
          }
        }

        // Sanitize and cap items from Gemini
        const MAX_ITEMS = 120;
        const sanitizedItems = [];
        for (const raw of extractedItems) {
          if (!raw || typeof raw !== 'object') continue;
          const receiptName = String(raw.receiptName || '').trim();
          const quantity = Math.min(1000, Math.max(1, Math.floor(Number(raw.quantity) || 1)));
          const totalPrice = Number(raw.totalPrice);
          if (!receiptName || !Number.isFinite(totalPrice)) continue;
          if (totalPrice < 0 || totalPrice > 10000) continue;
          sanitizedItems.push({
            receiptName,
            quantity,
            totalPrice: Number(totalPrice.toFixed(2))
          });
          if (sanitizedItems.length >= MAX_ITEMS) break;
        }

        if (sanitizedItems.length === 0) {
          console.warn('Gemini returned no valid items after sanitization');
          continue;
        }

        // Process each sanitized item
        for (const item of sanitizedItems) {
          const receiptName = item.receiptName;
          const quantity = item.quantity;
          const totalPrice = item.totalPrice;
          const unitPrice = totalPrice / quantity;

          // Validate price
          if (!validatePriceQuantity(unitPrice, quantity).ok) {
            console.warn('Invalid price/quantity:', { receiptName, unitPrice, quantity });
            continue;
          }

          const normalizedName = normalizeReceiptName(receiptName);
          const tokens = extractTokens(normalizedName);
          const category = classifyCategory(normalizedName);
          const promoDetected = detectPromo(receiptName);

          // Try to match with existing products
          let suggestedProduct = null;
          let matchMethod = null;
          let matchConfidence = 0;
          let needsReview = true;
          let reviewReason = 'no_match';
          let workflowType = 'new_product'; // 'new_product' or 'update_price'

          // Step 1: Check ReceiptNameAlias for confirmed mappings
          const alias = await ReceiptNameAlias.findOne({
            storeId: capture.storeId,
            normalizedName
          });

          if (alias && alias.confirmedCount > 0) {
            const product = await Product.findById(alias.productId);
            if (product) {
              suggestedProduct = {
                id: product._id.toString(),
                name: product.name,
                upc: product.upc,
                sku: product.sku
              };
              matchMethod = 'alias_confirmed';
              matchConfidence = Math.min(1.0, 0.7 + alias.confirmedCount * 0.1);
              workflowType = 'update_price'; // Item exists - update price
              
              // Auto-confirm high-confidence aliases (3+ confirmations)
              if (alias.confirmedCount >= 3) {
                needsReview = false;
              } else {
                reviewReason = 'low_confirmation_count';
              }
            }
          }

          // Step 2: Fuzzy match against store inventory
          if (!suggestedProduct) {
            const storeInventories = await StoreInventory.find({ storeId: capture.storeId })
              .populate('productId')
              .limit(500);

            let bestScore = 0;
            let bestMatch = null;
            let bestMatchResult = null;

            for (const inv of storeInventories) {
              if (!inv.productId || !inv.productId.name) continue;
              
              const matchResult = advancedMatch(receiptName, inv.productId.name);
              
              // Category guardrail
              const productCategory = classifyCategory(normalizeReceiptName(inv.productId.name));
              if (category !== 'other' && productCategory !== 'other' && category !== productCategory) {
                continue;
              }
              
              if (matchResult.score > bestScore && matchResult.tokensMatch) {
                bestScore = matchResult.score;
                bestMatch = inv.productId;
                bestMatchResult = matchResult;
              }
            }

            if (bestMatch && bestScore >= 0.75) {
              suggestedProduct = {
                id: bestMatch._id.toString(),
                name: bestMatch.name,
                upc: bestMatch.upc,
                sku: bestMatch.sku
              };
              matchConfidence = bestScore;
              workflowType = 'update_price'; // Item exists - update price

              // Gate A: Size token missing = always needs review
              if (!tokens.hasSizeToken) {
                matchMethod = 'fuzzy_suggested';
                needsReview = true;
                reviewReason = 'no_size_token';
              }
              // High confidence fuzzy match (90%+)
              else if (bestScore >= 0.90) {
                matchMethod = 'fuzzy_high';
                needsReview = true; // Still review even high matches for safety
                reviewReason = 'fuzzy_high_confidence';
              }
              // Medium confidence fuzzy match (75-90%)
              else {
                matchMethod = 'fuzzy_suggested';
                needsReview = true;
                reviewReason = 'fuzzy_medium_confidence';
              }
            } else {
              // No match found - this is a NEW PRODUCT
              workflowType = 'new_product';
              matchMethod = 'no_match';
              needsReview = true;
              reviewReason = 'create_new_product';
            }
          }

          // Price guardrails per category
          const withinCategoryBounds = isWithinCategoryBounds(category, unitPrice);
          if (!withinCategoryBounds) {
            needsReview = true;
            reviewReason = reviewReason && reviewReason !== 'no_match'
              ? `${reviewReason}|price_out_of_bounds`
              : 'price_out_of_bounds';
          }

          // Add to draft items
          draftItems.push({
            lineIndex: draftItems.length,
            receiptName,
            normalizedName,
            totalPrice,
            quantity,
            unitPrice,
            suggestedProduct,
            matchMethod: matchMethod || 'no_match',
            matchConfidence,
            needsReview,
            reviewReason,
            promoDetected,
            priceType: promoDetected ? 'promo' : 'regular',
            workflowType // NEW: indicates if this should create new product or update price
          });
        }

      } catch (imageError) {
        console.error(`Error processing image ${image.sequence}:`, imageError);
      }
    }

      // Mark as parsed with extracted items (within transaction)
      capture.markParsed(draftItems);
      capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
      await capture.save({ session: parseSession });

      // Commit transaction
      await parseSession.commitTransaction();

      await recordAuditLog({
        type: 'receipt_parse',
        actorId: req.user?.username || 'unknown',
        details: `capture=${capture._id.toString()} items=${draftItems.length} review=${draftItems.filter(i => i.needsReview).length}`
      });

      res.json({
        ok: true,
        captureId: capture._id.toString(),
        status: capture.status,
        itemCount: draftItems.length,
        itemsNeedingReview: draftItems.filter(i => i.needsReview).length,
        message: 'Receipt parsed successfully'
      });
    } catch (error) {
      await parseSession.abortTransaction();
      console.error('Error parsing receipt:', error);
      
      // Mark as failed
      try {
        const capture = await ReceiptCapture.findByIdAndUpdate(
          captureId,
          { status: 'failed', parseError: error.message },
          { new: true }
        );
      } catch (updateError) {
        console.error('Failed to update capture status:', updateError);
      }
      
      res.status(500).json({ error: 'Failed to parse receipt' });
    } finally {
      await parseSession.endSession();
    }
  } catch (error) {
    console.error('Error in receipt-parse route:', error);
    res.status(500).json({ error: 'Failed to parse receipt' });
  }
});

/**
 * POST /api/driver/receipt-confirm-item
 * Confirm a draft item binding (management scanner workflow)
 * Idempotent: calling twice with same params is safe
 */
router.post('/receipt-confirm-item', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, lineIndex, productId, upc } = req.body;
    const username = req.user?.username;

    // Validation
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }
    if (lineIndex === undefined || lineIndex < 0) {
      return res.status(400).json({ error: 'Valid lineIndex required' });
    }
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Valid productId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status !== 'parsed' && capture.status !== 'review_complete') {
      return res.status(400).json({ error: `Cannot confirm items with status: ${capture.status}` });
    }

    // Enforce driver-store binding
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to confirm receipts' });
    }
    if (isDriver && !driverCanAccessStore(username, capture.storeId)) {
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    // Check if already confirmed with same values (idempotent)
    const draftItem = capture.draftItems.find(i => i.lineIndex === lineIndex);
    if (draftItem && draftItem.boundProductId && draftItem.confirmedAt) {
      // Already confirmed - check if same values
      if (draftItem.boundProductId.toString() === productId && draftItem.boundUpc === upc) {
        // Idempotent - return same response
        return res.json({
          ok: true,
          captureId: capture._id.toString(),
          status: capture.status,
          idempotent: true,
          stats: {
            totalItems: capture.totalItems,
            itemsNeedingReview: capture.itemsNeedingReview,
            itemsConfirmed: capture.itemsConfirmed
          }
        });
      }
      // Different values - error on double confirmation
      return res.status(409).json({ error: 'Item already confirmed with different values' });
    }

    // Confirm the item
    capture.confirmItem(lineIndex, productId, upc, username || 'unknown');
    await capture.save();

    await recordAuditLog({
      type: 'receipt_confirm_item',
      actorId: username || 'unknown',
      details: `capture=${capture._id.toString()} line=${lineIndex} product=${productId}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      stats: {
        totalItems: capture.totalItems,
        itemsNeedingReview: capture.itemsNeedingReview,
        itemsConfirmed: capture.itemsConfirmed
      }
    });

  } catch (error) {
    console.error('Error confirming receipt item:', error);
    res.status(500).json({ error: 'Failed to confirm receipt item' });
  }
});

/**
 * POST /api/driver/receipt-commit
 * Commit confirmed receipt items to StoreInventory
 * Updates prices and creates ReceiptNameAlias entries
 * Uses MongoDB transactions for atomic commit
 */
router.post('/receipt-commit', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { captureId } = req.body;
    const username = req.user?.username;

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId).session(session);
    if (!capture) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status !== 'review_complete') {
      await session.abortTransaction();
      await session.endSession();
      return res.status(400).json({ error: 'All items must be confirmed before commit' });
    }

    const captureIdKey = capture._id.toString();

    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    if (!isOwner && !isDriver) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(403).json({ error: 'Not authorized to commit receipts' });
    }
    if (isDriver && !driverCanAccessStore(username, capture.storeId)) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(403).json({ error: 'Driver not authorized for this store' });
    }

    // Process each confirmed item
    let committed = 0;
    const errors = [];

    for (const item of capture.draftItems) {
      if (!item.boundProductId) continue; // Skip unconfirmed items

      try {
        let product = await Product.findById(item.boundProductId).session(session);
        
        // Handle new product creation
        if (!product && item.workflowType === 'new_product') {
          // Create new product from receipt line item
          product = new Product({
            frontendId: `RECEIPT-${capture._id}-${item.lineIndex}`,
            name: item.receiptName,
            brand: item.receiptName.split(/\s+/)[0] || 'UNKNOWN', // First word as brand
            category: classifyCategory(item.receiptName) || 'DRINK',
            price: item.unitPrice,
            sizeOz: 0, // Would need to extract from receipt
            stock: 0, // Will be managed separately
            store: capture.storeId
          });
          await product.save({ session });
          item.boundProductId = product._id.toString();
        } else if (!product) {
          errors.push({ lineIndex: item.lineIndex, error: 'Product not found and workflowType not new_product' });
          continue;
        }

        // Validate price delta - prevent catastrophic pricing errors
        const existingInventory = await StoreInventory.findOne(
          { storeId: capture.storeId, productId: item.boundProductId }
        ).session(session);

        if (existingInventory?.appliedCaptures?.some(
          ac => ac.captureId === captureIdKey && ac.lineIndex === item.lineIndex
        )) {
          continue;
        }
        
        if (existingInventory?.observedPrice) {
          const currentPrice = existingInventory.observedPrice;
          const newPrice = item.unitPrice;
          const pctDelta = Math.abs((newPrice - currentPrice) / currentPrice);
          const absDelta = Math.abs(newPrice - currentPrice);
          
          // Flag extreme deltas (>100% or >$5) for safety
          if (pctDelta > 1.0 || absDelta > 5.0) {
            errors.push({
              lineIndex: item.lineIndex,
              error: `Price delta too large: $${currentPrice} → $${newPrice} (${(pctDelta * 100).toFixed(0)}%)`
            });
            continue;
          }
        }

        // Update StoreInventory with transaction
        const observedAt = new Date();
        const priceEntry = buildPriceHistoryEntry({
          price: item.unitPrice,
          observedAt,
          storeId: capture.storeId,
          captureId: captureIdKey,
          orderId: capture.orderId,
          quantity: item.quantity,
          receiptImageUrl: capture.images[0]?.url,
          receiptThumbnailUrl: capture.images[0]?.thumbnailUrl,
          matchMethod: item.matchMethod || 'manual_confirm',
          matchConfidence: item.matchConfidence || 1.0,
          confirmedBy: item.confirmedBy,
          priceType: item.priceType || 'regular',
          promoDetected: item.promoDetected || false,
          workflowType: item.workflowType
        });
        const inventoryUpdate = {
          $set: {
            observedPrice: item.unitPrice,
            observedAt,
            updatedAt: observedAt
          },
          $push: {
            priceHistory: {
              $each: [priceEntry],
              $slice: -20 // Keep last 20
            },
            appliedCaptures: {
              $each: [{
                captureId: captureIdKey,
                lineIndex: item.lineIndex,
                appliedAt: observedAt
              }],
              $slice: -50 // Keep last 50
            }
          }
        };

        await StoreInventory.updateOne(
          { storeId: capture.storeId, productId: item.boundProductId },
          inventoryUpdate,
          { upsert: true, session }
        );

        // Update or create ReceiptNameAlias with transaction
        const normalizedName = normalizeReceiptName(item.receiptName);
        await ReceiptNameAlias.updateOne(
          { storeId: capture.storeId, normalizedName },
          {
            $set: {
              productId: item.boundProductId,
              upc: item.boundUpc || product.upc,
              lastConfirmedAt: new Date(),
              lastSeenAt: new Date(),
              category: classifyCategory(normalizedName)
            },
            $inc: { confirmedCount: 1 },
            $push: {
              rawNames: {
                $each: [{ name: item.receiptName, firstSeen: new Date(), occurrences: 1 }],
                $slice: -20
              }
            },
            $setOnInsert: {
              createdBy: username || 'unknown'
            }
          },
          { upsert: true, session }
        );

        committed++;

      } catch (itemError) {
        console.error(`Error committing item ${item.lineIndex}:`, itemError);
        errors.push({ lineIndex: item.lineIndex, error: itemError.message });
      }
    }

    // Mark capture as committed
    capture.status = 'committed';
    capture.committedBy = username || 'unknown';
    capture.committedAt = new Date();
    capture.itemsCommitted = committed;
    await capture.save({ session });

    // Commit transaction atomically
    await session.commitTransaction();

    await recordAuditLog({
      type: 'receipt_commit',
      actorId: username || 'unknown',
      details: `capture=${capture._id.toString()} committed=${committed} errors=${errors.length}`
    });

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      committed,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Error committing receipt:', error);
    res.status(500).json({ error: 'Failed to commit receipt' });
  } finally {
    await session.endSession();
  }
});

/**
 * POST /api/driver/receipt-price-update
 * Update observed prices from receipt data
 * Anti-noise: averages with last price if within threshold
 * Fuzzy name matching: auto-matches products by name when UPC not available
 */
router.post('/receipt-price-update', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const sessionDb = await mongoose.startSession();

  try {
    const isDriver = isDriverUsername(req.user?.username);
    if (!isDriver) {
      return res.status(403).json({ error: 'Driver access required' });
    }

    const { 
      storeId, 
      storeName, 
      orderId, 
      captureId, // Idempotency key (required)
      receiptImageUrl, // Cloudinary/S3 URL (not base64)
      receiptThumbnailUrl,
      items // [{ upc?, sku?, name, totalPrice, quantity, lineIndex, confirmed? }]
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    if (!storeId && !storeName) {
      return res.status(400).json({ error: 'storeId or storeName is required' });
    }
    
    if (!captureId || typeof captureId !== 'string' || captureId.length < 8) {
      return res.status(400).json({ error: 'captureId is required for idempotency' });
    }

    let updated = 0;
    let created = 0;
    let autoMatched = 0;
    let needsReview = 0;
    let errors = [];
    let reviewItems = []; // Items that need confirmation

    await sessionDb.withTransaction(async () => {
      // Resolve store
      let store;
      if (storeId) {
        store = await Store.findById(storeId).session(sessionDb);
      } else {
        store = await Store.findOne({ name: storeName }).session(sessionDb);
      }

      if (!store) {
        throw new Error('Store not found');
      }

      for (const item of items) {
        try {
          const { upc, sku, name, totalPrice, quantity, lineIndex = 0, confirmed } = item;
          
          // Validate inputs strictly
          if (upc && !validateUPC(upc)) {
            errors.push(`Invalid UPC format: ${upc}`);
            continue;
          }
          
          const validation = validatePriceQuantity(totalPrice, quantity);
          if (!validation.ok) {
            errors.push(`${name}: ${validation.error}`);
            continue;
          }

          if (!name || name.trim().length === 0) {
            errors.push(`Product name is required for matching`);
            continue;
          }

          const unitPrice = Number(totalPrice) / Number(quantity);
          const normalizedName = normalizeReceiptName(name);
          const category = classifyCategory(normalizedName);
          const promoDetected = detectPromo(name);
          const priceType = promoDetected ? 'promo' : 'unknown';

          // STEP 1: Find product by UPC, SKU, confirmed alias, or fuzzy match
          let product;
          let matchMethod = 'none';
          let matchConfidence = 0;
          let aliasMatch = null;
          
          // Direct UPC match (highest priority)
          if (upc) {
            product = await Product.findOne({ upc }).session(sessionDb);
            if (product) {
              matchMethod = 'upc';
              matchConfidence = 1.0;
            }
          }
          
          // Direct SKU match
          if (!product && sku) {
            product = await Product.findOne({ sku }).session(sessionDb);
            if (product) {
              matchMethod = 'sku';
              matchConfidence = 1.0;
            }
          }

          // Check for confirmed alias (learns from past confirmations)
          if (!product) {
            aliasMatch = await ReceiptNameAlias.findOne({
              storeId: store._id,
              normalizedName
            }).populate('productId').session(sessionDb);
            
            if (aliasMatch && aliasMatch.confirmedCount >= 1) {
              product = aliasMatch.productId;
              matchMethod = 'alias_confirmed';
              matchConfidence = Math.min(1.0, 0.7 + (aliasMatch.confirmedCount * 0.1));
              
              // Update lastSeenAt
              aliasMatch.lastSeenAt = new Date();
              await aliasMatch.save({ session: sessionDb });
            }
          }

          // Fuzzy matching (use advanced token-gated approach)
          if (!product) {
            const tokens = extractTokens(normalizedName);
            
            const storeInventories = await StoreInventory.find({ storeId: store._id })
              .populate('productId')
              .session(sessionDb)
              .limit(100);
            
            let bestMatch = null;
            let bestScore = 0;
            let bestMatchResult = null;
            const HIGH_CONFIDENCE_THRESHOLD = 0.90; // Very high bar for auto-commit
            const SUGGEST_THRESHOLD = 0.75; // Lower bar for suggestion

            for (const inv of storeInventories) {
              if (!inv.productId || !inv.productId.name) continue;
              
              const matchResult = advancedMatch(name, inv.productId.name);
              
              // Category guardrail: must be same category
              const productCategory = classifyCategory(normalizeReceiptName(inv.productId.name));
              if (category !== 'other' && productCategory !== 'other' && category !== productCategory) {
                continue; // Skip cross-category matches
              }
              
              if (matchResult.score > bestScore && matchResult.tokensMatch) {
                bestScore = matchResult.score;
                bestMatch = inv.productId;
                bestMatchResult = matchResult;
              }
            }

            if (bestMatch && bestScore >= SUGGEST_THRESHOLD) {
              // Gate A: Size token missing = always needs review
              if (!tokens.hasSizeToken) {
                matchMethod = 'fuzzy_suggested';
                matchConfidence = bestScore;
                needsReview++;
                
                reviewItems.push({
                  receiptName: name,
                  normalizedName,
                  suggestedProduct: {
                    id: bestMatch._id,
                    name: bestMatch.name,
                    upc: bestMatch.upc,
                    sku: bestMatch.sku
                  },
                  matchScore: bestScore.toFixed(2),
                  reason: 'no_size_token',
                  matchDetails: bestMatchResult,
                  unitPrice,
                  quantity
                });
                
                continue; // Skip - needs confirmation
              }
              
              // High confidence + confirmed flag = auto-commit
              if (bestScore >= HIGH_CONFIDENCE_THRESHOLD && confirmed) {
                product = bestMatch;
                matchMethod = 'fuzzy_confirmed';
                matchConfidence = bestScore;
                autoMatched++;
              } else {
                // Needs review - don't auto-commit
                matchMethod = 'fuzzy_suggested';
                matchConfidence = bestScore;
                needsReview++;
                
                reviewItems.push({
                  receiptName: name,
                  normalizedName,
                  suggestedProduct: {
                    id: bestMatch._id,
                    name: bestMatch.name,
                    upc: bestMatch.upc,
                    sku: bestMatch.sku
                  },
                  matchScore: bestScore.toFixed(2),
                  matchDetails: bestMatchResult,
                  unitPrice,
                  quantity
                });
                
                // Skip price update - needs confirmation
                continue;
              }
            }
          }

          if (!product) {
            errors.push(`No product match for "${name}". Scan UPC to bind.`);
            continue;
          }

          // STEP 2: Idempotency check
          let inventory = await StoreInventory.findOne({
            storeId: store._id,
            productId: product._id
          }).session(sessionDb);

          // Check if this captureId + lineIndex already applied
          if (inventory?.appliedCaptures) {
            const alreadyApplied = inventory.appliedCaptures.some(
              ac => ac.captureId === captureId && ac.lineIndex === lineIndex
            );
            if (alreadyApplied) {
              // Safe retry - skip silently
              continue;
            }
          }

          // STEP 3: Safety gates for price updates
          const lastPrice = inventory?.observedPrice;
          const PRICE_DELTA_THRESHOLD_PCT = 0.30; // 30%
          const PRICE_DELTA_THRESHOLD_ABS = 1.00; // $1.00
          const STALENESS_DAYS = 30;
          
          // Price delta check (both percentage AND absolute)
          if (lastPrice) {
            const pctDelta = Math.abs(unitPrice - lastPrice) / lastPrice;
            const absDelta = Math.abs(unitPrice - lastPrice);
            
            if ((pctDelta > PRICE_DELTA_THRESHOLD_PCT || absDelta >= PRICE_DELTA_THRESHOLD_ABS) && !confirmed) {
              needsReview++;
              reviewItems.push({
                receiptName: name,
                product: {
                  id: product._id,
                  name: product.name,
                  upc: product.upc
                },
                reason: 'large_price_change',
                oldPrice: lastPrice.toFixed(2),
                newPrice: unitPrice.toFixed(2),
                delta: `${(pctDelta * 100).toFixed(1)}%`,
                absDelta: `$${absDelta.toFixed(2)}`,
                unitPrice,
                quantity
              });
              continue; // Skip update - needs confirmation
            }
          }

          // Staleness check
          const daysSinceUpdate = inventory?.observedAt 
            ? (Date.now() - new Date(inventory.observedAt).getTime()) / (1000 * 60 * 60 * 24)
            : 999;
          const isStale = daysSinceUpdate > STALENESS_DAYS;

          // STEP 4: Update price with anti-noise averaging
          const observedAt = new Date();
          const priceEntry = buildPriceHistoryEntry({
            price: unitPrice,
            observedAt,
            storeId: store._id,
            captureId,
            orderId,
            quantity,
            receiptImageUrl,
            receiptThumbnailUrl,
            matchMethod,
            matchConfidence,
            priceType,
            promoDetected,
            workflowType: 'update_price'
          });

          if (!inventory) {
            // Create new inventory entry
            inventory = await StoreInventory.create([{
              storeId: store._id,
              productId: product._id,
              sku: product.sku,
              cost: unitPrice,
              observedPrice: unitPrice,
              observedAt,
              priceHistory: [priceEntry],
              appliedCaptures: [{ captureId, lineIndex, appliedAt: observedAt }],
              available: true,
              stockLevel: 'in-stock',
              lastVerified: observedAt
            }], { session: sessionDb });
            created++;
          } else {
            // Update existing: anti-noise averaging
            const NOISE_THRESHOLD = 0.15; // 15% variance

            let finalPrice = unitPrice;
            
            // Only average if not stale and within noise threshold
            if (!isStale && lastPrice && Math.abs(unitPrice - lastPrice) / lastPrice < NOISE_THRESHOLD) {
              finalPrice = (unitPrice + lastPrice) / 2;
            }

            inventory.observedPrice = finalPrice;
            inventory.observedAt = observedAt;
            inventory.cost = finalPrice;
            inventory.lastVerified = observedAt;
            
            // Add to history (keep last 20 entries)
            if (!inventory.priceHistory) inventory.priceHistory = [];
            inventory.priceHistory.push(priceEntry);
            if (inventory.priceHistory.length > 20) {
              inventory.priceHistory = inventory.priceHistory.slice(-20);
            }

            // Track idempotency
            if (!inventory.appliedCaptures) inventory.appliedCaptures = [];
            inventory.appliedCaptures.push({ captureId, lineIndex, appliedAt: observedAt });
            if (inventory.appliedCaptures.length > 50) {
              inventory.appliedCaptures = inventory.appliedCaptures.slice(-50);
            }

            await inventory.save({ session: sessionDb });
            updated++;
          }

          // STEP 5: Update or create alias mapping (for learning) - ATOMIC
          if (matchMethod !== 'upc' && matchMethod !== 'sku') {
            const tokens = extractTokens(normalizedName);
            
            // Use atomic upsert with $inc for confirmedCount
            const updateDoc = {
              $setOnInsert: {
                normalizedName,
                storeId: store._id,
                productId: product._id,
                upc: product.upc,
                category,
                hasSizeToken: tokens.hasSizeToken,
                matchConfidence: confirmed ? 0.8 : matchConfidence,
                createdBy: req.user?.username || req.user?.id,
                createdAt: new Date()
              },
              $set: {
                lastSeenAt: new Date()
              },
              $inc: confirmed ? { confirmedCount: 1 } : {},
              $push: {
                rawNames: {
                  $each: [{ name, firstSeen: new Date(), occurrences: 1 }],
                  $slice: -20 // Keep last 20
                }
              }
            };
            
            if (confirmed) {
              updateDoc.$set.lastConfirmedAt = new Date();
              updateDoc.$set.matchConfidence = { $min: [1.0, { $add: [0.7, { $multiply: ['$confirmedCount', 0.1] }] }] };
            }

            await ReceiptNameAlias.updateOne(
              { storeId: store._id, normalizedName },
              updateDoc,
              { upsert: true, session: sessionDb }
            );
          }
        } catch (err) {
          errors.push(`Item error: ${err.message}`);
        }
      }

      await recordAuditLog({
        type: 'RECEIPT_PRICE_UPDATE',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: `Receipt price update for store ${store.name}. Updated: ${updated}, Created: ${created}, Auto-matched: ${autoMatched}, Needs review: ${needsReview}. Order: ${orderId || 'N/A'}.`
      });
    });

    res.json({
      ok: true,
      updated,
      created,
      autoMatched,
      needsReview,
      reviewItems, // Items that require confirmation
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('RECEIPT PRICE UPDATE ERROR:', err);
    res.status(500).json({ error: err.message || 'Failed to update prices from receipt' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * POST /api/driver/receipt-confirm-match
 * Confirm a suggested fuzzy match and update price
 * SECURITY: Role-gated, input validated, audit logged
 */
router.post('/receipt-confirm-match', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const sessionDb = await mongoose.startSession();

  try {
    // Role gating: DRIVER or OWNER/MANAGER only
    const isDriver = isDriverUsername(req.user?.username);
    const isOwner = req.user?.role === 'OWNER' || req.user?.role === 'MANAGER';
    
    if (!isDriver && !isOwner) {
      return res.status(403).json({ error: 'Driver or manager access required' });
    }

    const {
      storeId,
      productId,
      receiptName,
      unitPrice,
      quantity,
      orderId,
      captureId,
      receiptImageUrl,
      receiptThumbnailUrl
    } = req.body;

    // Input validation
    if (!storeId || !productId || !receiptName || !unitPrice) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const validation = validatePriceQuantity(unitPrice, quantity || 1);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    await sessionDb.withTransaction(async () => {
      const normalizedName = normalizeReceiptName(receiptName);

      // Update or create alias with confirmation
      let alias = await ReceiptNameAlias.findOne({
        storeId,
        normalizedName
      }).session(sessionDb);

      if (!alias) {
        alias = await ReceiptNameAlias.create([{
          normalizedName,
          storeId,
          productId,
          confirmedCount: 1,
          lastConfirmedAt: new Date(),
          lastSeenAt: new Date(),
          matchConfidence: 0.8,
          rawNames: [{ name: receiptName, firstSeen: new Date(), occurrences: 1 }],
          createdBy: req.user?.username || req.user?.id
        }], { session: sessionDb });
      } else {
        alias.confirmedCount += 1;
        alias.lastConfirmedAt = new Date();
        alias.lastSeenAt = new Date();
        alias.matchConfidence = Math.min(1.0, 0.7 + (alias.confirmedCount * 0.1));
        await alias.save({ session: sessionDb });
      }

      // Update StoreInventory price
      let inventory = await StoreInventory.findOne({
        storeId,
        productId
      }).session(sessionDb);

      const priceEntry = {
        price: unitPrice,
        observedAt: new Date(),
        storeId,
        captureId: captureId || undefined,
        orderId: orderId || undefined,
        quantity: Number(quantity || 1),
        receiptImageUrl: receiptImageUrl || undefined,
        receiptThumbnailUrl: receiptThumbnailUrl || undefined,
        matchMethod: 'fuzzy_confirmed',
        matchConfidence: alias.matchConfidence,
        confirmedBy: req.user?.username || req.user?.id,
        priceType: 'unknown',
        promoDetected: false,
        workflowType: 'update_price'
      };

      if (!inventory) {
        await StoreInventory.create([{
          storeId,
          productId,
          cost: unitPrice,
          observedPrice: unitPrice,
          observedAt: new Date(),
          priceHistory: [priceEntry],
          available: true,
          stockLevel: 'in-stock',
          lastVerified: new Date()
        }], { session: sessionDb });
      } else {
        inventory.observedPrice = unitPrice;
        inventory.observedAt = new Date();
        inventory.cost = unitPrice;
        inventory.lastVerified = new Date();
        
        if (!inventory.priceHistory) inventory.priceHistory = [];
        inventory.priceHistory.push(priceEntry);
        if (inventory.priceHistory.length > 20) {
          inventory.priceHistory = inventory.priceHistory.slice(-20);
        }
        
        await inventory.save({ session: sessionDb });
      }

      await recordAuditLog({
        type: 'RECEIPT_MATCH_CONFIRMED',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: `Confirmed match: "${receiptName}" → ${productId} at store ${storeId}. Price: $${unitPrice.toFixed(2)}`,
        metadata: {
          ip: req.ip || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent'],
          storeId,
          productId,
          unitPrice
        }
      });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('CONFIRM MATCH ERROR:', err);
    res.status(500).json({ error: err.message || 'Failed to confirm match' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * GET /api/driver/store-inventory/:storeId
 * Get inventory for a store with observed prices
 */
router.get('/store-inventory/:storeId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId } = req.params;
    
    const inventory = await StoreInventory.find({ storeId })
      .populate('productId', 'name sku upc price')
      .lean();

    const enriched = inventory.map(inv => ({
      ...inv,
      product: inv.productId,
      hasObservedPrice: Boolean(inv.observedPrice),
      priceDrift: inv.observedPrice && inv.productId?.price 
        ? ((inv.observedPrice - inv.productId.price) / inv.productId.price * 100).toFixed(1)
        : null
    }));

    res.json({ ok: true, inventory: enriched });
  } catch (err) {
    console.error('GET STORE INVENTORY ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch store inventory' });
  }
});

/**
 * GET /api/driver/receipt-captures
 * List receipt captures for management review
 * Query params: storeId, status, limit
 * SECURITY: Owner sees all; Driver sees only their authorized stores
 */
router.get('/receipt-captures', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, status, limit = 50 } = req.query;
    const username = req.user?.username;
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);
    
    // Drivers must specify storeId and be authorized for it
    if (isDriver && !isOwner) {
      if (!storeId) {
        return res.status(400).json({ error: 'Drivers must specify storeId' });
      }
      if (!driverCanAccessStore(username, storeId)) {
        return res.status(403).json({ error: 'Driver not authorized for this store' });
      }
    }
    
    const query = {};
    if (storeId) query.storeId = storeId;
    if (status) query.status = status;

    const captures = await ReceiptCapture.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      ok: true,
      captures: captures.map(c => {
        // Calculate workflow stats
        const newProducts = (c.draftItems || []).filter(i => i.workflowType === 'new_product').length;
        const priceUpdates = (c.draftItems || []).filter(i => i.workflowType === 'update_price').length;
        
        return {
          _id: c._id,
          storeId: c.storeId,
          storeName: c.storeName,
          orderId: c.orderId,
          status: c.status,
          imageCount: c.images?.length || 0,
          stats: {
            totalItems: c.totalItems || 0,
            itemsNeedingReview: c.itemsNeedingReview || 0,
            itemsConfirmed: c.itemsConfirmed || 0,
            itemsCommitted: c.itemsCommitted || 0
          },
          workflowStats: {
            newProducts,      // Items to create as new products
            priceUpdates      // Items to update existing prices
          },
          createdAt: c.createdAt,
          reviewExpiresAt: c.reviewExpiresAt
        };
      })
    });

  } catch (error) {
    console.error('Error listing receipt captures:', error);
    res.status(500).json({ error: 'Failed to list receipt captures' });
  }
});

/**
 * DELETE /api/driver/receipt-capture/:captureId
 * Delete a receipt capture and its associated images
 * SECURITY: Owner can delete any capture; Driver can only delete from their authorized stores
 */
router.delete('/receipt-capture/:captureId', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.params;
    const username = req.user?.username;
    const isOwner = isOwnerUsername(username);
    const isDriver = isDriverUsername(username);

    if (!mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Invalid captureId' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    // Authorization check
    if (isDriver && !isOwner) {
      if (!driverCanAccessStore(username, capture.storeId)) {
        return res.status(403).json({ error: 'Not authorized to delete this receipt' });
      }
    } else if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not authorized to delete receipts' });
    }

    // Delete from database
    await ReceiptCapture.deleteOne({ _id: captureId });

    // Note: Images stored in Cloudinary are not deleted (permanent audit trail)
    // They remain accessible via URL but are orphaned from the receipt

    await recordAuditLog({
      type: 'receipt_capture_delete',
      actorId: username || 'unknown',
      details: `captureId=${captureId} storeName=${capture.storeName}`
    });

    res.json({
      ok: true,
      message: 'Receipt capture deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting receipt capture:', error);
    res.status(500).json({ error: 'Failed to delete receipt capture' });
  }
});

/**
 * POST /api/driver/receipt-parse-frame
 * Parse a single frame from live camera feed
 * Returns items extracted from that frame only (non-destructive)
 */
router.post('/receipt-parse-frame', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { image } = req.body;
    
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Valid base64 image required' });
    }

    const apiReady = ensureGeminiReady();
    if (!apiReady.ok) {
      return res.status(503).json({ error: apiReady.error });
    }

    // Extract base64 from data URL
    let imageBase64 = image;
    let mimeType = 'image/jpeg';
    
    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageBase64 = match[2];
      }
    }

    // Call Gemini with items extraction prompt
    const prompt = `Extract ALL product line items from this receipt image ONLY. Return ONLY JSON:
[
  {"receiptName": "COCA COLA 12PK", "quantity": 2, "totalPrice": 15.98},
  {"receiptName": "LAYS CHIPS", "quantity": 1, "totalPrice": 3.99}
]

Rules: Extract product lines only (skip store, date, tax, total). Return empty [] if unclear. ONLY JSON, no explanation.`;

    let response;
    try {
      const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
      response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { data: imageBase64, mime_type: mimeType } }
            ]
          }
        ],
        generationConfig: { temperature: 0.1 }
      });
    } catch (geminiErr) {
      console.error('Gemini parse error:', geminiErr.message);
      return res.json({ ok: true, items: [] }); // Non-blocking
    }

    const rawText = response?.text?.trim?.() ?? '';
    let items = [];
    
    try {
      const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonText);
      
      if (Array.isArray(parsed)) {
        items = parsed.filter(item => 
          item.receiptName && 
          Number.isFinite(item.quantity) && 
          Number.isFinite(item.totalPrice) &&
          item.totalPrice > 0 &&
          item.quantity > 0
        ).slice(0, 20); // Limit to 20 items per frame
      }
    } catch (e) {
      // Silent fail for parsing
    }

    res.json({ ok: true, items });

  } catch (error) {
    console.error('Receipt frame parse error:', error);
    res.json({ ok: true, items: [] });
  }
});

/**
 * POST /api/driver/receipt-parse-live
 * Save live-scanned items to a capture as pre-parsed
 */
router.post('/receipt-parse-live', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId, items } = req.body;
    
    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    const isOwner = isOwnerUsername(req.user?.username);
    if (!isOwner && capture.createdBy !== req.user?.username) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Convert live items to draft items for manual UPC binding
    const draftItems = items.map((item, idx) => ({
      lineIndex: idx,
      receiptName: item.receiptName,
      normalizedName: normalizeReceiptName(item.receiptName),
      quantity: item.quantity,
      totalPrice: item.totalPrice,
      unitPrice: item.totalPrice / item.quantity,
      needsReview: false,
      workflowType: 'new_product'
    }));

    capture.markParsed(draftItems);
    await capture.save();

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      itemCount: draftItems.length
    });

  } catch (error) {
    console.error('Receipt parse live error:', error);
    res.status(500).json({ error: 'Failed to save items' });
  }
});

export default router;
