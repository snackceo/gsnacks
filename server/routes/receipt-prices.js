import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import StoreInventory from '../models/StoreInventory.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import ReceiptCapture from '../models/ReceiptCapture.js';
import { authRequired, isDriverUsername } from '../utils/helpers.js';
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

// Simple image upload handler (base64 to data URL)
const handleReceiptImageUpload = (base64Data) => {
  // For MVP: return data URL directly
  // Production: upload to Cloudinary/S3 and return public URL
  if (!base64Data) {
    throw new Error('No image data provided');
  }

  // If it's already a data URL, return it
  if (base64Data.startsWith('data:')) {
    return {
      url: base64Data,
      thumbnailUrl: base64Data // For MVP, same as URL
    };
  }

  // Otherwise wrap it as data URL
  return {
    url: `data:image/jpeg;base64,${base64Data}`,
    thumbnailUrl: `data:image/jpeg;base64,${base64Data}`
  };
};

const router = express.Router();

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

    const result = handleReceiptImageUpload(image);
    
    res.json({
      ok: true,
      url: result.url,
      thumbnailUrl: result.thumbnailUrl
    });

  } catch (error) {
    console.error('Error uploading receipt image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

/**
 * POST /api/driver/receipt-capture
 * Create a receipt capture record for photo upload workflow
 * Accepts receipt metadata and creates ReceiptCapture with status=pending_parse
 */
router.post('/receipt-capture', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, storeName, orderId, images } = req.body;
    const username = req.user?.username;

    // Validation
    if (!storeId || !storeName) {
      return res.status(400).json({ error: 'storeId and storeName are required' });
    }
    if (!images || !Array.isArray(images) || images.length === 0 || images.length > 3) {
      return res.status(400).json({ error: 'images array required (1-3 photos)' });
    }

    // Validate image URLs
    for (const img of images) {
      if (!img.url || typeof img.url !== 'string') {
        return res.status(400).json({ error: 'Each image must have a url' });
      }
    }

    // Create ReceiptCapture record
    const capture = new ReceiptCapture({
      storeId,
      storeName,
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

    // Mark as parsing
    capture.markParsing();
    await capture.save();

    // Download and parse receipt images
    const draftItems = [];
    
    for (const image of capture.images) {
      try {
        // Fetch image data
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) {
          console.error(`Failed to fetch image: ${image.url}`);
          continue;
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

        // Gemini prompt for receipt parsing
        const prompt = `Parse this receipt image and extract ALL line items with prices.

For EACH product line item, return:
- receiptName: exact product name as printed on receipt
- quantity: number of items purchased (default 1)
- totalPrice: total price for this line (quantity * unit price)

Return ONLY valid JSON array format:
[
  {
    "receiptName": "COCA COLA 12PK",
    "quantity": 2,
    "totalPrice": 15.98
  },
  {
    "receiptName": "LAYS CHIPS ORIG",
    "quantity": 1,
    "totalPrice": 3.99
  }
]

IMPORTANT RULES:
1. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment info)
2. Use exact product names from receipt (preserve case, abbreviations)
3. For multi-buy items (e.g., "2 @ $4.99"), quantity=2, totalPrice=9.98
4. Skip promotional discounts, coupons, tax lines
5. Return empty array [] if no items found
6. Return ONLY the JSON array, no markdown, no explanation`;

        // Call Gemini Vision API
        const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    data: imageBase64,
                    mime_type: mimeType
                  }
                }
              ]
            }
          ],
          generationConfig: { 
            temperature: 0.1,
            topP: 0.8,
            topK: 10
          }
        });

        const rawText = response?.text?.trim?.() ?? '';
        if (!rawText) {
          console.warn('No response from Gemini for image:', image.sequence);
          continue;
        }

        // Parse JSON response
        let extractedItems = [];
        try {
          // Remove markdown code blocks if present
          const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          extractedItems = JSON.parse(jsonText);
          
          if (!Array.isArray(extractedItems)) {
            console.warn('Gemini response is not an array:', jsonText);
            extractedItems = [];
          }
        } catch (parseError) {
          console.error('Failed to parse Gemini JSON:', rawText, parseError);
          continue;
        }

        // Process each extracted item
        for (const item of extractedItems) {
          if (!item.receiptName || !item.totalPrice) {
            console.warn('Skipping invalid item:', item);
            continue;
          }

          const receiptName = item.receiptName.trim();
          const quantity = Math.max(1, parseInt(item.quantity) || 1);
          const totalPrice = parseFloat(item.totalPrice);
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

    // Mark as parsed with extracted items
    capture.markParsed(draftItems);
    capture.geminiRequestId = `receipt_${capture._id}_${Date.now()}`;
    await capture.save();

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      status: capture.status,
      itemCount: draftItems.length,
      itemsNeedingReview: draftItems.filter(i => i.needsReview).length,
      message: 'Receipt parsed successfully'
    });

  } catch (error) {
    console.error('Error parsing receipt:', error);
    
    // Mark as failed
    if (req.body.captureId) {
      try {
        const capture = await ReceiptCapture.findById(req.body.captureId);
        if (capture) {
          capture.status = 'failed';
          capture.parseError = error.message;
          await capture.save();
        }
      } catch (updateError) {
        console.error('Failed to update capture status:', updateError);
      }
    }
    
    res.status(500).json({ error: 'Failed to parse receipt' });
  }
});

