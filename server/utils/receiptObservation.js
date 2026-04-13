import { calculatePerUnitCost, normalizeQuantity } from './pricing.js';

const DEFAULT_MAPPED_METADATA = {
  matchMethod: 'manual_confirm',
  workflowType: 'update_price'
};

const DEFAULT_UNMAPPED_METADATA = {
  matchMethod: 'unmapped',
  workflowType: 'unmapped'
};

const sanitizeNumericCandidate = raw => {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/\(([^)]+)\)/g, '-$1')
    .replace(/(?<=\d)[oO]/g, '0')
    .replace(/[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI]/g, '1')
    .replace(/[lI](?=\d)/g, '1')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
};

const extractLikelyPriceToken = raw => {
  const rawValue = String(raw || '').trim();
  if (!rawValue) return null;

  const slashParts = rawValue.split('/').map(part => part.trim()).filter(Boolean);
  if (slashParts.length > 1) {
    const slashCandidate = slashParts[slashParts.length - 1];
    if (/\d/.test(slashCandidate)) return slashCandidate;
  }

  const multiBuyMatch = rawValue.match(/\d+\s*[xX]\s*([$]?[\d.,]+)/);
  if (multiBuyMatch?.[1]) {
    return multiBuyMatch[1];
  }

  return rawValue;
};

const normalizeDecimalString = cleaned => {
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    if (decimalSeparator === '.') {
      return cleaned.replace(/,/g, '');
    }
    return cleaned.replace(/\./g, '').replace(',', '.');
  }

  if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    const parts = cleaned.split(',');
    const decimalLike = commaCount === 1 && parts[1]?.length > 0 && parts[1].length <= 2;
    return decimalLike ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }

  if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      const parts = cleaned.split('.');
      const decimalPart = parts.pop();
      return `${parts.join('')}.${decimalPart}`;
    }
  }

  return cleaned;
};

const maybeApplyCentHeuristic = (cleaned, parsed, allowCentHeuristic) => {
  if (!allowCentHeuristic) return parsed;
  if (!/^\d+$/.test(cleaned)) return parsed;
  if (cleaned.length < 3 || cleaned.length > 4) return parsed;
  if (parsed % 100 === 0) return parsed;

  const normalized = Number((parsed / 100).toFixed(2));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : parsed;
};

export const parseReceiptCurrency = (value, { allowCentHeuristic = true } = {}) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const cleaned = sanitizeNumericCandidate(extractLikelyPriceToken(value));
  if (!cleaned) return null;

  const normalizedDecimal = normalizeDecimalString(cleaned);
  const parsed = Number(normalizedDecimal);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return maybeApplyCentHeuristic(cleaned, parsed, allowCentHeuristic);
};

export const resolveReceiptUnitPrice = item => {
  const parsedUnit = parseReceiptCurrency(item?.unitPrice);
  const parsedTotal = parseReceiptCurrency(item?.totalPrice);
  const parsedQuantity = parseReceiptCurrency(item?.quantity, { allowCentHeuristic: false });

  return calculatePerUnitCost({
    unitPrice: parsedUnit,
    totalPrice: parsedTotal,
    quantity: parsedQuantity
  });
};

export const buildNormalizedReceiptPriceInput = item => {
  const parsedUnitPrice = parseReceiptCurrency(item?.unitPrice);
  const parsedTotalPrice = parseReceiptCurrency(item?.totalPrice);
  const parsedQuantity = parseReceiptCurrency(item?.quantity, { allowCentHeuristic: false });
  const resolvedUnitPrice = resolveReceiptUnitPrice(item);

  return {
    raw: {
      unitPrice: item?.unitPrice ?? null,
      totalPrice: item?.totalPrice ?? null,
      quantity: item?.quantity ?? null
    },
    normalized: {
      unitPrice: parsedUnitPrice,
      totalPrice: parsedTotalPrice,
      quantity: parsedQuantity,
      resolvedUnitPrice
    }
  };
};

export const buildPriceObservationPayload = ({
  item,
  storeId,
  receiptCaptureId,
  productId,
  unmappedProductId,
  observedAt = new Date(),
  source = 'receipt'
}) => {
  const unitPrice = resolveReceiptUnitPrice(item);
  if (!unitPrice) {
    return { ok: false, reason: 'invalid_price' };
  }

  const rawQuantity = item?.quantity;
  const parsedQuantity = parseReceiptCurrency(rawQuantity, { allowCentHeuristic: false });
  if (rawQuantity !== null && rawQuantity !== undefined && parsedQuantity === null) {
    return { ok: false, reason: 'invalid_quantity' };
  }

  const quantity = normalizeQuantity(parsedQuantity ?? rawQuantity ?? 1);
  if (!productId && !unmappedProductId) {
    return { ok: false, reason: 'missing_mapping' };
  }

  const metadataDefaults = productId ? DEFAULT_MAPPED_METADATA : DEFAULT_UNMAPPED_METADATA;
  const matchMethod = item?.matchMethod || metadataDefaults.matchMethod;
  const workflowType = item?.workflowType || metadataDefaults.workflowType;

  return {
    ok: true,
    payload: {
      ...(productId ? { productId } : {}),
      ...(unmappedProductId ? { unmappedProductId } : {}),
      storeId,
      price: unitPrice,
      cost: unitPrice,
      quantity,
      source,
      observedAt,
      receiptCaptureId,
      lineIndex: item?.lineIndex,
      matchMethod,
      workflowType
    }
  };
};
