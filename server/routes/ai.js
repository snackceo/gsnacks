import express from 'express';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load customer knowledge base from markdown
let CUSTOMER_KNOWLEDGE = '';
try {
  const knowledgePath = path.join(__dirname, '..', '..', 'CUSTOMER_KNOWLEDGE.md');
  CUSTOMER_KNOWLEDGE = fs.readFileSync(knowledgePath, 'utf-8');
} catch (error) {
  console.warn('⚠️ Could not load CUSTOMER_KNOWLEDGE.md - chatbot will use basic training');
  CUSTOMER_KNOWLEDGE = 'Customer knowledge base not available. Please check documentation files.';
}

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const getVisionApiKey = () =>
  process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY || '';

const DEFAULT_MODELS = ['gemini-2.5-flash'];

const getAllowedModels = () => {
  const raw = process.env.GEMINI_MODELS;
  if (!raw) return DEFAULT_MODELS;
  const models = raw
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
  return models.length ? models : DEFAULT_MODELS;
};

const getDefaultModel = () => {
  return process.env.GEMINI_DEFAULT_MODEL || getAllowedModels()[0];
};

const resolveModelName = requestedModel => {
  const allowedModels = getAllowedModels();
  const defaultModel = getDefaultModel();
  const modelName = requestedModel || defaultModel;

  if (!allowedModels.includes(modelName)) {
    return {
      ok: false,
      error: `Unsupported model "${modelName}".`,
      allowedModels,
      defaultModel
    };
  }

  return { ok: true, modelName, allowedModels, defaultModel };
};

const ensureGeminiReady = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Gemini API key not configured.' };
  }
  return { ok: true, apiKey };
};

const ensureVisionReady = () => {
  const apiKey = getVisionApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Cloud Vision API key not configured.' };
  }
  return { ok: true, apiKey };
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeContainerType = value => {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['plastic', 'glass', 'aluminum'].includes(normalized)) return normalized;
  return '';
};

const normalizeSizeUnit = value => {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['oz', 'fl oz', 'g', 'kg', 'ml', 'l'].includes(normalized)) {
    return normalized;
  }
  return '';
};

const stripBase64ImagePrefix = value =>
  typeof value === 'string'
    ? value.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '')
    : value;

const getSearchApiConfig = () => {
  const apiKey =
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_API_KEY || '';
  const engineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || '';

  if (!apiKey || !engineId) {
    return {
      ok: false,
      error:
        'Search API key or engine ID not configured. Set GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_ENGINE_ID.'
    };
  }

  return { ok: true, apiKey, engineId };
};

const normalizeUpc = value =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\D/g, '')
    : '';

const normalizeVisionText = text =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';

const parseLabelText = rawText => {
  const text = typeof rawText === 'string' ? rawText : '';
  if (!text) {
    return {
      upc: '',
      brand: '',
      sizeValue: 0,
      sizeUnit: '',
      snippet: ''
    };
  }

  const normalizedText = text.replace(/\r/g, '');
  const lines = normalizedText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const upcMatches = normalizedText.match(/\b\d{12,14}\b/g) || [];
  const upcCandidate =
    upcMatches.find(code => code.length === 12 || code.length === 13) ||
    upcMatches[0] ||
    '';

  const sizeMatch = normalizedText.match(
    /\b(\d+(?:\.\d+)?)\s*(fl\s?oz|oz|ml|l|g|kg)\b/i
  );
  const sizeValue = sizeMatch ? Number(sizeMatch[1]) : 0;
  const sizeUnit = sizeMatch ? normalizeSizeUnit(sizeMatch[2]) : '';

  const bannedTokens = [
    'nutrition facts',
    'ingredients',
    'serving',
    'calories',
    'distributed by',
    'best by',
    'keep refrigerated',
    'barcode',
    'www',
    'http'
  ];

  const brandCandidate = lines.find(line => {
    const lower = line.toLowerCase();
    if (!/[a-zA-Z]/.test(line)) return false;
    if (bannedTokens.some(token => lower.includes(token))) return false;
    if (line.length < 3) return false;
    const wordCount = line.split(/\s+/).length;
    if (wordCount > 6) return false;
    return true;
  });

    return {
      upc: normalizeUpc(upcCandidate),
      brand: brandCandidate || '',
      sizeValue: Number.isFinite(sizeValue) ? sizeValue : 0,
      sizeUnit,
      snippet: normalizeVisionText(normalizedText).slice(0, 280)
    };
  };


const detectLabelText = async (imageData, mimeType) => {
  const visionReady = ensureVisionReady();
  if (!visionReady.ok) {
    return {
      ok: false,
      error: visionReady.error,
      text: ''
    };
  }

  const url = new URL('https://vision.googleapis.com/v1/images:annotate');
  url.searchParams.set('key', visionReady.apiKey);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageData },
          features: [{ type: 'TEXT_DETECTION', maxResults: 5 }],
          imageContext: mimeType
            ? { languageHints: ['en'], cropHintsParams: { aspectRatios: [] } }
            : { languageHints: ['en'] }
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      ok: false,
      error: `Vision API request failed (${response.status}): ${
        detail || 'unknown error'
      }`,
      text: ''
    };
  }

  const data = await response.json();
  const annotations = data?.responses?.[0]?.textAnnotations || [];
  const fullText = annotations?.[0]?.description || '';

  return { ok: true, text: fullText };
};

