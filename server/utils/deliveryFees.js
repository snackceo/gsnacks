import AppSettings from '../models/AppSettings.js';

const DEFAULT_DISTANCE_FEES = {
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0
};

const TIER_ROUTE_DISCOUNTS = {
  BRONZE: 0.1,
  SILVER: 0.2,
  GOLD: 0.3
};

const normalizeTier = tier => {
  const normalized = String(tier || '').trim().toUpperCase();
  if (['COMMON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'GREEN'].includes(normalized)) {
    return normalized;
  }
  return 'COMMON';
};

const roundDownToTenth = value => Math.floor(value * 10) / 10;

export const applyTierDiscount = ({
  baseRouteFee,
  pickupOnlyMultiplier,
  orderType,
  tier,
  platinumFreeDelivery,
  allowPlatinumTier,
  allowGreenTier
}) => {
  let fee = Math.max(0, Number(baseRouteFee || 0));
  const normalizedTier = normalizeTier(tier);
  let discountPercent = 0;

  if (orderType === 'RETURNS_PICKUP') {
    fee = fee * Math.max(0, Number(pickupOnlyMultiplier || 0));
  }

  const feeBeforeTierDiscount = fee;
  const tierDiscount = TIER_ROUTE_DISCOUNTS[normalizedTier] ?? 0;

  if (tierDiscount > 0) {
    discountPercent = tierDiscount;
    fee = fee * (1 - tierDiscount);
  }

  if (normalizedTier === 'GREEN' && allowGreenTier) {
    fee = 1;
    discountPercent = feeBeforeTierDiscount > 0 ? Math.max(0, Math.min(1, 1 - fee / feeBeforeTierDiscount)) : 0;
  }

  if (normalizedTier === 'PLATINUM' && allowPlatinumTier && platinumFreeDelivery) {
    fee = 0;
    discountPercent = feeBeforeTierDiscount > 0 ? 1 : 0;
  }

  const feeCents = Math.round(fee * 100);
  return {
    routeFee: feeCents / 100,
    routeFeeCents: feeCents,
    routeFeeDiscountPercent: discountPercent
  };
};

const calculateDistanceFeeInternal = ({
  distanceMiles,
  config,
  orderType,
  pickupOnlyMultiplier,
  tier,
  allowGreenTier
}) => {
  const normalizedTier = normalizeTier(tier);
  const rawDistance = Number(distanceMiles);
  const sanitizedDistance = Number.isFinite(rawDistance) ? Math.max(0, rawDistance) : 0;
  const roundedDistance = roundDownToTenth(sanitizedDistance);

  if (normalizedTier === 'GREEN' && allowGreenTier) {
    return { distanceFee: 0, distanceFeeCents: 0, distanceMiles: roundedDistance };
  }

  const includedMiles = Math.max(0, Number(config.distanceIncludedMiles || 0));
  const band1Max = Math.max(includedMiles, Number(config.distanceBand1MaxMiles || 0));
  const band2Max = Math.max(band1Max, Number(config.distanceBand2MaxMiles || 0));
  const band1Rate = Math.max(0, Number(config.distanceBand1Rate || 0));
  const band2Rate = Math.max(0, Number(config.distanceBand2Rate || 0));
  const band3Rate = Math.max(0, Number(config.distanceBand3Rate || 0));

  const band1Miles = Math.max(0, Math.min(roundedDistance, band1Max) - includedMiles);
  const band2Miles = Math.max(0, Math.min(roundedDistance, band2Max) - band1Max);
  const band3Miles = Math.max(0, roundedDistance - band2Max);

  let fee = band1Miles * band1Rate + band2Miles * band2Rate + band3Miles * band3Rate;

  if (orderType === 'RETURNS_PICKUP') {
    fee = fee * Math.max(0, Number(pickupOnlyMultiplier || 0));
  }

  const feeCents = Math.round(fee * 100);
  return { distanceFee: feeCents / 100, distanceFeeCents: feeCents, distanceMiles: roundedDistance };
};

const calculateLargeOrderFeeInternal = ({ items, includedItems, perItemFee }) => {
  const totalItems = Array.isArray(items)
    ? items.reduce((sum, it) => sum + Math.max(0, Number(it.quantity || 0)), 0)
    : 0;
  const extras = Math.max(0, totalItems - Math.max(0, Number(includedItems || 0)));
  const fee = Math.max(0, Number(perItemFee || 0)) * extras;
  const feeCents = Math.round(fee * 100);
  return { largeOrderFee: feeCents / 100, largeOrderFeeCents: feeCents, totalItems, extras };
};

const calculateHeavyItemFeeInternal = ({ items, productsByFrontendId, perUnitFee }) => {
  let heavyCount = 0;
  for (const it of items || []) {
    const pid = String(it?.productId || '').trim();
    const product = productsByFrontendId?.get ? productsByFrontendId.get(pid) : null;
    if (product?.isHeavy) {
      heavyCount += Math.max(0, Number(it.quantity || 0));
    }
  }
  const fee = Math.max(0, Number(perUnitFee || 0)) * heavyCount;
  const feeCents = Math.round(fee * 100);
  return { heavyItemFee: feeCents / 100, heavyItemFeeCents: feeCents, heavyCount };
};

export const getDeliveryOptions = async ({ orderType, tier, distanceMiles, items, productsByFrontendId }) => {
  const doc = await AppSettings.findOne({ key: 'default' }).lean();
  const baseRouteFee = Number(doc?.routeFee ?? 4.99);
  const pickupOnlyMultiplier = Number(doc?.pickupOnlyMultiplier ?? 0.5);
  const platinumFreeDelivery = Boolean(doc?.platinumFreeDelivery ?? false);
  const allowPlatinumTier = Boolean(doc?.allowPlatinumTier ?? false);
  const allowGreenTier = Boolean(doc?.allowGreenTier ?? false);

  const distanceConfig = {
    distanceIncludedMiles: Number(doc?.distanceIncludedMiles ?? DEFAULT_DISTANCE_FEES.distanceIncludedMiles),
    distanceBand1MaxMiles: Number(doc?.distanceBand1MaxMiles ?? DEFAULT_DISTANCE_FEES.distanceBand1MaxMiles),
    distanceBand2MaxMiles: Number(doc?.distanceBand2MaxMiles ?? DEFAULT_DISTANCE_FEES.distanceBand2MaxMiles),
    distanceBand1Rate: Number(doc?.distanceBand1Rate ?? DEFAULT_DISTANCE_FEES.distanceBand1Rate),
    distanceBand2Rate: Number(doc?.distanceBand2Rate ?? DEFAULT_DISTANCE_FEES.distanceBand2Rate),
    distanceBand3Rate: Number(doc?.distanceBand3Rate ?? DEFAULT_DISTANCE_FEES.distanceBand3Rate)
  };

  const handlingConfig = {
    largeOrderIncludedItems: Number(doc?.largeOrderIncludedItems ?? 10),
    largeOrderPerItemFee: Number(doc?.largeOrderPerItemFee ?? 0.3),
    heavyItemFeePerUnit: Number(doc?.heavyItemFeePerUnit ?? 1.5)
  };

  const { routeFee, routeFeeCents, routeFeeDiscountPercent } = applyTierDiscount({
    baseRouteFee,
    pickupOnlyMultiplier,
    orderType,
    tier,
    platinumFreeDelivery,
    allowPlatinumTier,
    allowGreenTier
  });

  const { distanceFee, distanceFeeCents, distanceMiles: roundedDistanceMiles } = calculateDistanceFeeInternal({
    distanceMiles,
    config: distanceConfig,
    orderType,
    pickupOnlyMultiplier,
    tier,
    allowGreenTier
  });

  const { largeOrderFee, largeOrderFeeCents } = calculateLargeOrderFeeInternal({
    items,
    includedItems: handlingConfig.largeOrderIncludedItems,
    perItemFee: handlingConfig.largeOrderPerItemFee
  });

  const { heavyItemFee, heavyItemFeeCents } = calculateHeavyItemFeeInternal({
    items,
    productsByFrontendId: productsByFrontendId || new Map(),
    perUnitFee: handlingConfig.heavyItemFeePerUnit
  });

  return {
    routeFee,
    routeFeeCents,
    routeFeeDiscountPercent,
    distanceFee,
    distanceFeeCents,
    distanceMiles: roundedDistanceMiles,
    largeOrderFee,
    largeOrderFeeCents,
    heavyItemFee,
    heavyItemFeeCents
  };
};
