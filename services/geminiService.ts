
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeBottleScan = async (base64Data: string) => {
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
          required: ["valid", "material", "message"]
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    return { valid: false, material: "UNKNOWN", message: "Verification failed." };
  }
};

export const getAdvancedInventoryInsights = async (inventory: any[], orders: any[]) => {
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Perform a deep audit of this snack inventory and recent order history. 
      Inventory: ${JSON.stringify(inventory)}
      Orders: ${JSON.stringify(orders)}
      Suggest 3 strategic actions to maximize profit and minimize stockouts.`,
      config: {
        thinkingConfig: { thinkingBudget: 4000 }
      }
    });
    return response.text;
  } catch (error) {
    return "Intelligence engine temporarily unavailable.";
  }
};