const buildSearchQueries = ({ upc, brand, name }) => {
  const normalizedBrand = typeof brand === 'string' ? brand.trim() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const label = [normalizedBrand, normalizedName].filter(Boolean).join(' ').trim();

  const queries = [
    upc ? `UPC ${upc}` : '',
    label ? `${label} size fl oz` : '',
    label ? label : ''
  ].filter(Boolean);

  return Array.from(new Set(queries));
};

const fetchSearchResults = async (query, apiKey, engineId) => {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', engineId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '5');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Search API request failed (${response.status}): ${detail || 'unknown error'}`
    );
  }

  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map(item => ({
    title: String(item?.title || ''),
    snippet: String(item?.snippet || ''),
    link: String(item?.link || '')
  }));
};

const buildSearchSummary = items => {
  const lines = items
    .filter(item => item.title || item.snippet)
    .slice(0, 8)
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}${item.snippet ? ` — ${item.snippet}` : ''}${
          item.link ? ` (${item.link})` : ''
        }`
    );

  return lines.join('\n');
};

// ============================================================
// UNIFIED AI ASSISTANT ENDPOINT
// ============================================================
// Single entry point for all AI interactions
// 1. Intent classification
// 2. Tool routing based on intent
// 3. Structured response

router.post('/assistant', async (req, res) => {
  const { query, products = [], context = {} } = req.body ?? {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ error: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      error: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    // STEP 1: Intent Classification
    const intentPrompt = `Classify the user's intent. Respond ONLY with JSON (no markdown):
{
  "intent": "product_search|natural_search|support|order_help|returns|recommendation|navigation|unknown",
  "confidence": 0-100,
  "category": "optional - category if product_search",
  "reasoning": "brief explanation"
}

User query: "${query}"

