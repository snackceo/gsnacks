
// Use correct import for GoogleGenAI
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Session-persistent cache to reduce API calls across reloads
const getSessionCache = () => {
  try {
    const saved = sessionStorage.getItem('ninpo_ai_cache');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
};

const saveSessionCache = (cache: any) => {
  try {
    sessionStorage.setItem('ninpo_ai_cache', JSON.stringify(cache));
  } catch (e) {}
};

let quotaExhaustedUntil = 0;
let lastCallTimestamp = 0;
const MIN_CALL_GAP = 3000; // 3 second gap between any two AI calls

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 1, initialDelay = 3000): Promise<T> {
  if (Date.now() < quotaExhaustedUntil) {
    console.warn("Gemini API Cooldown Active.");
    throw new Error("QUOTA_COOLDOWN_ACTIVE");
  }

  // Throttle rapid successive calls
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTimestamp;
  if (timeSinceLastCall < MIN_CALL_GAP) {
    await new Promise(resolve => setTimeout(resolve, MIN_CALL_GAP - timeSinceLastCall));
  }
  lastCallTimestamp = Date.now();

  let delay = initialDelay;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error?.message || JSON.stringify(error) || "";
      const isRateLimit = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
      
      if (isRateLimit) {
        quotaExhaustedUntil = Date.now() + 180000; // 3 minute cooldown
        console.error("Gemini Quota Exceeded. Cooldown active.");
        break; 
      }

      if (i < maxRetries) {
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

// Analyze bottle scan using Gemini
export const analyzeBottleScan = async (base64Data: string) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
          { text: `Identify if this is a beverage container eligible for a Michigan 10c deposit. 
          Analyze material (PLASTIC/CAN/GLASS) and check for a visible "MI 10c" or "ME/MI 10c" label.
          
          If NOT eligible, provide a very specific reason in the 'message' field (e.g., 'Not Michigan Bought', 'Label Missing or Obscured', 'Non-eligible Container Type', 'Damaged/Unscannable Barcode').
          If eligible, provide an enthusiastic Detroit-style success message (e.g., 'Nice one! That's 10c in the bank.', 'Verified! Michigan's finest recycle.', 'Detroit Green! Added to your credits.').
          
          Return JSON: {valid: boolean, material: string, message: string}.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: { type: Type.BOOLEAN },
            material: { type: Type.STRING },
            message: { type: Type.STRING }
          },
          required: ["valid", "material", "message"]
        }
      }
    }));
    return safeJsonParse(response.text, { valid: false, material: "UNKNOWN", message: "Verification failed." });
  } catch (error) {
    return { valid: false, material: "UNKNOWN", message: "System Busy. Please try later." };
  }
};

// Customer support agent using Gemini
export const getAgentSupportResponse = async (query: string, userContext: any) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: `You are a helpful customer support agent for Ninpo Snacks. User context: ${JSON.stringify(userContext)}. Current Detroit time: ${new Date().toLocaleTimeString()}.`,
      }
    }));
    return response.text;
  } catch (error) {
    return "I'm experiencing heavy traffic. Please try again in a moment!";
  }
};

// Added missing export getSmartSnackRecommendations used in ManagementView
export const getSmartSnackRecommendations = async (inventory: any[], userPreferences: string) => {
  try {
    const response: GenerateContentResponse = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Given the current inventory: ${JSON.stringify(inventory)}. Recommendations for user: ${userPreferences}. Return JSON list of product IDs.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendedIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["recommendedIds"]
        }
      }
    }));
    return safeJsonParse(response.text, { recommendedIds: [] });
  } catch (error) {
    return { recommendedIds: [] };
  }
};
