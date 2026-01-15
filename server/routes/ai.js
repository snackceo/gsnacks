import express from 'express';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

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

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

router.post('/analyze-bottle', async (req, res) => {
  const { image, mimeType, model } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ message: 'Bottle image is required.' });
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

  const prompt = `Analyze the bottle image and determine Michigan 10¢ deposit eligibility.
Reply with JSON only: {"valid": true|false, "material": "PLASTIC|GLASS|ALUMINUM|OTHER|UNKNOWN", "message": "short reason"}.`;

  try {
    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: image,
                mimeType: mimeType || 'image/jpeg'
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
        valid: false,
        material: 'UNKNOWN',
        message: 'No analysis response returned.'
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
        valid: Boolean(parsed.valid),
        material: String(parsed.material || 'UNKNOWN').toUpperCase(),
        message: String(parsed.message || 'Analysis complete.')
      });
    }

    return res.json({
      valid: false,
      material: 'UNKNOWN',
      message: rawText
    });
  } catch (error) {
    console.error('Gemini bottle analysis failed.', error);
    return res.status(502).json({
      valid: false,
      material: 'UNKNOWN',
      message: 'Bottle analysis failed.',
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

  const prompt = `For a product with UPC "${upc || 'unknown'}", extract metadata from this label image.
Return JSON only: {"name":"", "sizeOz":0, "quantity":0, "isEligible":true|false, "message":""}.
Use empty string or 0 if unknown. "isEligible" means Michigan 10¢ deposit eligible.`;

  try {
    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: image,
                mimeType: mimeType || 'image/jpeg'
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
        sizeOz: 0,
        quantity: 0,
        isEligible: false,
        message: 'No analysis response returned.'
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
        name: String(parsed.name || ''),
        sizeOz: normalizeNumber(parsed.sizeOz, 0),
        quantity: Math.max(0, Math.round(normalizeNumber(parsed.quantity, 0))),
        isEligible: Boolean(parsed.isEligible),
        message: String(parsed.message || '')
      });
    }

    return res.json({
      name: '',
      sizeOz: 0,
      quantity: 0,
      isEligible: false,
      message: rawText
    });
  } catch (error) {
    console.error('Gemini product scan failed.', error);
    return res.status(502).json({
      name: '',
      sizeOz: 0,
      quantity: 0,
      isEligible: false,
      message: 'Product scan failed.',
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

export default router;
