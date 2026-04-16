export const USER_TIERS = Object.freeze({
  COMMON: 'COMMON',
  BRONZE: 'BRONZE',
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
  GREEN: 'GREEN'
});

const TIER_ORDER = [
  USER_TIERS.COMMON,
  USER_TIERS.BRONZE,
  USER_TIERS.SILVER,
  USER_TIERS.GOLD,
  USER_TIERS.PLATINUM,
  USER_TIERS.GREEN
];

const AUTO_PROMOTION_ORDER = [
  USER_TIERS.COMMON,
  USER_TIERS.BRONZE,
  USER_TIERS.SILVER,
  USER_TIERS.GOLD
];

const MANUAL_ONLY_TIERS = new Set([
  USER_TIERS.PLATINUM,
  USER_TIERS.GREEN
]);

export const TIER_CONFIG = Object.freeze({
  [USER_TIERS.COMMON]: Object.freeze({
    threshold: Object.freeze({ minOrders: 0, minSpend: 0 }),
    benefits: Object.freeze({
      routeDiscount: 0,
      canRedeemPoints: false,
      minRedeemPoints: null,
      canRedeemDeliveryCredits: false,
      canCashOutBottleReturns: false
    })
  }),
  [USER_TIERS.BRONZE]: Object.freeze({
    threshold: Object.freeze({ minOrders: 25, minSpend: 250 }),
    benefits: Object.freeze({
      routeDiscount: 0.1,
      canRedeemPoints: true,
      minRedeemPoints: 500,
      canRedeemDeliveryCredits: false,
      canCashOutBottleReturns: false
    })
  }),
  [USER_TIERS.SILVER]: Object.freeze({
    threshold: Object.freeze({ minOrders: 50, minSpend: 600, phoneVerified: true }),
    benefits: Object.freeze({
      routeDiscount: 0.2,
      canRedeemPoints: true,
      minRedeemPoints: 250,
      canRedeemDeliveryCredits: true,
      canCashOutBottleReturns: true
    })
  }),
  [USER_TIERS.GOLD]: Object.freeze({
    threshold: Object.freeze({ minOrders: 100, minSpend: 1500, photoIdVerified: true }),
    benefits: Object.freeze({
      routeDiscount: 0.3,
      canRedeemPoints: true,
      minRedeemPoints: 0,
      canRedeemDeliveryCredits: true,
      canCashOutBottleReturns: true
    })
  }),
  [USER_TIERS.PLATINUM]: Object.freeze({
    threshold: Object.freeze({ manualOnly: true, flag: 'allowPlatinumTier' }),
    benefits: Object.freeze({
      routeDiscount: 0,
      canRedeemPoints: true,
      minRedeemPoints: 0,
      canRedeemDeliveryCredits: true,
      canCashOutBottleReturns: true,
      routeFeeOverride: 0,
      requiresSetting: 'platinumFreeDelivery'
    })
  }),
  [USER_TIERS.GREEN]: Object.freeze({
    threshold: Object.freeze({ manualOnly: true, flag: 'allowGreenTier' }),
    benefits: Object.freeze({
      routeDiscount: 0,
      canRedeemPoints: true,
      minRedeemPoints: 0,
      canRedeemDeliveryCredits: true,
      canCashOutBottleReturns: true,
      routeFeeOverride: 1,
      distanceFeeOverride: 0
    })
  })
});

export const normalizeTier = tier => {
  const normalized = String(tier || '').trim().toUpperCase();
  if (!normalized || normalized === 'NONE') return USER_TIERS.COMMON;
  return USER_TIERS[normalized] || USER_TIERS.COMMON;
};

const isTierEligible = ({ tier, orderCount, totalSpend, phoneVerified, photoIdVerified }) => {
  const threshold = TIER_CONFIG[tier]?.threshold || {};
  if ((Number(orderCount) || 0) < (Number(threshold.minOrders) || 0)) return false;
  if ((Number(totalSpend) || 0) < (Number(threshold.minSpend) || 0)) return false;
  if (threshold.phoneVerified && !Boolean(phoneVerified)) return false;
  if (threshold.photoIdVerified && !Boolean(photoIdVerified)) return false;
  return true;
};

export const calculateUserTier = ({
  orderCount = 0,
  totalSpend = 0,
  phoneVerified = false,
  photoIdVerified = false,
  currentTier,
  allowPlatinumTier = false,
  allowGreenTier = false
} = {}) => {
  const normalizedCurrentTier = normalizeTier(currentTier);

  if (normalizedCurrentTier === USER_TIERS.PLATINUM) {
    return allowPlatinumTier ? USER_TIERS.PLATINUM : normalizedCurrentTier;
  }
  if (normalizedCurrentTier === USER_TIERS.GREEN) {
    return allowGreenTier ? USER_TIERS.GREEN : normalizedCurrentTier;
  }
  if (MANUAL_ONLY_TIERS.has(normalizedCurrentTier)) {
    return normalizedCurrentTier;
  }

  let highestTier = USER_TIERS.COMMON;
  for (const tier of AUTO_PROMOTION_ORDER) {
    if (
      isTierEligible({
        tier,
        orderCount,
        totalSpend,
        phoneVerified,
        photoIdVerified
      })
    ) {
      highestTier = tier;
    }
  }

  return highestTier;
};

export const getTierBenefits = ({ tier, settings = {} } = {}) => {
  const normalizedTier = normalizeTier(tier);
  const config = TIER_CONFIG[normalizedTier] || TIER_CONFIG[USER_TIERS.COMMON];
  const benefits = { ...config.benefits };

  const allowPlatinumTier = Boolean(settings.allowPlatinumTier);
  const allowGreenTier = Boolean(settings.allowGreenTier);
  const platinumFreeDelivery = Boolean(settings.platinumFreeDelivery);

  if (normalizedTier === USER_TIERS.PLATINUM) {
    if (!allowPlatinumTier || !platinumFreeDelivery) {
      delete benefits.routeFeeOverride;
    }
  }

  if (normalizedTier === USER_TIERS.GREEN) {
    if (!allowGreenTier) {
      delete benefits.routeFeeOverride;
      delete benefits.distanceFeeOverride;
    }
  }

  return {
    tier: normalizedTier,
    rank: TIER_ORDER.indexOf(normalizedTier),
    threshold: config.threshold,
    ...benefits
  };
};
