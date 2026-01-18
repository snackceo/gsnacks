import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';
import AppSettings from '../models/AppSettings.js';
import User from '../models/User.js';
import LedgerEntry from '../models/LedgerEntry.js';
import CashPayout from '../models/CashPayout.js';
import {
  authRequired,
  isDriverUsername,
  isOwnerUsername,
  calculateReturnFeeSummary,
  mapOrderForFrontend,
  normalizeReturnPayoutMethod,
  normalizeCart,
  normalizeUpcCounts,
  sumReturnCredits
} from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';
import { resolveDistanceMiles } from '../utils/distance.js';

const CREDIT_DELIVERY_ELIGIBLE_TIERS = new Set(['SILVER', 'GOLD', 'PLATINUM', 'GREEN']);
const CASH_PAYOUT_ELIGIBLE_TIERS = new Set(['GOLD', 'PLATINUM', 'GREEN']);
const CASH_HANDLING_FEE_PER_CONTAINER = 0.02;
const GLASS_HANDLING_SURCHARGE_PER_CONTAINER = 0.02;
const POINT_ELIGIBLE_TIERS = new Set(['COMMON', 'BRONZE', 'SILVER', 'GOLD']);
const POINT_EARNING_RATES = {
  COMMON: 1.0,
  BRONZE: 1.0,
  SILVER: 1.2,
  GOLD: 1.5
};
const DEFAULT_DISTANCE_FEES = {
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0
};

