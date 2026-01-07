
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

export const analyzeBottleScan = async (base64Data: string) => {
  // Use process.env.API_KEY as injected by the environment
  const apiKey = process.env.API_KEY;
  if (!apiKey) return { valid: false, material: "ERROR", message: "API Key missing." };
  
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
          { text: `Identify if this is a beverage container eligible for a Michigan 10c deposit. 
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
          propertyOrdering: ["valid", "material", "message"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    return { valid: false, material: "UNKNOWN", message: "Verification failed." };
  }
};

export const getAdvancedInventoryInsights = async (inventory: any[], orders: any[]) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return "Intelligence engine unavailable: Missing Key.";
  
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Perform a deep audit of this snack inventory and recent order history. 
      Inventory: ${JSON.stringify(inventory)}
      Orders: ${JSON.stringify(orders)}
      Identify logistics bottlenecks, popular snack trends in the data, and suggest 3 strategic actions to maximize profit.`,
      config: {
        thinkingConfig: { thinkingBudget: 32768 } // Use max budget for pro model
      }
    });
    return response.text;
  } catch (error) {
    return "Intelligence engine temporarily unavailable.";
  }
};
