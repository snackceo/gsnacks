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
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;
const DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

const normalizeBase64 = (input: string) => {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  const dataUrlMatch = trimmed.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    const base64Payload = dataUrlMatch[2].replace(/\s+/g, '');
    if (!BASE64_PATTERN.test(base64Payload)) {
      console.warn('Rejected base64 payload length:', base64Payload.length);
      return '';
    }
    return base64Payload;
  }

  const normalized = trimmed.replace(/\s+/g, '');
  if (!BASE64_PATTERN.test(normalized)) {
    console.warn('Rejected base64 payload length:', normalized.length);
    return '';
  }
  return normalized;
};

export type BottleScanResult = {
  valid: boolean;
  material: string;
  message: string;
};

export type ProductScanResult = {
  name: string;
  brand?: string;
  productType?: string;
  category?: string;
  sizeOz: number;
  sizeUnit?: string;
  quantity: number;
  nutritionNote?: string;
  storageZone?: string;
  storageBin?: string;
  image?: string;
  containerType?: string;
  isEligible: boolean;
  message?: string;
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

export const analyzeProductScan = async (
  base64Data: string,
  upc: string,
  mimeType?: string
): Promise<ProductScanResult> => {
  const backendUrl = getBackendUrl();
  const normalized = normalizeBase64(base64Data);

  if (!normalized) {
    return {
      name: '',
      sizeOz: 0,
      quantity: 0,
      isEligible: false,
      brand: '',
      productType: '',
      category: '',
      sizeUnit: '',
      nutritionNote: '',
      storageZone: '',
      storageBin: '',
      image: '',
      containerType: '',
      message: 'No image data provided.'
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/product-scan`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image: normalized, mimeType, upc })
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
      return {
        name: '',
        sizeOz: 0,
        quantity: 0,
        isEligible: false,
        brand: '',
        productType: '',
        category: '',
        sizeUnit: '',
        nutritionNote: '',
        storageZone: '',
        storageBin: '',
        image: '',
        containerType: '',
        message: detail || 'Product scan unavailable.'
      };
    }

    const data = await response.json();
    return {
      name: String(data?.name || ''),
      sizeOz: Number(data?.sizeOz || 0),
      quantity: Number(data?.quantity || 0),
      isEligible: Boolean(data?.isEligible),
      brand: typeof data?.brand === 'string' ? data.brand : '',
      productType: typeof data?.productType === 'string' ? data.productType : '',
      category: typeof data?.category === 'string' ? data.category : '',
      sizeUnit: typeof data?.sizeUnit === 'string' ? data.sizeUnit : '',
      nutritionNote: typeof data?.nutritionNote === 'string' ? data.nutritionNote : '',
      storageZone: typeof data?.storageZone === 'string' ? data.storageZone : '',
      storageBin: typeof data?.storageBin === 'string' ? data.storageBin : '',
      image: typeof data?.image === 'string' ? data.image : '',
      containerType: typeof data?.containerType === 'string' ? data.containerType : '',
      message: typeof data?.message === 'string' ? data.message : undefined
    };
  } catch {
    return {
      name: '',
      sizeOz: 0,
      quantity: 0,
      isEligible: false,
      brand: '',
      productType: '',
      category: '',
      sizeUnit: '',
      nutritionNote: '',
      storageZone: '',
      storageBin: '',
      image: '',
      containerType: '',
      message: 'Product scan unavailable.'
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

export const getOperationsSummary = async (
  orders: any[],
  rangeLabel?: string,
  model?: string
): Promise<string> => {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/ops-summary`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orders, rangeLabel, model })
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
      return detail || 'Operations summary unavailable.';
    }

    const data = await response.json();
    if (typeof data?.summary === 'string' && data.summary.trim()) return data.summary;
    if (typeof data?.text === 'string' && data.text.trim()) return data.text;

    return 'Operations summary unavailable.';
  } catch {
    return 'Operations summary unavailable.';
  }
};

export const explainDriverIssue = async (
  order: any,
  errorMessage: string,
  auditLogs?: any[],
  model?: string
): Promise<string> => {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/issue-explain`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order, errorMessage, auditLogs, model })
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
      return detail || 'Issue explanation unavailable.';
    }

    const data = await response.json();
    if (typeof data?.explanation === 'string' && data.explanation.trim()) {
      return data.explanation;
    }
    if (typeof data?.text === 'string' && data.text.trim()) return data.text;

    return 'Issue explanation unavailable.';
  } catch {
    return 'Issue explanation unavailable.';
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