/**
 * POST /api/driver/receipt-confirm-item
 * Confirm a draft item binding (management scanner workflow)
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

    // Confirm the item
    capture.confirmItem(lineIndex, productId, upc, username || 'unknown');
    await capture.save();

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
 */
router.post('/receipt-commit', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { captureId } = req.body;
    const username = req.user?.username;

    if (!captureId || !mongoose.Types.ObjectId.isValid(captureId)) {
      return res.status(400).json({ error: 'Valid captureId required' });
    }

    const capture = await ReceiptCapture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Receipt capture not found' });
    }

    if (capture.status !== 'review_complete') {
      return res.status(400).json({ error: 'All items must be confirmed before commit' });
    }

    // Process each confirmed item
    let committed = 0;
    const errors = [];

    for (const item of capture.draftItems) {
      if (!item.boundProductId) continue; // Skip unconfirmed items

      try {
        const product = await Product.findById(item.boundProductId);
        if (!product) {
          errors.push({ lineIndex: item.lineIndex, error: 'Product not found' });
          continue;
        }

        // Update StoreInventory
        const inventoryUpdate = {
          $set: {
            observedPrice: item.unitPrice,
            observedAt: new Date(),
            updatedAt: new Date()
          },
          $push: {
            priceHistory: {
              $each: [{
                price: item.unitPrice,
                observedAt: new Date(),
                captureId: capture._id.toString(),
                receiptImageUrl: capture.images[0]?.url,
                receiptThumbnailUrl: capture.images[0]?.thumbnailUrl,
                matchMethod: item.matchMethod || 'manual_confirm',
                matchConfidence: item.matchConfidence || 1.0,
                confirmedBy: item.confirmedBy,
                priceType: item.priceType || 'regular',
                promoDetected: item.promoDetected || false
              }],
              $slice: -20 // Keep last 20
            },
            appliedCaptures: {
              $each: [{
                captureId: capture._id.toString(),
                lineIndex: item.lineIndex,
                appliedAt: new Date()
              }],
              $slice: -50 // Keep last 50
            }
          }
        };

        await StoreInventory.updateOne(
          { storeId: capture.storeId, productId: item.boundProductId },
          inventoryUpdate,
          { upsert: true }
        );

        // Update or create ReceiptNameAlias
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
          { upsert: true }
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
    await capture.save();

    res.json({
      ok: true,
      captureId: capture._id.toString(),
      committed,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error committing receipt:', error);
    res.status(500).json({ error: 'Failed to commit receipt' });
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
          if (!validation.valid) {
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
          const priceEntry = {
            price: unitPrice,
            observedAt: new Date(),
            storeId: store._id,
            captureId,
            orderId: orderId || undefined,
            quantity: Number(quantity),
            receiptImageUrl: receiptImageUrl || undefined,
            receiptThumbnailUrl: receiptThumbnailUrl || undefined,
            matchMethod,
            matchConfidence,
            priceType,
            promoDetected
          };

          if (!inventory) {
            // Create new inventory entry
            inventory = await StoreInventory.create([{
              storeId: store._id,
              productId: product._id,
              sku: product.sku,
              cost: unitPrice,
              observedPrice: unitPrice,
              observedAt: new Date(),
              priceHistory: [priceEntry],
              appliedCaptures: [{ captureId, lineIndex, appliedAt: new Date() }],
              available: true,
              stockLevel: 'in-stock',
              lastVerified: new Date()
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
            inventory.observedAt = new Date();
            inventory.cost = finalPrice;
            inventory.lastVerified = new Date();
            
            // Add to history (keep last 20 entries)
            if (!inventory.priceHistory) inventory.priceHistory = [];
            inventory.priceHistory.push(priceEntry);
            if (inventory.priceHistory.length > 20) {
              inventory.priceHistory = inventory.priceHistory.slice(-20);
            
            // Track idempotency
            if (!inventory.appliedCaptures) inventory.appliedCaptures = [];
            inventory.appliedCaptures.push({ captureId, lineIndex, appliedAt: new Date() });
            if (inventory.appliedCaptures.length > 50) {
              inventory.appliedCaptures = inventory.appliedCaptures.slice(-50);
            }
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
    if (!validation.valid) {
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
        promoDetected: false
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
 */
router.get('/receipt-captures', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  try {
    const { storeId, status, limit = 50 } = req.query;
    
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

export default router;
