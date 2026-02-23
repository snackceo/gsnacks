import { GoogleGenAI } from '@google/genai';
import { normalizeStoreNumber } from '../storeMatcher.js';
import {
  buildInlineDataFromDataUrl,
  fetchAsInlineData,
  parseGeminiJsonPayload,
  parseReceiptAddress,
  recoverItemsFromRawText
} from './shared.js';

const getGeminiApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const RECEIPT_PROMPT = `You are a receipt OCR specialist. Parse this receipt image THOROUGHLY.

FIRST, extract the STORE NAME, STORE NUMBER, PHONE, and ADDRESS if visible at the top or bottom of receipt. Return them as:
"storeName": "Store Name" (or null if not visible)
"storeNumber": "1234" (or null if not visible)
"phone": "555-123-4567" (or null if not visible)
"address": "123 Main St, City, ST 12345"  (or null if not visible)

THEN, extract ALL line items with prices. Return ONLY valid JSON format:
{
  "storeName": "STORE NAME",
  "storeNumber": "1234",
  "phone": "555-123-4567",
  "address": "123 MAIN ST, DEARBORN, MI 48126",
  "items": [
    {"receiptName": "COCA COLA 12PK", "upc": "012000001234", "quantity": 2, "totalPrice": 15.98},
    {"receiptName": "LAYS CHIPS ORIG", "upc": "028400123456", "quantity": 1, "totalPrice": 3.99}
  ]
}

RULES:
1. Extract store name, store number (e.g., ST#, Store #, SC#), phone, and address if visible (street, city, state, zip)
2. Extract ONLY product line items (skip store name, date, tax, subtotal, total, payment, instructions)
3. Use exact product names from receipt
4. Extract UPC if visible on the line (8-14 digits, usually near the item name)
5. For multi-buy items, calculate quantity * unit price = totalPrice
6. Skip discounts, coupons, tax lines
7. Return empty array [] for items if none found
8. Return ONLY valid JSON, no markdown, no explanation`;

export async function geminiProvider({ images }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const output = {
    provider: 'gemini',
    rawText: '',
    rawTextByImage: [],
    confidenceMetadata: null,
    blockCoordinates: null,
    parsedByImage: [],
    skippedImages: [],
    parseStageFailures: { invalid_json: 0, no_items: 0, all_images_skipped: 0 },
    storeCandidateData: {},
    items: []
  };

  for (const image of images || []) {
    let imageContent;
    if (/^https?:\/\//i.test(image.url)) {
      imageContent = await fetchAsInlineData(image.url);
    } else if (String(image.url || '').startsWith('data:')) {
      imageContent = buildInlineDataFromDataUrl(image.url);
      if (!imageContent) {
        output.skippedImages.push({ url: image.url, reason: 'invalid_data_url' });
        continue;
      }
    } else {
      output.skippedImages.push({ url: image.url, reason: 'unsupported_image_url' });
      continue;
    }

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: RECEIPT_PROMPT }, imageContent] }],
      generationConfig: { temperature: 0.1, topP: 0.8, topK: 10 }
    });

    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    output.rawTextByImage.push(text);

    const parsed = parseGeminiJsonPayload(text);
    if (!parsed) {
      output.parseStageFailures.invalid_json += 1;
      output.parsedByImage.push({ error: 'Invalid JSON' });
      continue;
    }

    output.parsedByImage.push(parsed);

    if (parsed.storeName && !output.storeCandidateData.name) output.storeCandidateData.name = parsed.storeName;
    if (parsed.storeNumber && !output.storeCandidateData.storeNumber) output.storeCandidateData.storeNumber = normalizeStoreNumber(parsed.storeNumber);
    if (parsed.phone && !output.storeCandidateData.phone) output.storeCandidateData.phone = parsed.phone;
    if (parsed.address && !output.storeCandidateData.address) output.storeCandidateData.address = parseReceiptAddress(parsed.address);

    const items = Array.isArray(parsed.items) ? parsed.items : recoverItemsFromRawText(text);
    if (!items.length) output.parseStageFailures.no_items += 1;
    output.items.push(...items);
  }

  output.rawText = output.rawTextByImage.join('\n\n');
  const totalImages = (images || []).length;
  if (output.skippedImages.length === totalImages && totalImages > 0) {
    output.parseStageFailures.all_images_skipped += 1;
  }
  output.confidenceMetadata = {
    invalidJsonRate: totalImages ? output.parseStageFailures.invalid_json / totalImages : 1,
    parsedImageCount: output.parsedByImage.filter(p => !p.error).length,
    itemCount: output.items.length
  };

  return output;
}
