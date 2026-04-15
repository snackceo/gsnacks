const CURRENCY_SANITIZE_PATTERN = /[^0-9.,-]/g;

export const parseReceiptCurrency = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.replace(CURRENCY_SANITIZE_PATTERN, '');
  if (!cleaned) {
    return null;
  }

  if (cleaned.includes(',')) {
    const normalizedComma = cleaned.replace(/\./g, '').replace(',', '.');
    const parsedComma = Number(normalizedComma);
    if (Number.isFinite(parsedComma)) {
      return parsedComma;
    }
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  // Common OCR issue: cents parsed as integer string without decimal point.
  if (/^\d{3}$/.test(cleaned) && parsed >= 200) {
    return parsed / 100;
  }

  return parsed;
};

const parseReceiptQuantity = (value) => {
  if (value === null || value === undefined || value === '') {
    return 1;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
};

export const resolveReceiptUnitPrice = ({ unitPrice, totalPrice, quantity }) => {
  const directUnitPrice = parseReceiptCurrency(unitPrice);
  if (directUnitPrice && directUnitPrice > 0) {
    return directUnitPrice;
  }

  const normalizedQuantity = parseReceiptQuantity(quantity);
  if (!normalizedQuantity || normalizedQuantity <= 0) {
    return null;
  }

  const parsedTotalPrice = parseReceiptCurrency(totalPrice);
  if (!parsedTotalPrice || parsedTotalPrice <= 0) {
    return null;
  }

  return parsedTotalPrice / normalizedQuantity;
};

export const buildNormalizedReceiptPriceInput = (item = {}) => ({
  quantity: parseReceiptQuantity(item.quantity),
  unitPrice: resolveReceiptUnitPrice(item),
  totalPrice: parseReceiptCurrency(item.totalPrice),
  lineTotal: parseReceiptCurrency(item.lineTotal)
});

export const buildPriceObservationPayload = ({
  item,
  storeId,
  receiptCaptureId,
  productId,
  unmappedProductId,
  observedAt,
}) => {
  const normalizedInput = buildNormalizedReceiptPriceInput(item || {});
  const quantity = normalizedInput.quantity;
  const price = normalizedInput.unitPrice;

  if (!price || price <= 0) {
    return { ok: false, reason: 'invalid_price' };
  }

  if (!quantity || quantity <= 0) {
    return { ok: false, reason: 'invalid_quantity' };
  }

  if (!productId && !unmappedProductId) {
    return { ok: false, reason: 'missing_mapping' };
  }

  const hasMappedProduct = Boolean(productId);
  const matchMethod = item?.matchMethod || (hasMappedProduct ? 'manual_confirm' : 'unmapped');
  const workflowType = item?.workflowType || (hasMappedProduct ? 'update_price' : 'unmapped');

  return {
    ok: true,
    payload: {
      storeId,
      receiptCaptureId,
      productId,
      unmappedProductId,
      observedAt,
      price,
      cost: price,
      quantity,
      totalPrice: normalizedInput.totalPrice || price * quantity,
      receiptName: item?.receiptName,
      matchMethod,
      matchConfidence: item?.matchConfidence,
      promoDetected: item?.promoDetected || false,
      isAutoObserved: true,
      workflowType,
    },
  };
};
