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

router.post('/ops-summary', async (req, res) => {
  const { orders, rangeLabel } = req.body ?? {};

  if (!Array.isArray(orders)) {
    return res.status(400).json({ message: 'Orders array is required.' });
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
    const label = String(rangeLabel || 'latest period');
    const prompt = `Summarize logistics operations for ${label}.
Provide:
- total orders
- authorized vs captured counts if available
- deliveries completed
- returns verified
- any notable anomalies or blockers
Orders: ${JSON.stringify(orders)}`;

    const ai = new GoogleGenAI({ apiKey: apiReady.apiKey });
    const response = await ai.models.generateContent({
      model: modelSelection.modelName,
      contents: prompt,
      generationConfig: { temperature: 0.2 }
    });
    const summary = response?.text?.trim?.() ?? '';
    return res.json({ summary });
  } catch (error) {
    console.error('Gemini ops summary failed.', error);
    return res.status(502).json({
      message: 'Ops summary interrupted.',
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