Guidelines:
- product_search: asking for specific product types ("drinks", "snacks", "healthy")
- natural_search: open-ended search with adjectives ("cheap under $5", "best sellers")
- support: questions about policies, delivery, account, etc.
- order_help: questions about specific orders
- returns: mentions scanning, containers, returns, refunds
- recommendation: asking for suggestions based on preferences
- navigation: asking how to do something on the site
- unknown: can't classify`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const intentResponse = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: intentPrompt,
      generationConfig: { temperature: 0.1 }
    });

    const intentText = intentResponse?.text?.trim?.() ?? '{}';
    const intentJson = JSON.parse(intentText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, ''));
    const intent = intentJson.intent || 'unknown';
    const intentConfidence = intentJson.confidence || 0;

    // STEP 2: Route based on intent
    if (intent === 'product_search' || intent === 'natural_search') {
      // Call natural search logic
      const searchPayload = { query, products, model: modelSelection.modelName };
      const searchRes = await naturalSearchInternal(searchPayload);
      
      return res.json({
        intent,
        intentConfidence,
        type: 'products',
        productIds: searchRes.matchedProducts || [],
        interpretation: searchRes.interpretation || query,
        count: (searchRes.matchedProducts || []).length
      });
    }

    if (intent === 'returns') {
      return res.json({
        intent,
        intentConfidence,
        type: 'action',
        action: 'open_return_scanner',
        message: 'Let me open the return scanner for you.'
      });
    }

    if (intent === 'recommendation') {
      // Return minimal response; frontend can trigger recommendations UI
      return res.json({
        intent,
        intentConfidence,
        type: 'action',
        action: 'open_recommendations',
        message: 'I can suggest products based on your preferences!'
      });
    }

    // For support, order_help, navigation, unknown: use chatbot
    const chatPayload = {
      message: query,
      conversationHistory: [],
      userContext: context,
      model: modelSelection.modelName
    };
    const chatRes = await chatInternal(chatPayload);

    return res.json({
      intent,
      intentConfidence,
      type: 'chat',
      reply: chatRes.reply || 'I can help with that. Can you provide more details?',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI assistant failed:', error);
    return res.status(502).json({
      error: 'AI assistant error',
      message: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

// Helper function for natural search (extracted for reuse)
const naturalSearchInternal = async ({ query, products = [], model = getDefaultModel() }) => {
  // Simplified internal version of natural-search logic
  const matchedProducts = products.filter(p => {
    const text = `${p.name} ${p.category} ${p.description || ''}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return {
    matchedProducts: matchedProducts.map(p => p._id || p.id),
    interpretation: `Searching for: ${query}`,
    count: matchedProducts.length
  };
};

// Helper function for chat (extracted for reuse)
const chatInternal = async ({ message, conversationHistory = [], userContext = {}, model = getDefaultModel() }) => {
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const history = Array.isArray(conversationHistory) ? conversationHistory : [];
  const context = userContext || {};

  const systemPrompt = `You are a helpful customer support agent for NinpoSnacks.

## KNOWLEDGE BASE:
${CUSTOMER_KNOWLEDGE}

## CUSTOMER CONTEXT:
${JSON.stringify(context, null, 2)}

## INSTRUCTIONS:
- Answer ONLY based on knowledge base
- Be friendly, helpful, concise
- Never discuss internal logic or code
- Always include "Believe it! 🍜" at end
- For contact: Instagram @ninpo_llc`;

  const prompt = `${systemPrompt}\n\nCustomer: ${message}\nAgent:`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
  });

  return {
    reply: response?.text?.trim?.() || 'I apologize, could you rephrase?',
    timestamp: new Date().toISOString()
  };
};

router.get('/health', (req, res) => {
  const apiKey = getGeminiApiKey();
  return res.json({ configured: Boolean(apiKey) });
});

router.get('/models', (req, res) => {
  const models = getAllowedModels();
  return res.json({ models, defaultModel: getDefaultModel() });
});

router.post('/inventory-audit', async (req, res) => {
  const { inventory, orders } = req.body ?? {};

  if (!inventory || !orders) {
    return res
      .status(400)
      .json({ message: 'Inventory and orders are required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Perform Logistics Audit:
Inventory: ${JSON.stringify(inventory)}
Orders: ${JSON.stringify(orders)}`;
    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.2 }
    });
    const insights = response?.text?.trim?.() ?? '';
    return res.json({ insights });
  } catch (error) {
    console.error('Gemini inventory audit failed.', error);
    return res.status(502).json({
      message: 'Audit transmission interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});



router.post('/product-scan', async (req, res) => {
  const { image, mimeType, model, upc } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ message: 'Product image is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  const base64Data = stripBase64ImagePrefix(image);
  const imageData = typeof base64Data === 'string' ? base64Data : '';
  if (!imageData || imageData.length < 32) {
    return res.status(400).json({ message: 'Invalid photo data. Please retake.' });
  }

  let visionText = '';
  let visionParsed = {
    upc: '',
    brand: '',
    sizeValue: 0,
    sizeUnit: '',
    snippet: ''
  };

  try {
    const visionResult = await detectLabelText(imageData, mimeType);
    if (visionResult.ok && visionResult.text) {
      visionText = visionResult.text;
      visionParsed = parseLabelText(visionText);
    } else if (!visionResult.ok && visionResult.error) {
      console.warn('Vision text detection unavailable:', visionResult.error);
    }
  } catch (error) {
    console.warn('Vision text detection failed.', error);
  }

  const resolvedUpc = normalizeUpc(upc) || visionParsed.upc || 'unknown';

  const prompt = `For a product with UPC "${resolvedUpc}", extract metadata from this label image.
Return JSON only: {"name":"", "brand":"", "productType":"", "category":"", "sizeOz":0, "sizeUnit":"oz|fl oz|g|kg|ml|l|", "quantity":0, "nutritionNote":"", "storageZone":"", "storageBin":"", "image":"", "containerType":"plastic|glass|aluminum|", "isEligible":true|false, "message":""}.
Use empty string or 0 if unknown. "sizeUnit" should be one of oz, fl oz, g, kg, ml, l, or empty. "containerType" should be one of plastic, glass, aluminum, or empty. "isEligible" means Michigan 10¢ deposit eligible.
OCR hints from Cloud Vision:
- UPC: "${visionParsed.upc || ''}"
- Brand: "${visionParsed.brand || ''}"
  - Size: "${visionParsed.sizeValue || ''} ${visionParsed.sizeUnit || ''}"
  - Text snippet: "${visionParsed.snippet || ''}"`;

  try {
    console.info('Gemini product image data:', {
      type: typeof imageData,
      length: imageData.length
    });
    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inline_data: {
                data: imageData,
                mime_type: mimeType || 'image/jpeg'
              }
            }
          ]
        }
      ],
      generationConfig: { temperature: 0.2 }
    });

    const rawText = response?.text?.trim?.() ?? '';
    if (!rawText) {
      return res.status(502).json({
        name: '',
        brand: '',
        productType: '',
        category: '',
        sizeOz: Number(visionParsed.sizeValue || 0),
        sizeUnit: visionParsed.sizeUnit,
        quantity: 0,
        nutritionNote: '',
        storageZone: '',
        storageBin: '',
        image: '',
        containerType: '',
        isEligible: false,
        message: 'No analysis response returned.',
        visionHints: {
          upc: visionParsed.upc,
          brand: visionParsed.brand,
          sizeValue: visionParsed.sizeValue,
          sizeUnit: visionParsed.sizeUnit
        }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === 'object') {
      const fallbackBrand = visionParsed.brand;
      const fallbackSizeUnit = visionParsed.sizeUnit;
      const fallbackSizeValue = visionParsed.sizeValue;
      return res.json({
        name: String(parsed.name || ''),
        brand: String(parsed.brand || fallbackBrand || ''),
        productType: String(parsed.productType || ''),
        category: String(parsed.category || ''),
        sizeOz: normalizeNumber(
          parsed.sizeOz,
          Number(fallbackSizeValue || 0)
        ),
        sizeUnit: normalizeSizeUnit(parsed.sizeUnit || fallbackSizeUnit),
        quantity: Math.max(0, Math.round(normalizeNumber(parsed.quantity, 0))),
        nutritionNote: String(parsed.nutritionNote || ''),
        storageZone: String(parsed.storageZone || ''),
        storageBin: String(parsed.storageBin || ''),
        image: String(parsed.image || ''),
        containerType: normalizeContainerType(parsed.containerType),
        isEligible: Boolean(parsed.isEligible),
        message: String(parsed.message || ''),
        visionHints: {
          upc: visionParsed.upc,
          brand: visionParsed.brand,
          sizeValue: visionParsed.sizeValue,
          sizeUnit: visionParsed.sizeUnit
        }
      });
    }

    return res.json({
      name: '',
      brand: visionParsed.brand,
      productType: '',
      category: '',
      sizeOz: Number(visionParsed.sizeValue || 0),
      sizeUnit: visionParsed.sizeUnit,
      quantity: 0,
      nutritionNote: '',
      storageZone: '',
      storageBin: '',
      image: '',
      containerType: '',
      isEligible: false,
      message: rawText,
      visionHints: {
        upc: visionParsed.upc,
        brand: visionParsed.brand,
        sizeValue: visionParsed.sizeValue,
        sizeUnit: visionParsed.sizeUnit
      }
    });
  } catch (error) {
    console.error('Gemini product scan failed.', error);
    return res.status(502).json({
      name: '',
      brand: visionParsed.brand,
      productType: '',
      category: '',
      sizeOz: Number(visionParsed.sizeValue || 0),
      sizeUnit: visionParsed.sizeUnit,
      quantity: 0,
      nutritionNote: '',
      storageZone: '',
      storageBin: '',
      image: '',
      containerType: '',
      isEligible: false,
      message: 'Product scan failed.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName,
      visionHints: {
        upc: visionParsed.upc,
        brand: visionParsed.brand,
        sizeValue: visionParsed.sizeValue,
        sizeUnit: visionParsed.sizeUnit
      }
    });
  }
});

router.post('/product-lookup', async (req, res) => {
  const { upc, brand, name, model } = req.body ?? {};
  const normalizedUpc = normalizeUpc(upc);

  if (!normalizedUpc) {
    return res.status(400).json({ message: 'UPC is required.' });
  }

  const searchConfig = getSearchApiConfig();
  if (!searchConfig.ok) {
    return res.status(503).json({ message: searchConfig.error });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  const queries = buildSearchQueries({
    upc: normalizedUpc,
    brand,
    name
  });

  if (!queries.length) {
    return res.status(400).json({ message: 'Search terms could not be built.' });
  }

  try {
    const allResults = [];
    for (const query of queries) {
      const results = await fetchSearchResults(
        query,
        searchConfig.apiKey,
        searchConfig.engineId
      );
      allResults.push(
        ...results.map(result => ({
          ...result,
          query
        }))
      );
    }

    const deduped = [];
    const seenLinks = new Set();
    for (const item of allResults) {
      if (!item.link || seenLinks.has(item.link)) continue;
      seenLinks.add(item.link);
      deduped.push(item);
    }

    const searchSummary = buildSearchSummary(deduped);
    if (!searchSummary) {
      return res.status(502).json({
        upc: normalizedUpc,
        name: '',
        brand: '',
        productType: '',
        category: '',
        sizeOz: 0,
        sizeUnit: '',
        quantity: 0,
        containerType: '',
        message: 'No search results found.'
      });
    }

    const prompt = `You are a product metadata extractor.
Given the web search snippets for a UPC lookup, return JSON only with the best guess for:
{"name":"","brand":"","productType":"","category":"","sizeOz":0,"sizeUnit":"oz|fl oz|g|kg|ml|l|","quantity":0,"containerType":"plastic|glass|aluminum|","upc":"","message":""}
Use empty string or 0 if unknown. Normalize size into sizeOz + sizeUnit when possible.
UPC hint: "${normalizedUpc}". Photo hints: brand "${brand || ''}", name "${name || ''}".
Search snippets:
${searchSummary}`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.2 }
    });

    const rawText = response?.text?.trim?.() ?? '';
    if (!rawText) {
      return res.status(502).json({
        upc: normalizedUpc,
        name: '',
        brand: '',
        productType: '',
        category: '',
        sizeOz: 0,
        sizeUnit: '',
        quantity: 0,
        containerType: '',
        message: 'No extraction response returned.'
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === 'object') {
      return res.json({
        upc: String(parsed.upc || normalizedUpc),
        name: String(parsed.name || ''),
        brand: String(parsed.brand || ''),
        productType: String(parsed.productType || ''),
        category: String(parsed.category || ''),
        sizeOz: normalizeNumber(parsed.sizeOz, 0),
        sizeUnit: normalizeSizeUnit(parsed.sizeUnit),
        quantity: Math.max(0, Math.round(normalizeNumber(parsed.quantity, 0))),
        containerType: normalizeContainerType(parsed.containerType),
        message: String(parsed.message || ''),
        searchSummary,
        sources: deduped.slice(0, 6)
      });
    }

    return res.json({
      upc: normalizedUpc,
      name: '',
      brand: '',
      productType: '',
      category: '',
      sizeOz: 0,
      sizeUnit: '',
      quantity: 0,
      containerType: '',
      message: rawText,
      searchSummary,
      sources: deduped.slice(0, 6)
    });
  } catch (error) {
    console.error('Product lookup failed.', error);
    return res.status(502).json({
      upc: normalizedUpc,
      name: '',
      brand: '',
      productType: '',
      category: '',
      sizeOz: 0,
      sizeUnit: '',
      quantity: 0,
      containerType: '',
      message: 'Product lookup failed.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

router.post('/ops-summary', async (req, res) => {
  const { orders, rangeLabel } = req.body ?? {};

  if (!Array.isArray(orders)) {
    return res.status(400).json({ message: 'Orders array is required.' });
  }

  const summarizeOps = rawOrders => {
    const totalOrders = rawOrders.length;
    const asNumber = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    const authorizedCount = rawOrders.filter(
      order => asNumber(order?.authorizedAmount) > 0
    ).length;
    const capturedCount = rawOrders.filter(order => asNumber(order?.capturedAmount) > 0)
      .length;
    const pendingCount = rawOrders.filter(order => order?.status === 'PENDING').length;
    const closedCount = rawOrders.filter(order => order?.status === 'CLOSED').length;
    const deliveredCount = rawOrders.filter(
      order => order?.status === 'DELIVERED' || Boolean(order?.deliveredAt)
    ).length;
    const verifiedReturnsCount = rawOrders.filter(
      order => Array.isArray(order?.verifiedReturnUpcs) && order.verifiedReturnUpcs.length > 0
    ).length;
    const pendingAuthorizedCount = rawOrders.filter(
      order => order?.status === 'PENDING' && asNumber(order?.authorizedAmount) > 0
    ).length;
    const pendingUnauthorizedCount = rawOrders.filter(
      order => order?.status === 'PENDING' && asNumber(order?.authorizedAmount) <= 0
    ).length;

    const anomalies = [];
    if (pendingUnauthorizedCount > 0) {
      anomalies.push(
        `${pendingUnauthorizedCount} pending order${
          pendingUnauthorizedCount === 1 ? '' : 's'
        } without authorization.`
      );
    }
    if (authorizedCount > 0 && capturedCount === 0) {
      anomalies.push('No captured payments yet, despite active authorizations.');
    }
    if (closedCount > 0 && deliveredCount === 0) {
      anomalies.push('Closed orders detected without delivery timestamps.');
    }

    const summaryLines = [
      `Total Orders: ${totalOrders}`,
      `Authorized vs Captured Counts: ${authorizedCount} authorized, ${capturedCount} captured`,
      `Deliveries Completed: ${deliveredCount}`,
      `Returns Verified: ${verifiedReturnsCount}`,
      `Pending Orders: ${pendingCount} (${pendingAuthorizedCount} authorized, ${pendingUnauthorizedCount} unauthorized)`,
      `Anomalies or Blockers: ${
        anomalies.length ? anomalies.join(' ') : 'None detected.'
      }`
    ];

    return {
      summaryText: summaryLines.join('\n'),
      stats: {
        totalOrders,
        authorizedCount,
        capturedCount,
        deliveredCount,
        closedCount,
        pendingCount,
        pendingAuthorizedCount,
        pendingUnauthorizedCount,
        verifiedReturnsCount,
        anomalies
      }
    };
  };

  const { summaryText, stats } = summarizeOps(orders);

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.json({
      summary: summaryText,
      stats,
      notice: apiReady.error
    });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const label = String(rangeLabel || 'latest period');
    const prompt = `Summarize logistics operations for ${label}.
Use the provided baseline summary for accurate counts, then add brief narrative context.
Baseline summary (deterministic): ${summaryText}
Orders: ${JSON.stringify(orders)}`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.2 }
    });
    const summary = response?.text?.trim?.() ?? '';
    return res.json({
      summary: summary || summaryText,
      stats,
      baselineSummary: summaryText
    });
  } catch (error) {
    console.error('Gemini ops summary failed.', error);
    return res.json({
      summary: summaryText,
      stats,
      warning: 'Ops summary interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

router.post('/issue-explain', async (req, res) => {
  const { order, errorMessage, auditLogs } = req.body ?? {};

  if (!order || !errorMessage) {
    return res
      .status(400)
      .json({ message: 'Order and errorMessage are required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Explain the following logistics issue in plain language.
Order: ${JSON.stringify(order)}
Error: ${String(errorMessage)}
Audit logs (optional): ${JSON.stringify(auditLogs || [])}
Provide:
- root cause
- immediate next step for a driver
- if owner action is required.`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.2 }
    });
    const explanation = response?.text?.trim?.() ?? '';
    return res.json({ explanation });
  } catch (error) {
    console.error('Gemini issue explanation failed.', error);
    return res.status(502).json({
      message: 'Issue explanation interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

router.post('/audit-summary', async (req, res) => {
  const { auditLogs } = req.body ?? {};

  if (!Array.isArray(auditLogs)) {
    return res.status(400).json({ message: 'Audit logs array is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error, summary: '' });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Summarize the following audit logs. Identify any suspicious or notable activity, such as multiple failed logins, unusual credit adjustments, or rapid changes to orders. Provide a brief, high-level summary of user actions.
Audit Logs:
${JSON.stringify(auditLogs)}`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.3 }
    });
    const summary = response?.text?.trim?.() ?? '';
    return res.json({ summary });
  } catch (error) {
    console.error('Gemini audit summary failed.', error);
    return res.status(502).json({
      message: 'Audit summary interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

// 1. Smart Address Validation
router.post('/validate-address', async (req, res) => {
  const { address } = req.body ?? {};

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ message: 'Valid address string is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Validate and correct the following address. Respond ONLY with a JSON object (no markdown, no extra text) in this exact format:
{
  "isValid": true/false,
  "correctedAddress": "full corrected address",
  "confidence": 0-100,
  "issues": ["issue1", "issue2"],
  "suggestions": "helpful suggestion if needed"
}

Address to validate: "${address}"

Rules:
- Check for common typos (e.g., "Steet" → "Street")
- Verify state abbreviations are correct
- Ensure ZIP code format is valid
- Flag missing apartment/unit numbers
- Suggest corrections for ambiguous addresses`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.1 }
    });
    
    const text = response?.text?.trim?.() ?? '';
    // Strip markdown code blocks if present
    const jsonText = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const result = JSON.parse(jsonText);
    
    return res.json(result);
  } catch (error) {
    console.error('Gemini address validation failed.', error);
    return res.status(502).json({
      message: 'Address validation interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

// 2. Customer Support Chatbot
router.post('/chat', async (req, res) => {
  const { message, conversationHistory, userContext } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ message: 'Message is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];
    const context = userContext || {};
    
    const systemPrompt = `You are a helpful customer support agent for NinpoSnacks.

## KNOWLEDGE BASE (Read this carefully - it contains all customer-facing information):

${CUSTOMER_KNOWLEDGE}

## CURRENT CUSTOMER CONTEXT:
${JSON.stringify(context, null, 2)}

## CONVERSATION HISTORY:
${history.map(h => `${h.role}: ${h.message}`).join('\n')}

## INSTRUCTIONS:
- Answer ONLY based on the knowledge base above
- Be friendly, helpful, and concise
- If the customer asks about something not in the knowledge base, politely say you'll connect them with a human agent
- Always include "Believe it! 🍜" at the end of responses for brand consistency
- Never mention internal calculations, formulas, or backend logic
- Never discuss code, technical implementation, or system architecture
- Focus on customer benefits, not how things work behind the scenes
- For contact info, always direct to Instagram @ninpo_llc

Provide helpful, friendly, concise responses. If you need more information, ask clarifying questions.`;

    const prompt = `${systemPrompt}\n\nCustomer: ${message}\nAgent:`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { 
        temperature: 0.7,
        maxOutputTokens: 500
      }
    });
    
    const reply = response?.text?.trim?.() ?? 'I apologize, but I had trouble processing that. Could you rephrase?';
    
    return res.json({ reply, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Gemini chat failed.', error);
    return res.status(502).json({
      message: 'Chat interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

// 3. Product Recommendations
router.post('/recommendations', async (req, res) => {
  const { userId, orderHistory, currentCart } = req.body ?? {};

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Analyze the customer's purchase history and current cart, then recommend 5 products they might like. Respond ONLY with a JSON array (no markdown) of product suggestions:
[
  {
    "productName": "suggested product name",
    "category": "category",
    "reason": "why this recommendation makes sense",
    "confidence": 0-100
  }
]

Order history (last 10 orders):
${JSON.stringify(orderHistory || [], null, 2)}

Current cart:
${JSON.stringify(currentCart || [], null, 2)}

Focus on:
- Frequently purchased items that are missing from current cart
- Complementary products (chips + dip, cereal + milk)
- Items in similar categories to their preferences
- Seasonal or trending items based on order patterns`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.6 }
    });
    
    const text = response?.text?.trim?.() ?? '[]';
    const jsonText = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const recommendations = JSON.parse(jsonText);
    
    return res.json({ recommendations, userId });
  } catch (error) {
    console.error('Gemini recommendations failed.', error);
    return res.status(502).json({
      message: 'Recommendations interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName,
      recommendations: []
    });
  }
});

// 4. Automatic Product Categorization
router.post('/categorize-product', async (req, res) => {
  const { productName, brand, description, image } = req.body ?? {};

  if (!productName) {
    return res.status(400).json({ message: 'Product name is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Categorize this product. Respond ONLY with a JSON object (no markdown):
{
  "category": "main category",
  "subcategory": "specific subcategory",
  "tags": ["tag1", "tag2", "tag3"],
  "dietaryInfo": ["gluten-free", "vegan", etc],
  "shelfLife": "estimated shelf life",
  "storageType": "refrigerated/frozen/pantry"
}

Product: ${productName}
Brand: ${brand || 'Unknown'}
Description: ${description || 'Not provided'}

Categories should match: Beverages, Snacks, Dairy, Frozen Foods, Bakery, Household, Personal Care, etc.`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    
    let contents = prompt;
    if (image) {
      const cleanImage = stripBase64ImagePrefix(image);
      contents = [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: cleanImage } }
      ];
    }

    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents,
      generationConfig: { temperature: 0.2 }
    });
    
    const text = response?.text?.trim?.() ?? '{}';
    const jsonText = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const categorization = JSON.parse(jsonText);
    
    return res.json(categorization);
  } catch (error) {
    console.error('Gemini categorization failed.', error);
    return res.status(502).json({
      message: 'Categorization interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

// 5. Demand Forecasting
router.post('/demand-forecast', async (req, res) => {
  const { products, orderHistory, timeframe } = req.body ?? {};

  if (!Array.isArray(products) || !Array.isArray(orderHistory)) {
    return res.status(400).json({ message: 'Products and order history arrays are required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Analyze order history and predict demand for the next ${timeframe || 'week'}. Respond ONLY with a JSON object (no markdown):
{
  "forecast": [
    {
      "productId": "id",
      "productName": "name",
      "predictedSales": number,
      "confidence": 0-100,
      "trend": "increasing/stable/decreasing",
      "stockRecommendation": "restock quantity or OK"
    }
  ],
  "insights": "overall market insights and recommendations"
}

Current products:
${JSON.stringify(products.slice(0, 50), null, 2)}

Order history (last 30 days):
${JSON.stringify(orderHistory.slice(0, 100), null, 2)}

Consider:
- Seasonal trends
- Day of week patterns
- Historical sales velocity
- Product correlations
- Stock-out incidents`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.4 }
    });
    
    const text = response?.text?.trim?.() ?? '{"forecast":[],"insights":"Unable to generate forecast"}';
    const jsonText = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const forecast = JSON.parse(jsonText);
    
    return res.json(forecast);
  } catch (error) {
    console.error('Gemini demand forecast failed.', error);
    return res.status(502).json({
      message: 'Demand forecast interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName,
      forecast: [],
      insights: 'Forecast unavailable'
    });
  }
});

// 6. Natural Language Search
router.post('/natural-search', async (req, res) => {
  const { query, products } = req.body ?? {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ message: 'Search query is required.' });
  }

  if (!Array.isArray(products)) {
    return res.status(400).json({ message: 'Products array is required.' });
  }

  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ message: apiReady.error });
  }

  const modelSelection = resolveModelName(req.body?.model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      message: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    const prompt = `Interpret this natural language search query and return matching products. Respond ONLY with a JSON object (no markdown):
{
  "matchedProducts": ["productId1", "productId2"],
  "interpretation": "how you interpreted the query",
  "filters": {
    "priceRange": {"min": 0, "max": 100},
    "categories": ["category1"],
    "keywords": ["keyword1"]
  }
}

Search query: "${query}"

Available products:
${JSON.stringify(products.slice(0, 100), null, 2)}

Examples of queries to handle:
- "cheap snacks under $5"
- "healthy breakfast options"
- "drinks for party"
- "gluten free pasta"
- "best selling chips"
- "new arrivals this week"`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.3 }
    });
    
    const text = response?.text?.trim?.() ?? '{"matchedProducts":[],"interpretation":"No matches found"}';
    const jsonText = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    const result = JSON.parse(jsonText);
    
    return res.json(result);
  } catch (error) {
    console.error('Gemini natural search failed.', error);
    return res.status(502).json({
      message: 'Natural search interrupted.',
      error: error?.message || 'Unknown error',
      model: modelSelection.modelName,
      matchedProducts: []
    });
  }
});

