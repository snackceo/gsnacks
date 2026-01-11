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

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return res
      .status(503)
      .json({ message: 'Gemini API key not configured.' });
  }

  const allowedModels = getAllowedModels();
  const defaultModel = getDefaultModel();
  const requestedModel = req.body?.model;
  const modelName = requestedModel || defaultModel;

  if (!allowedModels.includes(modelName)) {
    return res.status(400).json({
      message: `Unsupported model "${modelName}".`,
      allowedModels,
      defaultModel
    });
  }

  try {
    const prompt = `Perform Logistics Audit:
Inventory: ${JSON.stringify(inventory)}
Orders: ${JSON.stringify(orders)}`;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelName,
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
      model: modelName
    });
  }
});

export default router;
