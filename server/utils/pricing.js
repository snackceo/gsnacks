const DEFAULT_RETAIL_MULTIPLIER = 1.2;
const DEFAULT_MIN_RETAIL = 0.99;
const DEFAULT_MAX_RETAIL = 999.99;

const roundToCents = value => Math.round(value * 100) / 100;

export const normalizeQuantity = (quantity, fallback = 1) => {
  const numericQuantity = Number(quantity);
  if (Number.isFinite(numericQuantity) && numericQuantity > 0) {
    return numericQuantity;
  }

  const numericFallback = Number(fallback);
  if (Number.isFinite(numericFallback) && numericFallback > 0) {
    return numericFallback;
  }

  return 1;
};

export const calculatePerUnitCost = ({ unitPrice, totalPrice, quantity } = {}) => {
  const parsedUnitPrice = Number(unitPrice);
  if (Number.isFinite(parsedUnitPrice) && parsedUnitPrice > 0) {
    return parsedUnitPrice;
  }

  const parsedTotalPrice = Number(totalPrice);
  const parsedQuantity = normalizeQuantity(quantity);
  if (Number.isFinite(parsedTotalPrice) && parsedTotalPrice > 0 && parsedQuantity > 0) {
    return parsedTotalPrice / parsedQuantity;
  }

  return null;
};

const roundUpTo99 = value => {
  if (!Number.isFinite(value) || value <= 0) return null;

  const whole = Math.ceil(value);
  const rounded = whole - 0.01;

  if (rounded >= value) {
    return roundToCents(rounded);
  }

  return roundToCents((whole + 1) - 0.01);
};

export const calculateRetail = (
  cost,
  {
    multiplier = DEFAULT_RETAIL_MULTIPLIER,
    minRetail = DEFAULT_MIN_RETAIL,
    maxRetail = DEFAULT_MAX_RETAIL
  } = {}
) => {
  const numericCost = Number(cost);
  if (!Number.isFinite(numericCost) || numericCost <= 0) {
    return null;
  }

  const safeMultiplier = Number(multiplier);
  const safeMinRetail = Number(minRetail);
  const safeMaxRetail = Number(maxRetail);

  const effectiveMultiplier = Number.isFinite(safeMultiplier) && safeMultiplier > 0
    ? safeMultiplier
    : DEFAULT_RETAIL_MULTIPLIER;
  const effectiveMin = Number.isFinite(safeMinRetail) && safeMinRetail > 0
    ? safeMinRetail
    : DEFAULT_MIN_RETAIL;
  const effectiveMax = Number.isFinite(safeMaxRetail) && safeMaxRetail > 0
    ? safeMaxRetail
    : DEFAULT_MAX_RETAIL;

  const boundedMax = Math.max(effectiveMax, effectiveMin);
  const boundedMin = Math.min(effectiveMin, boundedMax);

  const candidate = numericCost * effectiveMultiplier;
  const rounded = roundUpTo99(candidate);

  if (!Number.isFinite(rounded)) {
    return null;
  }

  return Math.min(Math.max(rounded, boundedMin), boundedMax);
};

export const pricingDefaults = {
  DEFAULT_RETAIL_MULTIPLIER,
  DEFAULT_MIN_RETAIL,
  DEFAULT_MAX_RETAIL
};
