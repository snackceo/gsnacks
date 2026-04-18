import AppSettings from '../models/AppSettings.js';
import { getTierBenefits, normalizeTier } from '../services/tierService.js';

/**
 * DEFAULT CONFIGS
 */
const DEFAULT_DISTANCE_FEES = {
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0
};

/**
 * HELPERS
 */
const toNumber = (val, fallback = 0) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const roundDownToTenth = (value) => Math.floor(value * 10) / 10;

/**
 * ROUTE FEE (BASE DELIVERY FEE)
 */
export const applyTierDiscount = ({
  baseRouteFee,
  pickupOnlyMultiplier,
  orderType,
  tier,
  platinumFreeDelivery,
  allowPlatinumTier,
  allowGreenTier
}) => {
  let fee = Math.max(0, toNumber(baseRouteFee));
  const normalizedTier = normalizeTier(tier);
  const tierBenefits = getTierBenefits({
    tier: normalizedTier,
    settings: { allowPlatinumTier, allowGreenTier, platinumFreeDelivery }
  });

  // pickup adjustment
  if (orderType === 'RETURNS_PICKUP') {
    fee *= Math.max(0, toNumber(pickupOnlyMultiplier, 1));
  }

  const originalFee = fee;
  let discountPercent = 0;

  // standard tier discounts
  const tierDiscount = toNumber(tierBenefits.routeDiscount, 0);
  if (tierDiscount > 0) {
    fee *= (1 - tierDiscount);
    discountPercent = tierDiscount;
  }

  if (tierBenefits.routeFeeOverride !== undefined && tierBenefits.routeFeeOverride !== null) {
    fee = Math.max(0, toNumber(tierBenefits.routeFeeOverride));
    discountPercent = originalFee > 0 ? 1 - (fee / originalFee) : 0;
  }

  const feeCents = Math.round(fee * 100);

  return {
    routeFee: feeCents / 100,
    routeFeeCents: feeCents,
    routeFeeDiscountPercent: discountPercent
  };
};

/**
 * DISTANCE FEE
 */
const calculateDistanceFee = ({
  distanceMiles,
  config,
  orderType,
  pickupOnlyMultiplier,
  tier,
  allowGreenTier,
  allowPlatinumTier,
  platinumFreeDelivery
}) => {
  const normalizedTier = normalizeTier(tier);
  const tierBenefits = getTierBenefits({
    tier: normalizedTier,
    // Pass all settings for consistency, though only green has distance override
    settings: { allowGreenTier, allowPlatinumTier, platinumFreeDelivery }
  });
  const distance = roundDownToTenth(Math.max(0, toNumber(distanceMiles)));

  if (tierBenefits.distanceFeeOverride !== undefined && tierBenefits.distanceFeeOverride !== null) {
    const distanceFeeCents = Math.round(Math.max(0, toNumber(tierBenefits.distanceFeeOverride)) * 100);
    return { distanceFee: distanceFeeCents / 100, distanceFeeCents, distanceMiles: distance };
  }

  const included = toNumber(config.distanceIncludedMiles);
  const band1Max = Math.max(included, toNumber(config.distanceBand1MaxMiles));
  const band2Max = Math.max(band1Max, toNumber(config.distanceBand2MaxMiles));

  const band1Rate = toNumber(config.distanceBand1Rate);
  const band2Rate = toNumber(config.distanceBand2Rate);
  const band3Rate = toNumber(config.distanceBand3Rate);

  const band1Miles = Math.max(0, Math.min(distance, band1Max) - included);
  const band2Miles = Math.max(0, Math.min(distance, band2Max) - band1Max);
  const band3Miles = Math.max(0, distance - band2Max);

  let fee =
    (band1Miles * band1Rate) +
    (band2Miles * band2Rate) +
    (band3Miles * band3Rate);

  if (orderType === 'RETURNS_PICKUP') {
    fee *= Math.max(0, toNumber(pickupOnlyMultiplier, 1));
  }

  const feeCents = Math.round(fee * 100);

  return {
    distanceFee: feeCents / 100,
    distanceFeeCents: feeCents,
    distanceMiles: distance
  };
};

/**
 * LARGE ORDER FEE
 */
const calculateLargeOrderFee = ({ items, includedItems, perItemFee }) => {
  const totalItems = (items || []).reduce(
    (sum, it) => sum + Math.max(0, toNumber(it.quantity)),
    0
  );

  const extras = Math.max(0, totalItems - toNumber(includedItems));
  const fee = extras * toNumber(perItemFee);

  const feeCents = Math.round(fee * 100);

  return {
    largeOrderFee: feeCents / 100,
    largeOrderFeeCents: feeCents
  };
};

