import express from 'express';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

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

export default router;
