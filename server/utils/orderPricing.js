/**
 * Order Pricing Layer (UPGRADED - SAFE)
 * Works with your existing system
 * Adds guaranteed profit protection
 */

const CONFIG = {
  MIN_PROFIT_PER_ORDER: 5,

  BASE_ROUTE_FEE: 3.5,
  PER_ITEM_FEE: 0.4,

  INCLUDED_MILES: 3,
  PER_MILE: 1.25,

  LARGE_ORDER_THRESHOLD: 15,
  LARGE_ORDER_FEE: 3,

  HEAVY_ITEM_FEE: 2,
  HEAVY_KEYWORDS: ['pack', '12pk', '24pk', 'case', '2l', 'liter'],

  // 🆕 NEW SAFETY LAYERS
  MISSING_ITEM_BUFFER_PER_ITEM: 0.5,
  RISK_BUFFER_PERCENT: 0.1 // 10%
};

function isHeavy(product) {
  const name = String(product?.name || '').toLowerCase();
  return CONFIG.HEAVY_KEYWORDS.some(k => name.includes(k));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function calculateOrderFees({
  items = [],
  products = [],
  distanceMiles = 0
}) {
  let itemCount = 0;
  let hasHeavy = false;
  let estimatedSubtotal = 0;

  for (const item of items) {
    const product = products.find(
      p =>
        p.id === item.productId ||
        p._id === item.productId ||
        p.frontendId === item.productId
    );

    const qty = Number(item.quantity || 0);
    if (!product || qty <= 0) continue;

    itemCount += qty;

    const price = Number(product.price || product.retail || 0);
    if (price > 0) {
      estimatedSubtotal += price * qty;
    }

    if (isHeavy(product)) hasHeavy = true;
  }

  const baseFee = CONFIG.BASE_ROUTE_FEE;
  const itemFee = itemCount * CONFIG.PER_ITEM_FEE;

  const distanceFee =
    distanceMiles > CONFIG.INCLUDED_MILES
      ? (distanceMiles - CONFIG.INCLUDED_MILES) * CONFIG.PER_MILE
      : 0;

  const largeOrderFee =
    itemCount > CONFIG.LARGE_ORDER_THRESHOLD
      ? CONFIG.LARGE_ORDER_FEE
      : 0;

  const heavyItemFee = hasHeavy ? CONFIG.HEAVY_ITEM_FEE : 0;

  // 🆕 Missing item protection
  const missingItemBuffer =
    itemCount * CONFIG.MISSING_ITEM_BUFFER_PER_ITEM;

  // 🆕 Risk buffer based on order size
  const riskBuffer =
    estimatedSubtotal * CONFIG.RISK_BUFFER_PERCENT;

  let totalFees =
    baseFee +
    itemFee +
    distanceFee +
    largeOrderFee +
    heavyItemFee +
    missingItemBuffer +
    riskBuffer;

  // 🔒 HARD PROFIT FLOOR
  if (totalFees < CONFIG.MIN_PROFIT_PER_ORDER) {
    totalFees = CONFIG.MIN_PROFIT_PER_ORDER;
  }

  return {
    routeFee: round(baseFee),
    routeFeeFinal: round(baseFee),

    distanceMiles: round(distanceMiles),
    distanceFee: round(distanceFee),
    distanceFeeFinal: round(distanceFee),

    largeOrderFee: round(largeOrderFee),
    heavyItemFee: round(heavyItemFee),

    itemFee: round(itemFee),

    // 🆕 NEW FIELDS (safe to add)
    missingItemBuffer: round(missingItemBuffer),
    riskBuffer: round(riskBuffer),

    totalFees: round(totalFees),
    itemCount
  };
}