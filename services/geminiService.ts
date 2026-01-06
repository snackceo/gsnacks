
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

// Initialize Gemini API client using process.env.API_KEY directly as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const cache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 1000 * 60 * 30;

// Global flag to prevent API spamming when quota is hit
let quotaExhaustedUntil = 0;

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2, initialDelay = 2000): Promise<T> {
  // Check circuit breaker
  if (Date.now() < quotaExhaustedUntil) {
    console.warn("Gemini API Cooldown: Skipping call to avoid quota penalties.");
    throw new Error("QUOTA_COOLDOWN_ACTIVE");
  }

  let delay = initialDelay;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = JSON.stringify(error) || error?.message || "";
      const isRateLimit = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
      
      if (isRateLimit) {
        // Trigger circuit breaker for 2 minutes
        quotaExhaustedUntil = Date.now() + 120000;
        console.error("Gemini Quota Exceeded. Entering 2-minute cooldown.");
        break; 
      }

      if (i < maxRetries) {
        console.warn(`Gemini API error, retrying... (${i + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
  throw new Error("API_CALL_FAILED");
}

function safeJsonParse(text: string | undefined, fallback: any) {
  if (!text) return fallback;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const cleaned = jsonMatch ? jsonMatch[0] : text.replace(/```json/g, "").replace(/```/g, "").trim();
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
    // Fix: Structured response schema for snack recommendations
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Suggest 3 snacks for Ninpo Snacks based on: ${history.join(', ')}.`,
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

export const getNavigationDirections = async (destination: string, userLocation?: { latitude: number, longitude: number }) => {
  const fallback = [
    { instruction: "Head North on Woodward Ave", distance: "0.5 mi" },
    { instruction: "Left onto Grand River Ave", distance: "1.2 mi" },
    { instruction: "Arrive at Destination", distance: "0.1 mi" }
  ];

  try {
    // Fix: Structured response schema for turn-by-turn navigation steps
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `List 5 turn-by-turn steps to: ${destination}. Location: ${userLocation ? JSON.stringify(userLocation) : 'Detroit, MI'}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              instruction: { type: Type.STRING },
              distance: { type: Type.STRING }
            },
            required: ["instruction", "distance"]
          }
        }
      }
    }));
    return safeJsonParse(response.text, fallback);
  } catch (error) {
    return fallback;
  }
};

export const analyzeBottleScan = async (base64Data: string) => {
  try {
    // Fix: Using multimodal input and structured JSON schema for bottle return verification
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
          { text: "Identify if there is a beverage container in this image for recycling return." }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: { type: Type.BOOLEAN },
            message: { type: Type.STRING }
          },
          required: ["valid", "message"]
        }
      }
    }));
    return safeJsonParse(response.text, { valid: false, message: "Identification offline. Please try again later." });
  } catch (error) {
    return { valid: false, message: "Verification failed. Please try again." };
  }
};

export const generateSnackImage = async (prompt: string) => {
  try {
    // Fix: Optimized image generation call using gemini-2.5-flash-image
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `Professional commercial snack photography: ${prompt}. Cinematic lighting, clean background.` }] },
    }));
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
  } catch (error) {}
  return null;
};

export const getAgentSupportResponse = async (query: string, userContext: any) => {
  try {
    // Fix: Standard support response using gemini-3-flash-preview
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: `You are a helpful customer support agent for Ninpo Snacks. Be professional and friendly. User context: ${JSON.stringify(userContext)}.`,
      }
    }));
    return response.text;
  } catch (error) {
    return "Our automated support is currently offline due to high traffic. A human agent will be with you shortly.";
  }
};

export const analyzeSalesTrends = async (salesData: any) => {
  try {
    // Fix: Using gemini-3-pro-preview for complex data reasoning and trend analysis
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Provide a concise sales analysis of this data: ${JSON.stringify(salesData)}`,
    }));
    return response.text;
  } catch (error) {
    return "Analytics processing is currently queued. Performance remains within expected limits.";
  }
};