const normalizeTier = tier => {
  const normalized = String(tier || '').trim().toUpperCase();
  // Add 'GREEN' as a recognized tier
  if (['COMMON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'GREEN'].includes(normalized)) {
    return normalized;
  }
  return 'COMMON';
};

const normalizePayoutMethodForTier = (payoutMethod, tier) => {
  const normalizedPayout = normalizeReturnPayoutMethod(payoutMethod);
  if (normalizedPayout === 'CASH' && !CASH_PAYOUT_ELIGIBLE_TIERS.has(normalizeTier(tier))) {
    return 'CREDIT';
  }
  return normalizedPayout;
};

const getRouteFeeConfig = async () => {
  const doc = await AppSettings.findOne({ key: 'default' }).lean();
  return {
    baseRouteFee: Number(doc?.routeFee ?? 4.99),
    pickupOnlyMultiplier: Number(doc?.pickupOnlyMultiplier ?? 0.5),
    platinumFreeDelivery: Boolean(doc?.platinumFreeDelivery ?? false)
  };
};

const TIER_ROUTE_DISCOUNTS = {
  BRONZE: 0.1,
  SILVER: 0.2,
  GOLD: 0.3
};

const calculateRouteFee = ({
  baseRouteFee,
  pickupOnlyMultiplier,
  orderType,
  tier,
  platinumFreeDelivery
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

  if (normalizedTier === 'GREEN') {
    fee = 1;
    discountPercent =
      feeBeforeTierDiscount > 0
        ? Math.max(0, Math.min(1, 1 - fee / feeBeforeTierDiscount))
        : 0;
  }

  if (normalizedTier === 'PLATINUM' && platinumFreeDelivery) {
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

const getDistanceFeeConfig = async () => {
  const doc = await AppSettings.findOne({ key: 'default' }).lean();
  return {
    distanceIncludedMiles: Number(
      doc?.distanceIncludedMiles ?? DEFAULT_DISTANCE_FEES.distanceIncludedMiles
    ),
    distanceBand1MaxMiles: Number(
      doc?.distanceBand1MaxMiles ?? DEFAULT_DISTANCE_FEES.distanceBand1MaxMiles
    ),
    distanceBand2MaxMiles: Number(
      doc?.distanceBand2MaxMiles ?? DEFAULT_DISTANCE_FEES.distanceBand2MaxMiles
    ),
    distanceBand1Rate: Number(
      doc?.distanceBand1Rate ?? DEFAULT_DISTANCE_FEES.distanceBand1Rate
    ),
    distanceBand2Rate: Number(
      doc?.distanceBand2Rate ?? DEFAULT_DISTANCE_FEES.distanceBand2Rate
    ),
    distanceBand3Rate: Number(
      doc?.distanceBand3Rate ?? DEFAULT_DISTANCE_FEES.distanceBand3Rate
    )
  };
};

const roundDownToTenth = value => Math.floor(value * 10) / 10;

const calculatePointUnits = ({ productPaidCents, tier }) => {
  const normalizedTier = normalizeTier(tier);
  if (!POINT_ELIGIBLE_TIERS.has(normalizedTier)) return 0;
  const rate = POINT_EARNING_RATES[normalizedTier] ?? 0;
  if (!rate || productPaidCents <= 0) return 0;
  return Math.max(0, Math.round(productPaidCents * rate));
};

const calculateDistanceFee = ({
  distanceMiles,
  config,
  orderType,
  pickupOnlyMultiplier,
  tier
}) => {
  const normalizedTier = normalizeTier(tier);
  const rawDistance = Number(distanceMiles);
  const sanitizedDistance = Number.isFinite(rawDistance) ? Math.max(0, rawDistance) : 0;
  const roundedDistance = roundDownToTenth(sanitizedDistance);

  if (normalizedTier === 'GREEN') {
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

  let fee =
    band1Miles * band1Rate + band2Miles * band2Rate + band3Miles * band3Rate;

  if (orderType === 'RETURNS_PICKUP') {
    fee = fee * Math.max(0, Number(pickupOnlyMultiplier || 0));
  }

  const feeCents = Math.round(fee * 100);
  return { distanceFee: feeCents / 100, distanceFeeCents: feeCents, distanceMiles: roundedDistance };
};

const getReturnFeeConfig = async () => ({
  returnHandlingFeePerContainer: CASH_HANDLING_FEE_PER_CONTAINER,
  glassHandlingFeePerContainer: GLASS_HANDLING_SURCHARGE_PER_CONTAINER
});

const buildReturnPreview = async (rawUpcs, payoutMethod = 'CREDIT') => {
  const { upcCounts, uniqueUpcs } = normalizeUpcCounts(rawUpcs);
  const returnUpcs = [];
  const returnUpcCounts = [];

  let eligibleUpcs = [];
  let eligibleUpcCounts = [];
  let ineligibleUpcs = [];
  let estimatedCreditFromUpcs = 0;

  let feeSummary = { totalFee: 0 };
  if (uniqueUpcs.length > 0) {
    const upcEntries = await UpcItem.find({ upc: { $in: uniqueUpcs } }).lean();
    const upcByCode = new Map(upcEntries.map(entry => [entry.upc, entry]));

    for (const { upc, quantity } of upcCounts) {
      const entry = upcByCode.get(upc);
      if (entry?.isEligible) {
        eligibleUpcs.push(...Array.from({ length: quantity }, () => upc));
        eligibleUpcCounts.push({ upc, quantity });
      } else {
        ineligibleUpcs.push(upc);
      }
    }

    const feeConfig = await getReturnFeeConfig();
    feeSummary = calculateReturnFeeSummary(eligibleUpcCounts, upcEntries, feeConfig);
    estimatedCreditFromUpcs = sumReturnCredits(eligibleUpcCounts, upcEntries);
  }

  const computedEstimatedCredit = estimatedCreditFromUpcs;
  const shouldApplyFees = payoutMethod === 'CASH';
  const estimatedNetCredit = shouldApplyFees
    ? Math.max(0, computedEstimatedCredit - feeSummary.totalFee)
    : computedEstimatedCredit;
  const estimatedCredit = {
    gross: computedEstimatedCredit,
    net: estimatedNetCredit
  };

  returnUpcs.push(...eligibleUpcs);
  returnUpcCounts.push(...eligibleUpcCounts);

  return {
    returnUpcs,
    returnUpcCounts,
    eligibleUpcs,
    eligibleUpcCounts,
    ineligibleUpcs,
    estimatedCredit
  };
};

const handleDistanceLookupError = (res, err) => {
  if (err?.code === 'ADDRESS_REQUIRED') {
    return res.status(400).json({ error: err.message });
  }
  if (err?.code === 'HUB_NOT_CONFIGURED') {
    return res.status(503).json({ error: err.message });
  }
  if (err?.code === 'ADDRESS_NOT_FOUND') {
    return res.status(404).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Distance lookup failed' });
};

const awardLoyaltyPoints = async ({ order, user, productPaidCents, session }) => {
  if (!order || !user) return 0;
  if (order.pointsAwardedAt) return 0;
  const pointsToAdd = calculatePointUnits({
    productPaidCents,
    tier: user.membershipTier
  });
  if (pointsToAdd <= 0) return 0;

  const previousPoints = Math.max(0, Math.round(Number(user.loyaltyPoints || 0)));
  user.loyaltyPoints = previousPoints + pointsToAdd;
  await user.save({ session });

  await LedgerEntry.create(
    [{ userId: user._id, delta: pointsToAdd, reason: `POINTS_EARNED:${order.orderId}` }],
    { session }
  );

  order.pointsAwardedAt = new Date();
  await order.save({ session });
  return pointsToAdd;
};

const createPaymentsRouter = ({ stripe }) => {
  const router = express.Router();

  /* =========================
     PAYMENTS
     Option 2: Authorize at checkout, capture after driver verification.
  ========================= */

  /**
   * POST /api/payments/quote
   * - estimates subtotal + fees based on backend logic
   */
  router.post('/quote', async (req, res) => {
    try {
      const rawItems = req.body?.items;
      const userId = req.body?.userId;
      const address = String(req.body?.address || '').trim();
      const rawReturnUpcs = req.body?.returnUpcCounts ?? req.body?.returnUpcs;

      const items = normalizeCart(rawItems);
      const normalizedReturnUpcs = normalizeUpcCounts(rawReturnUpcs);
      const isReturnOnly =
        Array.isArray(items) && items.length === 0 && normalizedReturnUpcs.uniqueUpcs.length > 0;
      if ((!Array.isArray(items) || items.length === 0) && !isReturnOnly) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const tierLookupUser = userId
        ? await User.findById(userId, { membershipTier: 1 }).lean()
        : null;
      const { baseRouteFee, pickupOnlyMultiplier, platinumFreeDelivery } =
        await getRouteFeeConfig();
      const distanceFeeConfig = await getDistanceFeeConfig();

      let distanceMiles = 0;
      if (address) {
        try {
          distanceMiles = await resolveDistanceMiles(address);
        } catch (err) {
          return handleDistanceLookupError(res, err);
        }
      }

      const orderType = isReturnOnly ? 'RETURNS_PICKUP' : 'DELIVERY_PURCHASE';
      const { routeFee, routeFeeCents } = calculateRouteFee({
        baseRouteFee,
        pickupOnlyMultiplier,
        orderType,
        tier: tierLookupUser?.membershipTier,
        platinumFreeDelivery
      });
      const { distanceFee, distanceFeeCents, distanceMiles: roundedDistanceMiles } =
        calculateDistanceFee({
          distanceMiles,
          config: distanceFeeConfig,
          orderType,
          pickupOnlyMultiplier,
          tier: tierLookupUser?.membershipTier
        });

      let totalCents = 0;
      let productSubtotalCents = 0;

      if (Array.isArray(items) && items.length > 0) {
        const products = await Product.find(
          { frontendId: { $in: items.map(item => item.productId) } },
          { price: 1, frontendId: 1 }
        ).lean();
        const productMap = new Map(products.map(product => [product.frontendId, product]));

        for (const item of items) {
          const product = productMap.get(item.productId);
          if (!product) {
            return res.status(400).json({ error: `Unknown product ${item.productId}` });
          }
          const unit = Math.round(Number(product.price || 0) * 100);
          const lineTotal = unit * item.quantity;
          totalCents += lineTotal;
          productSubtotalCents += lineTotal;
        }
      }

      if (routeFeeCents > 0) {
        totalCents += routeFeeCents;
      }

      if (distanceFeeCents > 0) {
        totalCents += distanceFeeCents;
      }

      return res.json({
        subtotal: productSubtotalCents / 100,
        total: totalCents / 100,
        routeFeeFinal: routeFee,
        distanceFeeFinal: distanceFee,
        distanceMiles: roundedDistanceMiles,
        orderType
      });
    } catch (err) {
      console.error('QUOTE ERROR:', err);
      return res.status(500).json({ error: 'Quote failed' });
    }
  });

  /**
   * POST /api/payments/create-session
   * - reserves inventory
   * - creates order (PENDING)
   * - creates Stripe Checkout Session with capture_method = manual (authorize only)
   */
  router.post('/create-session', async (req, res) => {
    const sessionDb = await mongoose.startSession();

    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const rawItems = req.body?.items;
      const userId = req.body?.userId;
      const address = String(req.body?.address || '').trim();
      const gateway = String(req.body?.gateway || 'STRIPE').toUpperCase();
      const tierLookupUser = userId
        ? await User.findById(userId, { membershipTier: 1 }).session(sessionDb)
        : null;
      const returnPayoutMethod = normalizePayoutMethodForTier(
        req.body?.returnPayoutMethod,
        tierLookupUser?.membershipTier
      );
      const { baseRouteFee, pickupOnlyMultiplier, platinumFreeDelivery } =
        await getRouteFeeConfig();
      const distanceFeeConfig = await getDistanceFeeConfig();
      let distanceMiles;
      try {
        distanceMiles = await resolveDistanceMiles(address);
      } catch (err) {
        return handleDistanceLookupError(res, err);
      }

      const items = normalizeCart(rawItems);
      const rawReturnUpcs = req.body?.returnUpcCounts ?? req.body?.returnUpcs;
      const normalizedReturnUpcs = normalizeUpcCounts(rawReturnUpcs);
      const isReturnOnly =
        Array.isArray(items) && items.length === 0 && normalizedReturnUpcs.uniqueUpcs.length > 0;
      if ((!Array.isArray(items) || items.length === 0) && !isReturnOnly) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const { eligibleUpcs, eligibleUpcCounts, ineligibleUpcs, estimatedCredit } =
        await buildReturnPreview(rawReturnUpcs, returnPayoutMethod);
      if (isReturnOnly && eligibleUpcs.length === 0) {
        return res.status(400).json({ error: 'No eligible return UPCs provided.' });
      }

      const orderType = isReturnOnly ? 'RETURNS_PICKUP' : 'DELIVERY_PURCHASE';
      const { routeFee, routeFeeCents, routeFeeDiscountPercent } = calculateRouteFee({
        baseRouteFee,
        pickupOnlyMultiplier,
        orderType,
        tier: tierLookupUser?.membershipTier,
        platinumFreeDelivery
      });
      const { distanceFee, distanceFeeCents, distanceMiles: roundedDistanceMiles } =
        calculateDistanceFee({
          distanceMiles,
          config: distanceFeeConfig,
          orderType,
          pickupOnlyMultiplier,
          tier: tierLookupUser?.membershipTier
        });

      const orderId = crypto.randomUUID();
      const lineItems = [];
      let totalCents = 0;
      let productSubtotalCents = 0;

      await sessionDb.withTransaction(async () => {
        const products = await Promise.all(
          items.map(async item => {
            const updated = await Product.findOneAndUpdate(
              { frontendId: item.productId, stock: { $gte: item.quantity } },
              { $inc: { stock: -item.quantity } },
              { new: true, session: sessionDb }
            );

            if (!updated) {
              const current = await Product.findOne(
                { frontendId: item.productId },
                { stock: 1, name: 1 }
              ).session(sessionDb);

              const available = current?.stock ?? 0;
              const name = current?.name || item.productId;

              const err = new Error(`Insufficient stock for ${name}. Available: ${available}`);
              err.code = 'INSUFFICIENT_STOCK';
              err.meta = { productId: item.productId, available };
              throw err;
            }
            return { updated, item };
          })
        );

        products.forEach(({ updated, item }) => {
          const unit = Math.round(Number(updated.price) * 100);
          const lineTotal = unit * item.quantity;
          totalCents += lineTotal;
          productSubtotalCents += lineTotal;

          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: updated.name },
              unit_amount: unit
            },
            quantity: item.quantity
          });
        });

        if (routeFeeCents > 0) {
          totalCents += routeFeeCents;
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: {
                name:
                  orderType === 'RETURNS_PICKUP'
                    ? 'Route Fee — Pickup-Only Order'
                    : 'Route Fee — Delivery Order'
              },
              unit_amount: routeFeeCents
            },
            quantity: 1
          });
        }

        if (distanceFeeCents > 0) {
          totalCents += distanceFeeCents;
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Distance Fee'
              },
              unit_amount: distanceFeeCents
            },
            quantity: 1
          });
        }

        await Order.create(
          [
            {
              orderId,
              customerId: userId || 'GUEST',
              address: address || '',
              items,
              subtotal: productSubtotalCents / 100,
              total: totalCents / 100,
              orderType,
              routeFee: baseRouteFee,
              routeFeeDiscountPercent,
              routeFeeFinal: routeFee,
              distanceMiles: roundedDistanceMiles,
              distanceFee,
              distanceFeeFinal: distanceFee,
              creditAppliedCents: 0,
              creditAuthorizedCents: 0,

              returnUpcs: eligibleUpcs,
              returnUpcCounts: eligibleUpcCounts,
              estimatedReturnCreditGross: estimatedCredit.gross,
              estimatedReturnCredit: estimatedCredit.net,
              verifiedReturnCreditGross: 0,
              verifiedReturnCredit: 0,
              returnPayoutMethod,

              paymentMethod: gateway === 'GPAY' ? 'GOOGLE_PAY' : 'STRIPE',
              status: 'PENDING',

              amountAuthorizedCents: totalCents
            }
          ],
          { session: sessionDb }
        );
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      // Manual capture => authorize now, capture later
      const stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        payment_intent_data: {
          capture_method: 'manual'
        },
        metadata: { orderId },
        success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/cancel?session_id={CHECKOUT_SESSION_ID}`
      });

      await Order.findOneAndUpdate({ orderId }, { stripeSessionId: stripeSession.id });

      const responsePayload = { sessionUrl: stripeSession.url };
      const uniqueIneligibleUpcs = [...new Set(ineligibleUpcs)];
      if (uniqueIneligibleUpcs.length > 0) {
        responsePayload.warning = 'Some return UPCs are ineligible and were removed.';
        responsePayload.ineligibleUpcs = uniqueIneligibleUpcs;
      }

      if (routeFeeCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: userId || 'GUEST',
          details: `Order ${orderId} created with route fee $${routeFee.toFixed(2)}.`
        });
      }
      if (distanceFeeCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: userId || 'GUEST',
          details: `Order ${orderId} created with distance fee $${distanceFee.toFixed(2)}.`
        });
      }

      res.json(responsePayload);
    } catch (err) {
      console.error('STRIPE SESSION ERROR:', err);

      if (err?.code === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({ error: err.message, meta: err.meta });
      }

      res.status(500).json({ error: 'Stripe session failed' });
    } finally {
      sessionDb.endSession();
    }
  });

  /**
   * POST /api/payments/credits
   * - reserves inventory
   * - applies user credits (partial or full)
   * - creates order and Stripe session for remaining amount (if needed)
   */
  router.post('/credits', authRequired, async (req, res) => {
    const sessionDb = await mongoose.startSession();

    let user;
    let creditTransactionId = null;
    try {
      const rawItems = req.body?.items;
      const address = String(req.body?.address || '').trim();

      const items = normalizeCart(rawItems);
      const rawReturnUpcs = req.body?.returnUpcCounts ?? req.body?.returnUpcs;
      const normalizedReturnUpcs = normalizeUpcCounts(rawReturnUpcs);
      const isReturnOnly =
        Array.isArray(items) && items.length === 0 && normalizedReturnUpcs.uniqueUpcs.length > 0;
      if ((!Array.isArray(items) || items.length === 0) && !isReturnOnly) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not logged in' });

      user = await User.findById(userId).session(sessionDb);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const returnPayoutMethod = normalizePayoutMethodForTier(
        req.body?.returnPayoutMethod,
        user?.membershipTier
      );
      const { eligibleUpcs, eligibleUpcCounts, ineligibleUpcs, estimatedCredit } =
        await buildReturnPreview(rawReturnUpcs, returnPayoutMethod);
      if (isReturnOnly && eligibleUpcs.length === 0) {
        return res.status(400).json({ error: 'No eligible return UPCs provided.' });
      }

      if (user.creditTransactionId) {
        const err = new Error('User has a pending credit transaction.');
        err.code = 'PENDING_CREDIT_TRANSACTION';
        throw err;
      }
      const { baseRouteFee, pickupOnlyMultiplier, platinumFreeDelivery } =
        await getRouteFeeConfig();
      const distanceFeeConfig = await getDistanceFeeConfig();
      let distanceMiles;
      try {
        distanceMiles = await resolveDistanceMiles(address);
      } catch (err) {
        return handleDistanceLookupError(res, err);
      }
      const orderType = isReturnOnly ? 'RETURNS_PICKUP' : 'DELIVERY_PURCHASE';
      const { routeFee, routeFeeCents, routeFeeDiscountPercent } = calculateRouteFee({
        baseRouteFee,
        pickupOnlyMultiplier,
        orderType,
        tier: user?.membershipTier,
        platinumFreeDelivery
      });
      const { distanceFee, distanceFeeCents, distanceMiles: roundedDistanceMiles } =
        calculateDistanceFee({
          distanceMiles,
          config: distanceFeeConfig,
          orderType,
          pickupOnlyMultiplier,
          tier: user?.membershipTier
        });

      const orderId = crypto.randomUUID();
      let totalCents = 0;
      let productSubtotalCents = 0;

      creditTransactionId = crypto.randomUUID();
      user.creditTransactionId = creditTransactionId;
      await user.save({ session: sessionDb });
      await sessionDb.withTransaction(async () => {
        if (!isReturnOnly) {
          const products = await Promise.all(
            items.map(async item => {
              const updated = await Product.findOneAndUpdate(
                { frontendId: item.productId, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity } },
                { new: true, session: sessionDb }
              );

              if (!updated) {
                const current = await Product.findOne(
                  { frontendId: item.productId },
                  { stock: 1, name: 1 }
                ).session(sessionDb);

                const available = current?.stock ?? 0;
                const name = current?.name || item.productId;

                const err = new Error(`Insufficient stock for ${name}. Available: ${available}`);
                err.code = 'INSUFFICIENT_STOCK';
                err.meta = { productId: item.productId, available };
                throw err;
              }
              return { updated, item };
            })
          );

          products.forEach(({ updated, item }) => {
            const unit = Math.round(Number(updated.price) * 100);
            const lineTotal = unit * item.quantity;
            totalCents += lineTotal;
            productSubtotalCents += lineTotal;
          });
        }

        if (routeFeeCents > 0) {
          totalCents += routeFeeCents;
        }
        if (distanceFeeCents > 0) {
          totalCents += distanceFeeCents;
        }

        const tier = normalizeTier(user?.membershipTier);
        const eligibleCreditCents = CREDIT_DELIVERY_ELIGIBLE_TIERS.has(tier)
          ? totalCents
          : productSubtotalCents;
        const availableCreditsCents = Math.max(
          0,
          Math.round(Number(user.creditBalance || 0) * 100)
        );
        const creditAppliedCents = Math.min(availableCreditsCents, eligibleCreditCents);
        const remainingCents = Math.max(0, totalCents - creditAppliedCents);
        const creditAuthorized = creditAppliedCents / 100;

        if (creditAppliedCents > 0) {
          const currentBalance = Number(user.creditBalance || 0);
          const currentAuthorized = Number(user.authorizedCreditBalance || 0);
          user.creditBalance = Math.max(0, currentBalance - creditAuthorized);
          user.authorizedCreditBalance = currentAuthorized + creditAuthorized;
          await user.save({ session: sessionDb });
        }

        await Order.create(
          [
            {
              orderId,
              customerId: userId,
              address: address || '',
              items,
              subtotal: productSubtotalCents / 100,
              total: totalCents / 100,
              orderType,
              routeFee: baseRouteFee,
              routeFeeDiscountPercent,
              routeFeeFinal: routeFee,
              distanceMiles: roundedDistanceMiles,
              distanceFee,
              distanceFeeFinal: distanceFee,
              creditAuthorizedCents: creditAppliedCents,
              creditAppliedCents: 0, // Will be set on capture
              paymentMethod: remainingCents > 0 ? 'STRIPE' : 'CREDITS', // if fully covered
              status: remainingCents > 0 ? 'PENDING' : 'AUTHORIZED',
              amountAuthorizedCents: remainingCents,

              returnUpcs: eligibleUpcs,
              returnUpcCounts: eligibleUpcCounts,
              estimatedReturnCreditGross: estimatedCredit.gross,
              estimatedReturnCredit: estimatedCredit.net,
              verifiedReturnCreditGross: 0,
              verifiedReturnCredit: 0,
              returnPayoutMethod
            }
          ],
          { session: sessionDb }
        );
      });

      const remainingOrder = await Order.findOne({ orderId }).lean();
      if (!remainingOrder) return res.status(404).json({ error: 'Order not found' });

      const remainingCents = Number(remainingOrder.amountAuthorizedCents || 0);

      if (routeFeeCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: req.user?.username || req.user?.id || userId,
          details: `Order ${orderId} created with route fee $${routeFee.toFixed(2)}.`
        });
      }
      if (distanceFeeCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: req.user?.username || req.user?.id || userId,
          details: `Order ${orderId} created with distance fee $${distanceFee.toFixed(2)}.`
        });
      }

      if (remainingOrder.creditAuthorizedCents > 0) {
        await recordAuditLog({
          type: 'CREDIT_ADJUSTED',
          actorId: req.user?.username || req.user?.id || userId,
          details: `Authorized $${(
            Number(remainingOrder.creditAuthorizedCents || 0) / 100
          ).toFixed(2)} credits for order ${orderId}. Available Balance: $${Number(
            user.creditBalance || 0
          ).toFixed(2)}.`
        });
      }

      const uniqueIneligibleUpcs = [...new Set(ineligibleUpcs)];

      if (remainingCents === 0) {
        // This block now handles fully credit-authorized orders
        if (remainingOrder.customerId && remainingOrder.customerId !== 'GUEST') {
          const [orderForPoints, userForPoints] = await Promise.all([
            Order.findOne({ orderId }),
            User.findById(remainingOrder.customerId)
          ]);
          if (orderForPoints && userForPoints) {
            const productSubtotalCents = Math.round(Number(orderForPoints.subtotal || 0) * 100);
            const creditAppliedCents = Math.round(
              Number(orderForPoints.creditAuthorizedCents || 0)
            );
            const creditAppliedToProductsCents = Math.min(
              creditAppliedCents,
              productSubtotalCents
            );
            const productPaidCents = Math.max(
              0,
              productSubtotalCents - creditAppliedToProductsCents
            );
            await awardLoyaltyPoints({
              order: orderForPoints,
              user: userForPoints,
              productPaidCents
            });
          }
        }

        const responsePayload = {
          ok: true,
          order: mapOrderForFrontend(remainingOrder),
          creditBalance: Number(user.creditBalance || 0) // Return available balance
        };
        if (uniqueIneligibleUpcs.length > 0) {
          responsePayload.warning = 'Some return UPCs are ineligible and were removed.';
          responsePayload.ineligibleUpcs = uniqueIneligibleUpcs;
        }
        return res.json(responsePayload);
      }

      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      const stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Ninpo Snacks order (after credits)'
              },
              unit_amount: remainingCents
            },
            quantity: 1
          }
        ],
        payment_intent_data: {
          capture_method: 'manual'
        },
        metadata: { orderId },
        success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/cancel?session_id={CHECKOUT_SESSION_ID}`
      });

      await Order.findOneAndUpdate(
        { orderId },
        { stripeSessionId: stripeSession.id, amountAuthorizedCents: remainingCents }
      );

      const responsePayload = {
        sessionUrl: stripeSession.url,
        orderId,
        creditsAuthorized: Number(remainingOrder.creditAuthorizedCents || 0) / 100,
        creditBalance: Number(user.creditBalance || 0)
      };
      if (uniqueIneligibleUpcs.length > 0) {
        responsePayload.warning = 'Some return UPCs are ineligible and were removed.';
        responsePayload.ineligibleUpcs = uniqueIneligibleUpcs;
      }
      res.json(responsePayload);
    } catch (err) {
      console.error('CREDITS PAYMENT ERROR:', err);

      if (err?.code === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({ error: err.message, meta: err.meta });
      }
      if (err?.code === 'PENDING_CREDIT_TRANSACTION') {
        return res.status(409).json({ error: err.message });
      }

      res.status(500).json({ error: 'Credits checkout failed' });
    } finally {
      if (sessionDb) {
        sessionDb.endSession();
      }
      // Ensure creditTransactionId is cleared regardless of success or failure
      if (user && creditTransactionId) {
        try {
          // Use findOneAndUpdate to release the lock atomically.
          await User.findOneAndUpdate({ _id: user._id, creditTransactionId }, { $unset: { creditTransactionId: 1 } });
        } catch (cleanupErr) {
          console.error(`Error cleaning up creditTransactionId for user ${user._id}:`, cleanupErr);
        }
      }
    }
  });

  const applyWalletCredit = async (
    { order, walletCreditCents, payoutMethod },
    { session, actorId }
  ) => {
    let creditedUserId = null;
    let creditedAmount = 0;
    if (
      payoutMethod === 'CREDIT' &&
      walletCreditCents > 0 &&
      order.customerId &&
      order.customerId !== 'GUEST'
    ) {
      const user = await User.findById(order.customerId).session(session);
      if (user) {
        const previousCredits = Number(user.creditBalance || 0);
        user.creditBalance = Math.max(0, previousCredits + walletCreditCents / 100);
        await user.save({ session });

        const delta = Number(user.creditBalance || 0) - previousCredits;
        if (delta) {
          await LedgerEntry.create(
            [{ userId: order.customerId, delta, reason: `RETURN_CREDIT_REMAINDER:${order.orderId}` }],
            { session }
          );
          creditedUserId = order.customerId;
          creditedAmount = delta;
        }
      }
    }
    return { creditedUserId, creditedAmount };
  };

  /**
   * POST /api/payments/capture (owner-only)
   * - Driver submits verifiedReturnCredit
   * - Server captures final amount = authorized - verified credit (never increases)
   */
  router.post('/capture', authRequired, async (req, res) => {
    const sessionDb = await mongoose.startSession();

    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const orderId = String(req.body?.orderId || '').trim();
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });

      await recordAuditLog({
        type: 'ORDER_CAPTURE_START',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: `Attempting to capture payment for order ${orderId}.`
      });

      let updatedOrderDoc = null;

      const isOwner = isOwnerUsername(req.user?.username);
      const isDriver = isDriverUsername(req.user?.username);
      const requestedReturnUpcCounts = req.body?.verifiedReturnUpcCounts;
      const requestedReturnUpcs = req.body?.verifiedReturnUpcs;

      let verifiedReturnCredit = 0;
      let verifiedReturnCreditGross = 0;
      let verifiedReturnUpcCounts = [];
      let verifiedReturnUpcs = [];
      let verifiedCredit = { gross: 0, net: 0 };
      let creditedUserId = null;
      let creditedAmount = 0;
      let cashPayoutAmount = 0;
      let cashPayoutUserId = null;

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;
        const payoutMethod = normalizeReturnPayoutMethod(order.returnPayoutMethod);

        if (!isOwner) {
          if (!isDriver) {
            const e = new Error('Owner or driver access required.');
            e.code = 'STAFF_REQUIRED';
            throw e;
          }

          const matchesDriver =
            order.driverId &&
            [order.driverId, req.user?.username, req.user?.id].includes(order.driverId);

          if (!matchesDriver) {
            const e = new Error('Order is not assigned to this driver.');
            e.code = 'DRIVER_MISMATCH';
            throw e;
          }
        }

        const verifiedPayload =
          requestedReturnUpcCounts ??
          requestedReturnUpcs ??
          order.verifiedReturnUpcCounts ??
          order.verifiedReturnUpcs ??
          order.returnUpcCounts ??
          order.returnUpcs ??
          [];
        const normalized = normalizeUpcCounts(verifiedPayload);
        verifiedReturnUpcCounts = normalized.upcCounts;
        verifiedReturnUpcs = normalized.flattened;

        if (normalized.uniqueUpcs.length > 0) {
          const upcEntries = await UpcItem.find({
            upc: { $in: normalized.uniqueUpcs },
            isEligible: true
          })
            .session(sessionDb)
            .lean();

          verifiedReturnCreditGross = sumReturnCredits(normalized.upcCounts, upcEntries);
          let feeSummary = { totalFee: 0 };
          if (payoutMethod === 'CASH') {
            const feeConfig = await getReturnFeeConfig();
            feeSummary = calculateReturnFeeSummary(
              normalized.upcCounts,
              upcEntries,
              feeConfig
            );
          }
          const computedVerifiedCreditGross = verifiedReturnCreditGross;
          const netCredit =
            payoutMethod === 'CASH'
              ? Math.max(0, computedVerifiedCreditGross - feeSummary.totalFee)
              : computedVerifiedCreditGross;
          verifiedCredit = {
            gross: computedVerifiedCreditGross,
            net: netCredit
          };

          await recordAuditLog({
            type: 'ORDER_RETURNS_VERIFIED',
            actorId: req.user?.username || req.user?.id || 'UNKNOWN',
            details: `Order ${orderId} returns verified. Gross: $${verifiedCredit.gross.toFixed(
              2
            )}, Fees: $${Number(feeSummary.totalFee || 0).toFixed(
              2
            )}, Net: $${netCredit.toFixed(2)}.`
          });
        }
        verifiedReturnCredit = verifiedCredit.net;

        if (order.status === 'PAID') {
          updatedOrderDoc = order;
          return;
        }

        if (order.status === 'CANCELED' || order.status === 'EXPIRED') {
          const e = new Error('Cannot capture a canceled/expired order.');
          e.code = 'ORDER_CANCELED';
          throw e;
        }

        const pi = order.stripePaymentIntentId;
        if (!pi) {
          const e = new Error('No Stripe PaymentIntent found for this order yet.');
          e.code = 'NO_PAYMENT_INTENT';
          throw e;
        }

        const authorizedCents = Number(
          order.amountAuthorizedCents || Math.round(Number(order.total || 0) * 100)
        );
        const netCreditCents = Math.round(verifiedReturnCredit * 100);
        const payoutUser =
          order.customerId && order.customerId !== 'GUEST'
            ? await User.findById(order.customerId).session(sessionDb)
            : null;
        const tier = normalizeTier(payoutUser?.membershipTier);
        const productSubtotalCents = Math.round(Number(order.subtotal || 0) * 100);
        const creditAppliedCents = Math.round(Number(order.creditAppliedCents || 0));
        const creditAppliedToProductsCents = Math.min(
          creditAppliedCents,
          productSubtotalCents
        );
        const remainingProductCents = Math.max(
          0,
          productSubtotalCents - creditAppliedToProductsCents
        );

        const eligibleReturnCreditCents =
          payoutMethod === 'CREDIT'
            ? CREDIT_DELIVERY_ELIGIBLE_TIERS.has(tier)
              ? authorizedCents
              : Math.min(authorizedCents, remainingProductCents)
            : 0;
        const creditCents = Math.min(netCreditCents, eligibleReturnCreditCents);
        const walletCreditCents =
          payoutMethod === 'CREDIT' ? Math.max(0, netCreditCents - creditCents) : 0;
        const returnCreditAppliedToProductsCents = Math.min(
          creditCents,
          remainingProductCents
        );
        const productPaidCents = Math.max(
          0,
          remainingProductCents - returnCreditAppliedToProductsCents
        );

        const finalCaptureCents = Math.max(0, authorizedCents - creditCents);

        // If capture would be 0, void the authorization instead of capturing 0.
        if (finalCaptureCents === 0) {
          try {
            await stripe.paymentIntents.cancel(pi);
          } catch {
            // ignore
          }

          if (authorizedCents > 0) {
            await recordAuditLog({
              type: 'ORDER_PAYMENT_VOIDED',
              actorId: req.user?.username || req.user?.id || 'UNKNOWN',
              details: `Stripe authorization for order ${orderId} voided. Authorized: $${(
                authorizedCents / 100
              ).toFixed(2)}. Net return credit $${verifiedReturnCredit.toFixed(2)} covered the cost.`
            });
          }

          order.status = 'PAID';
          order.paidAt = new Date();
          order.capturedAt = new Date();
          order.amountCapturedCents = 0;
          order.verifiedReturnCredit = verifiedReturnCredit;
          order.verifiedReturnCreditGross = verifiedCredit.gross;
          order.verifiedReturnUpcs = verifiedReturnUpcs;
          order.verifiedReturnUpcCounts = verifiedReturnUpcCounts;
          order.returnPayoutMethod = payoutMethod;

          const creditResult = await applyWalletCredit(
            { order, walletCreditCents, payoutMethod },
            { session: sessionDb, actorId: req.user?.username || req.user?.id || '' }
          );
          ({ creditedUserId, creditedAmount } = creditResult);

          await awardLoyaltyPoints({
            order,
            user: payoutUser,
            productPaidCents,
            session: sessionDb
          });

          if (payoutMethod === 'CASH' && verifiedReturnCredit > 0) {
            await CashPayout.create(
              [
                {
                  orderId: order.orderId,
                  userId: order.customerId,
                  driverId: order.driverId || '',
                  amount: verifiedReturnCredit,
                  createdBy: req.user?.username || req.user?.id || ''
                }
              ],
              { session: sessionDb }
            );
            cashPayoutAmount = verifiedReturnCredit;
            cashPayoutUserId = order.customerId;
          }

          await order.save({ session: sessionDb });
          updatedOrderDoc = order;
          return;
        }

        let captured;
        try {
          captured = await stripe.paymentIntents.capture(pi, {
            amount_to_capture: finalCaptureCents
          });
        } catch (err) {
          if (err.code === 'payment_intent_unexpected_state') {
            // The payment intent may have been canceled or already captured.
            // We can fetch the latest state to confirm.
            const intent = await stripe.paymentIntents.retrieve(pi);
            if (intent.status !== 'succeeded') throw err;
          } else throw err;
        }

        if (captured) {
          await recordAuditLog({
            type: 'ORDER_PAYMENT_CAPTURED',
            actorId: req.user?.username || req.user?.id || 'UNKNOWN',
            details: `Stripe payment captured for order ${orderId}. Amount: $${(
              finalCaptureCents / 100
            ).toFixed(2)}. Authorized: $${(authorizedCents / 100).toFixed(
              2
            )}. Net return credit: $${verifiedReturnCredit.toFixed(2)}.`
          });
        }
        order.status = 'PAID';
        order.paidAt = new Date();
        order.capturedAt = new Date();
        order.amountCapturedCents = Number(captured?.amount_received || finalCaptureCents);
        order.verifiedReturnCredit = verifiedReturnCredit;
        order.verifiedReturnCreditGross = verifiedCredit.gross;
        order.verifiedReturnUpcs = verifiedReturnUpcs;
        order.verifiedReturnUpcCounts = verifiedReturnUpcCounts;
        order.returnPayoutMethod = payoutMethod;

        const creditResult = await applyWalletCredit(
          { order, walletCreditCents, payoutMethod },
          { session: sessionDb, actorId: req.user?.username || req.user?.id || '' }
        );
        ({ creditedUserId, creditedAmount } = creditResult);

        await awardLoyaltyPoints({
          order,
          user: payoutUser,
          productPaidCents,
          session: sessionDb
        });

        if (payoutMethod === 'CASH' && verifiedReturnCredit > 0) {
          await CashPayout.create(
            [
              {
                orderId: order.orderId,
                userId: order.customerId,
                driverId: order.driverId || '',
                amount: verifiedReturnCredit,
                createdBy: req.user?.username || req.user?.id || ''
              }
            ],
            { session: sessionDb }
          );
          cashPayoutAmount = verifiedReturnCredit;
          cashPayoutUserId = order.customerId;
        }

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      });

      if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

      const responseOrder = mapOrderForFrontend(updatedOrderDoc);

      if (cashPayoutAmount > 0 && cashPayoutUserId) {
        await recordAuditLog({
          type: 'CASH_PAYOUT_CREATED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Cash payout for order ${orderId} created for user ${cashPayoutUserId}: $${Number(
            cashPayoutAmount || 0
          ).toFixed(2)}.`
        });
      }

      if (creditedUserId && creditedAmount) {
        await recordAuditLog({
          type: 'CREDIT_ADJUSTED',
          actorId: req.user?.username || req.user?.id || 'UNKNOWN',
          details: `Applied $${creditedAmount.toFixed(2)} return credit remainder for order ${orderId}.`
        });
      }

      res.json({
        ok: true,
        order: responseOrder,
        cashPayoutAmount
      });
    } catch (err) {
      const message = err?.message || 'Failed to capture payment';
      if (err?.code === 'STAFF_REQUIRED') return res.status(403).json({ error: message });
      if (err?.code === 'DRIVER_MISMATCH') return res.status(403).json({ error: message });
      if (err?.code === 'ORDER_CANCELED') return res.status(400).json({ error: message });
      if (err?.code === 'NO_PAYMENT_INTENT') return res.status(400).json({ error: message });
      console.error('CAPTURE ERROR:', err);
      res.status(500).json({ error: message });
    } finally {
      sessionDb.endSession();
    }
  });

  return router;
};

export default createPaymentsRouter;
