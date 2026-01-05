
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// Ensure we handle potential undefined process for local safety
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const cache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 1000 * 60 * 30;
let quotaExhaustedUntil = 0;

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 5000): Promise<T> {
  if (Date.now() < quotaExhaustedUntil) {
    throw new Error("API_COOLDOWN_ACTIVE: Quota limit reached.");
  }

  let delay = initialDelay;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = JSON.stringify(error) || error?.message || "";
      const isRateLimit = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
      
      if (isRateLimit) {
        if (i < maxRetries) {
          console.warn(`Retrying Gemini API... ${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        } else {
          quotaExhaustedUntil = Date.now() + 120000;
        }
      }
      throw error;
    }
  }
  throw new Error("MAX_RETRIES_EXCEEDED");
}

function safeJsonParse(text: string | undefined, fallback: any) {
  if (!text) return fallback;
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return fallback;
  }
}

export const getSmartSnackRecommendations = async (history: string[]) => {
  const cacheKey = `recs_${history.join('_')}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  const fallback = [
    { name: "Detroit Style Pretzel Rods", description: "Savory garlic-butter rods.", reason: "Regional staple." },
    { name: "MI Cherry Fruit Leathers", description: "Traverse City tart cherries.", reason: "Local preference." },
    { name: "Mackinac Fudge Bites", description: "Decadent chocolate fudge.", reason: "Classic Michigan staple." }
  ];

  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest 3 snacks for NinpoSnacks based on: ${history.join(', ')}. JSON array only.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ["name", "description", "reason"]
          }
        }
      }
    }));
    const data = safeJsonParse(response.text, fallback);
    cache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    return fallback;
  }
};

export const generateSnackImage = async (prompt: string) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `Commercial snack photo: ${prompt}.` }] },
    }));
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
  } catch (error) {}
  return null;
};

export const getAgentSupportResponse = async (query: string, userContext: any) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: `Ninja Support Agent for NinpoSnacks. User: ${JSON.stringify(userContext)}. MI policy: $25 max, 20% fee.`,
      }
    }));
    return response.text;
  } catch (error) {
    return "The Dojo is busy. Please try again in 60 seconds.";
  }
};

export const analyzeSalesTrends = async (salesData: any) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Quick sales insight: ${JSON.stringify(salesData)}`,
    }));
    return response.text;
  } catch (error) {
    return "Operations nominal.";
  }
};