/**
 * HEAVY ITEM FEE
 */
const calculateHeavyItemFee = ({ items, productsByFrontendId, perUnitFee }) => {
  let heavyCount = 0;

  for (const it of items || []) {
    const product = productsByFrontendId?.get?.(String(it.productId));
    if (product?.isHeavy) {
      heavyCount += Math.max(0, toNumber(it.quantity));
    }
  }

  const fee = heavyCount * toNumber(perUnitFee);
  const feeCents = Math.round(fee * 100);

  return {
    heavyItemFee: feeCents / 100,
    heavyItemFeeCents: feeCents
  };
};

/**
 * MAIN ENTRY
 */
export const getDeliveryOptions = async ({
  orderType,
  tier,
  distanceMiles,
  items,
  productsByFrontendId
}) => {
  const doc = await AppSettings.findOne({ key: 'default' }).lean();

  const baseRouteFee = toNumber(doc?.routeFee, 4.99);
  const pickupOnlyMultiplier = toNumber(doc?.pickupOnlyMultiplier, 0.5);

  const platinumFreeDelivery = Boolean(doc?.platinumFreeDelivery);
  const allowPlatinumTier = Boolean(doc?.allowPlatinumTier);
  const allowGreenTier = Boolean(doc?.allowGreenTier);

  const distanceConfig = {
    distanceIncludedMiles: toNumber(doc?.distanceIncludedMiles, DEFAULT_DISTANCE_FEES.distanceIncludedMiles),
    distanceBand1MaxMiles: toNumber(doc?.distanceBand1MaxMiles, DEFAULT_DISTANCE_FEES.distanceBand1MaxMiles),
    distanceBand2MaxMiles: toNumber(doc?.distanceBand2MaxMiles, DEFAULT_DISTANCE_FEES.distanceBand2MaxMiles),
    distanceBand1Rate: toNumber(doc?.distanceBand1Rate, DEFAULT_DISTANCE_FEES.distanceBand1Rate),
    distanceBand2Rate: toNumber(doc?.distanceBand2Rate, DEFAULT_DISTANCE_FEES.distanceBand2Rate),
    distanceBand3Rate: toNumber(doc?.distanceBand3Rate, DEFAULT_DISTANCE_FEES.distanceBand3Rate)
  };

  const handlingConfig = {
    largeOrderIncludedItems: toNumber(doc?.largeOrderIncludedItems, 10),
    largeOrderPerItemFee: toNumber(doc?.largeOrderPerItemFee, 0.3),
    heavyItemFeePerUnit: toNumber(doc?.heavyItemFeePerUnit, 1.5)
  };

  // FEES
  const route = applyTierDiscount({
    baseRouteFee,
    pickupOnlyMultiplier,
    orderType,
    tier,
    platinumFreeDelivery,
    allowPlatinumTier,
    allowGreenTier
  });

  const distance = calculateDistanceFee({
    distanceMiles,
    config: distanceConfig,
    orderType,
    pickupOnlyMultiplier,
    tier,
    allowGreenTier,
    allowPlatinumTier,
    platinumFreeDelivery
  });

  const large = calculateLargeOrderFee({
    items,
    includedItems: handlingConfig.largeOrderIncludedItems,
    perItemFee: handlingConfig.largeOrderPerItemFee
  });

  const heavy = calculateHeavyItemFee({
    items,
    productsByFrontendId: productsByFrontendId || new Map(),
    perUnitFee: handlingConfig.heavyItemFeePerUnit
  });

  return {
    // Pass benefits through for UI and other consumers
    tierBenefits: getTierBenefits({
      tier,
      settings: { allowPlatinumTier, allowGreenTier, platinumFreeDelivery }
    }),

    routeFee: route.routeFee,
    routeFeeCents: route.routeFeeCents,
    routeFeeDiscountPercent: route.routeFeeDiscountPercent,

    distanceFee: distance.distanceFee,
    distanceFeeCents: distance.distanceFeeCents,
    distanceMiles: distance.distanceMiles,

    largeOrderFee: large.largeOrderFee,
    largeOrderFeeCents: large.largeOrderFeeCents,

    heavyItemFee: heavy.heavyItemFee,
    heavyItemFeeCents: heavy.heavyItemFeeCents,

    // This was missing the total calculation.
    // I'm adding it here to ensure all fees are summed up correctly.
    totalDeliveryFee:
      route.routeFee +
      distance.distanceFee +
      large.largeOrderFee +
      heavy.heavyItemFee,
    totalDeliveryFeeCents:
      route.routeFeeCents +
      distance.distanceFeeCents +
      large.largeOrderFeeCents +
      heavy.heavyItemFeeCents
  };
};
