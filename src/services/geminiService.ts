// src/services/geminiService.ts
// Option A: Production-correct. NO frontend Gemini key.
// This file ONLY calls your backend proxy endpoints.

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

/**
 * Backend should receive RAW base64 (no data URL prefix).
 * If input is "data:image/jpeg;base64,....", strip the prefix.
 */
const normalizeBase64 = (input: string) => {
  if (!input) return '';
  const s = String(input);

  if (s.startsWith('data:') && s.includes(',')) {
    return s.split(',')[1] || '';
  }

  return s;
};

export type BottleScanResult = {
  valid: boolean;
  material: string;
  message: string;
};

export const analyzeBottleScan = async (base64Data: string): Promise<BottleScanResult> => {
  const backendUrl = getBackendUrl();
  const normalized = normalizeBase64(base64Data);

  if (!normalized) {
    return {
      valid: false,
      material: 'ERROR',
      message: 'No image data provided.'
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/analyze-bottle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image: normalized })
      },
      15000
    );

    if (!response.ok) {
      // Try to surface server error text if present, but keep UI stable
      let detail = '';
      try {
        const data = await response.json();
        detail = data?.error || data?.message || '';
      } catch {
        // ignore
      }

      return {
        valid: false,
        material: 'OFFLINE',
        message: detail || 'Intelligence Node Unreachable.'
      };
    }

    const data = await response.json();

    // Defensive normalization (backend should already return this shape)
    return {
      valid: !!data?.valid,
      material: String(data?.material || 'UNKNOWN'),
      message: String(data?.message || 'Analysis complete.')
    };
  } catch {
    return {
      valid: false,
      material: 'OFFLINE',
      message: 'Intelligence Node Unreachable.'
    };
  }
};

export const getAdvancedInventoryInsights = async (
  inventory: any[],
  orders: any[],
  model?: string
): Promise<string> => {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/inventory-audit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ inventory, orders, model })
      },
      20000
    );

    if (!response.ok) {
      let detail = '';
      try {
        const data = await response.json();
        detail = data?.error || data?.message || '';
      } catch {
        // ignore
      }
      return detail || 'Strategic engine offline: Intelligence Node Unreachable.';
    }

    const data = await response.json();

    // Allow either { insights: string } or { text: string } from backend
    if (typeof data?.insights === 'string' && data.insights.trim()) return data.insights;
    if (typeof data?.text === 'string' && data.text.trim()) return data.text;

    return 'Audit transmission interrupted.';
  } catch {
    return 'Strategic engine offline: Intelligence Node Unreachable.';
  }
};

export type AuditModelResponse = {
  models: string[];
  defaultModel?: string;
};

export const getAvailableAuditModels = async (): Promise<AuditModelResponse> => {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/models`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      },
      10000
    );

    if (!response.ok) {
      return { models: [] };
    }

    const data = await response.json();
    return {
      models: Array.isArray(data?.models) ? data.models.filter(Boolean) : [],
      defaultModel: typeof data?.defaultModel === 'string' ? data.defaultModel : undefined
    };
  } catch {
    return { models: [] };
  }
};

// Preserve existing import name used elsewhere
export const getInventoryInsights = getAdvancedInventoryInsights;
