
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Simple in-memory cache to prevent redundant billing and hitting rate limits
const cache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes cache for static-ish data

// Quota tracking to prevent "hammering" a 429'd endpoint
let quotaExhaustedUntil = 0;

/**
 * Robust call wrapper with exponential backoff and cooldown tracking
 */
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2, initialDelay = 3000): Promise<T> {
  if (Date.now() < quotaExhaustedUntil) {
    throw new Error("API Cooldown active due to 429.");
  }

  let delay = initialDelay;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error?.message || "";
      const isRateLimit = errorMsg.includes('429') || error?.status === 429 || error?.code === 429;
      
      if (isRateLimit) {
        if (i < maxRetries) {
          console.warn(`Gemini API rate limited. Attempt ${i + 1}/${maxRetries}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        } else {
          quotaExhaustedUntil = Date.now() + 60000; // 1 minute hard cooldown after final failure
        }
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Defensive JSON parsing to prevent app crashes from malformed AI output
 */
function safeJsonParse(text: string, fallback: any) {
  try {
    // Clean potential markdown code blocks from response
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse AI JSON:", e);
    return fallback;
  }
}

export const getSmartSnackRecommendations = async (history: string[]) => {
  const cacheKey = `recs_${history.join('_')}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  const fallback = [
    { name: "Detroit Style Pretzel Rods", description: "Savory garlic-butter rods.", reason: "Regional favorite." },
    { name: "MI Cherry Fruit Leathers", description: "Traverse City tart cherries.", reason: "High seasonality demand." },
    { name: "Mackinac Fudge Bites", description: "Decadent chocolate fudge.", reason: "Classic Michigan staple." }
  ];

  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest 3 unique snacks for a Michigan delivery service based on history: ${history.join(', ')}. Return pure JSON array.`,
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
    const data = safeJsonParse(response.text || '[]', fallback);
    cache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    return fallback; 
  }
};

export const generateSnackImage = async (prompt: string) => {
  const cacheKey = `img_${prompt}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `A professional product photo of ${prompt}, clean background, commercial lighting.` }],
      },
      config: { imageConfig: { aspectRatio: "1:1" } },
    }));
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const data = `data:image/png;base64,${part.inlineData.data}`;
        cache[cacheKey] = { data, timestamp: Date.now() };
        return data;
      }
    }
  } catch (error) {
    return null;
  }
  return null;
};

export const getAgentSupportResponse = async (query: string, userContext: any) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: `You are the Support Agent for Ninpo Snacks. User: ${JSON.stringify(userContext)}. Rules: MI returns $25 max/day, 20% fee. Be concise and ninja-themed but professional.`,
      }
    }));
    return response.text;
  } catch (error) {
    return "Our system is busy handling deliveries. Please try again shortly. Standard MI policy: $25 daily limit on returns with a 20% processing fee.";
  }
};

export const analyzeSalesTrends = async (salesData: any) => {
  const cacheKey = `analysis_${salesData.length}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze these orders and give a 1-sentence business insight: ${JSON.stringify(salesData)}`,
    }));
    const data = response.text || "Operations normal. Growth trends consistent.";
    cache[cacheKey] = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    return "Operations stable. Monitor evening delivery peaks for optimization.";
  }
};
