import express from 'express';
import { GoogleGenerativeAI } from '@google/genai';

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/explain-checkout', async (req, res) => {
  const { checkoutData, question } = req.body;

  if (!checkoutData) {
    return res.status(400).json({ error: 'checkoutData is required' });
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  const prettyCheckout = JSON.stringify(
    {
      items: checkoutData.items,
      fees: checkoutData.fees,
      total: checkoutData.total,
      tier: checkoutData.tier,
      distance: checkoutData.route?.distance,
      batchAvailable: !!checkoutData.deliveryOptions?.batch,
    },
    null,
    2
  );

  const prompt = `
    A customer is asking a question about their checkout summary.
    
    Checkout Summary:
    ${prettyCheckout}
    
    Customer Question: "${question || 'Can you explain these fees?'}"
    
    Please provide a clear, concise, and friendly explanation based on the summary.
    If they ask why a fee is high, explain what contributes to it (e.g., distance, heavy items).
    If a batch option is available, you can mention it as a cost-effective alternative if relevant.
    Do not invent any new information. Base your answer only on the data provided.
  `;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const explanation = response.text();

  res.json({ ok: true, explanation, model: 'gemini-pro', summary: JSON.parse(prettyCheckout) });
});

export default router;