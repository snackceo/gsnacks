import express from 'express';

const router = express.Router();

const getGeminiApiKey = () =>
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

router.get('/health', (req, res) => {
  const apiKey = getGeminiApiKey();
  return res.json({ configured: Boolean(apiKey) });
});

router.post('/inventory-audit', async (req, res) => {
  const { inventory, orders, model } = req.body ?? {};

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
    const modelName = typeof model === 'string' && model.trim() ? model.trim() : 'gemini-3-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini inventory audit failed.', errorText);
      return res.status(500).json({ message: 'Audit transmission interrupted.' });
    }

    const data = await response.json();
    const insights =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text ?? '')
        .join('')
        .trim() ?? '';
    return res.json({ insights });
  } catch (error) {
    console.error('Gemini inventory audit failed.', error);
    return res.status(500).json({ message: 'Audit transmission interrupted.' });
  }
});

export default router;
