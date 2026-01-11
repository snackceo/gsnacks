import express from 'express';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

router.get('/health', (req, res) => {
  const apiKey = getGeminiApiKey();
  return res.json({ configured: Boolean(apiKey) });
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

  try {
    const prompt = `Perform Logistics Audit:
Inventory: ${JSON.stringify(inventory)}
Orders: ${JSON.stringify(orders)}`;
    const modelName = req.body?.model || 'gemini-2.5-flash';
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
    return res.status(500).json({ message: 'Audit transmission interrupted.' });
  }
});

export default router;