// ============================================================
// CHECKOUT EXPLANATION
// Explains pricing, fees, and delivery options in plain English
// Does NOT calculate anything - only reads and explains
// ============================================================


// Hardened: Gemini checkout explanation endpoint
router.post('/explain-checkout', async (req, res) => {
  // Defensive: always destructure safely
  const { checkoutData, question, model } = req.body ?? {};

  // Strict input validation
  if (!checkoutData || typeof checkoutData !== 'object') {
    return res.status(400).json({ error: 'Checkout data required' });
  }
  if (!Array.isArray(checkoutData.items)) {
    return res.status(400).json({ error: 'Checkout data must include items array' });
  }
  if (typeof checkoutData.listAmount !== 'number' || !Number.isFinite(checkoutData.listAmount)) {
    return res.status(400).json({ error: 'Checkout data must include valid listAmount' });
  }
  if (typeof checkoutData.total !== 'number' || !Number.isFinite(checkoutData.total)) {
    return res.status(400).json({ error: 'Checkout data must include valid total' });
  }
  if (!checkoutData.fees || typeof checkoutData.fees !== 'object') {
    return res.status(400).json({ error: 'Checkout data must include fees object' });
  }

  // Enforce Gemini API key presence
  const apiReady = ensureGeminiReady();
  if (!apiReady.ok) {
    return res.status(503).json({ error: apiReady.error });
  }

  // Model selection validation
  const modelSelection = resolveModelName(model);
  if (!modelSelection.ok) {
    return res.status(400).json({
      error: modelSelection.error,
      allowedModels: modelSelection.allowedModels,
      defaultModel: modelSelection.defaultModel
    });
  }

  try {
    // Defensive destructure with defaults
    const {
      items = [],
      listAmount = 0,
      fees = {},
      total = 0,
      deliveryOptions = {},
      route = {},
      tier = {},
      capacity = {}
    } = checkoutData;

    // Defensive: ensure all items are objects with required fields
    const safeItems = Array.isArray(items)
      ? items.filter(item => item && typeof item === 'object' && typeof item.name === 'string' && typeof item.quantity === 'number' && typeof item.price === 'number' && typeof item.total === 'number')
      : [];

    const prompt = `You are a helpful delivery service assistant. Explain the checkout pricing to the customer in plain English.

CHECKOUT SUMMARY:
Items: ${safeItems.length} items totaling $${listAmount.toFixed(2)}
${safeItems.map(item => `  - ${item.name} x${item.quantity} @ $${item.price.toFixed(2)} = $${item.total.toFixed(2)}`).join('\n')}

FEES BREAKDOWN:
- Route Fee: $${Number(fees.routeFee ?? 0).toFixed(2)}
- Distance Fee: $${Number(fees.distanceFee ?? 0).toFixed(2)} (${Number(route.distance ?? 0).toFixed(1)} miles)
- Heavy Item Fee: $${Number(fees.heavyItemFee ?? 0).toFixed(2)}
- Large Order Fee: $${Number(fees.largeOrderFee ?? 0).toFixed(2)}
Total Fees: $${Number(fees.total ?? 0).toFixed(2)}

GRAND TOTAL: $${total.toFixed(2)}

CUSTOMER TIER: ${tier.name || 'COMMON'}
${tier.discount > 0 ? `Tier Discount Applied: ${(tier.discount * 100).toFixed(0)}% off route fee` : 'No tier discount (upgrade to Bronze/Silver/Gold for savings!)'}

DELIVERY OPTIONS:
Standard: ${deliveryOptions.standard?.eta || 'N/A'} - Direct delivery
${deliveryOptions.batch ? `Batch: ${deliveryOptions.batch.eta} - Grouped with ${deliveryOptions.batch.customersInBatch || 0} other customers (same price, longer wait)` : 'Batch: Not available for this order'}

ROUTE: ${Number(route.distance ?? 0).toFixed(1)} miles, ~${route.duration || '0'} min drive time

CAPACITY: ${capacity.orderLoad || 0} handling points (${capacity.heavyPoints || 0} heavy)

${question ? `\nCUSTOMER QUESTION: "${question}"\n` : ''}

Provide a friendly, clear explanation. If customer asked a question, answer it directly. If not, give a brief overview.
Rules:
- Be conversational and helpful
- Explain fees in simple terms (e.g., "Heavy items like milk cost $1.50 each to handle")
- Mention tier benefits if applicable
- Never calculate or change prices - only explain
- If batch is available, explain the tradeoff (same price, longer wait)
- Keep it under 150 words unless customer asks for details`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500
      }
    });

    const explanation = response?.text?.trim?.() || 'Unable to generate explanation.';

    return res.json({
      ok: true,
      explanation,
      model: modelSelection.modelName,
      summary: {
        itemCount: safeItems.length,
        listAmount,
        fees: fees.total || 0,
        total,
        tier: tier.name,
        distance: route.distance,
        batchAvailable: !!deliveryOptions.batch
      }
    });
  } catch (error) {
    // Fail loudly, never silent
    console.error('Checkout explanation failed:', error);
    return res.status(502).json({
      error: 'Failed to generate explanation',
      message: error?.message || 'Unknown error',
      model: modelSelection.modelName
    });
  }
});

export default router;
