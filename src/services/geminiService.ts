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
const DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i;

const normalizeBase64 = (input: string) => {
  if (!input || typeof input !== 'string') return '';
  const normalizedInput = input.replace(/\s+/g, '');
  if (!normalizedInput) return '';

  const dataUrlMatch = normalizedInput.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    return dataUrlMatch[2] ?? '';
  }

  return normalizedInput;
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

export const getAuditLogSummary = async (
  auditLogs: any[],
  model?: string
): Promise<string> => {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetchWithTimeout(
      `${backendUrl}/api/ai/audit-summary`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ auditLogs, model })
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
      return detail || 'Audit log summary unavailable.';
    }

    const data = await response.json();
    if (typeof data?.summary === 'string' && data.summary.trim()) return data.summary;
    if (typeof data?.text === 'string' && data.text.trim()) return data.text;

    return 'Audit log summary unavailable.';
  } catch {
    return 'Audit log summary unavailable.';
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
