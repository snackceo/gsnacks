
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const getApiKey = () => {
  return (import.meta as any).env?.VITE_API_KEY || "";
};

const getBackendUrl = () => {
  return (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5000';
};

const fetchWithTimeout = async (url: string, options: any, timeout = 15000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

export const analyzeBottleScan = async (base64Data: string) => {
  const apiKey = getApiKey();
  
  // Try Backend Proxy First for Security
  try {
    const response = await fetchWithTimeout(`${getBackendUrl()}/api/ai/analyze-bottle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Data })
    });
    if (response.ok) return await response.json();
  } catch (err) {
    console.warn("Backend AI Proxy unresponsive. Falling back to local key if available.");
  }
  
  // Local Key Fallback
  if (!apiKey) return { valid: false, material: "OFFLINE", message: "Intelligence Node Unreachable." };

  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
          { text: "Verify Michigan 10c deposit eligibility. Return JSON: {valid: boolean, material: string, message: string}." }
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
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    return { valid: false, material: "ERROR", message: "Verification protocol failure." };
  }
};

export const getAdvancedInventoryInsights = async (inventory: any[], orders: any[]) => {
  const apiKey = getApiKey();
  if (!apiKey) return "Strategic engine offline: No Auth Key found.";
  
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Perform Logistics Audit:
      Inventory: ${JSON.stringify(inventory)}
      Orders: ${JSON.stringify(orders)}`,
      config: {
        thinkingConfig: { thinkingBudget: 15000 } 
      }
    });
    return response.text;
  } catch (error) {
    return "Audit transmission interrupted.";
  }
};
export const getInventoryInsights = getAdvancedInventoryInsights;
