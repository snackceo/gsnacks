import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';
import AppSettings from '../models/AppSettings.js';
import User from '../models/User.js';
import {
  authRequired,
  isDriverUsername,
  isOwnerUsername,
  calculateReturnFeeSummary,
  mapOrderForFrontend,
  normalizeCart,
  normalizeUpcCounts,
  sumReturnCredits
} from '../utils/helpers.js';
import { recordAuditLog } from '../utils/audit.js';

const deliveryDiscountsByTier = {
  BRONZE: 10,
  SILVER: 20,
  GOLD: 30,
  PLATINUM: 30
};
const CREDIT_DELIVERY_ELIGIBLE_TIERS = new Set(['GOLD', 'PLATINUM']);
const DEFAULT_RETURN_FEES = {
  returnHandlingFeePerContainer: 0.02,
  glassHandlingFeePerContainer: 0.02
};

const getDeliveryFeeDiscountPercent = tier => {
  const normalizedTier = String(tier || '').trim().toUpperCase();
  return deliveryDiscountsByTier[normalizedTier] ?? 0;
};

const applyDeliveryFeeDiscount = (deliveryFee, discountPercent) => {
  const fee = Math.max(0, Number(deliveryFee || 0));
  const percent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const discountedCents = Math.round(fee * (1 - percent / 100) * 100);
  return {
    deliveryFeeFinal: discountedCents / 100,
    deliveryFeeFinalCents: discountedCents
  };
};

const getReturnFeeConfig = async () => {
  const doc = await AppSettings.findOne({ key: 'default' }).lean();
  return {
    returnHandlingFeePerContainer: Number(
      doc?.returnHandlingFeePerContainer ?? DEFAULT_RETURN_FEES.returnHandlingFeePerContainer
    ),
    glassHandlingFeePerContainer: Number(
      doc?.glassHandlingFeePerContainer ?? DEFAULT_RETURN_FEES.glassHandlingFeePerContainer
    )
  };
};

const buildReturnPreview = async (rawUpcs) => {
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
        estimatedCreditFromUpcs += Number(entry.depositValue || 0) * quantity;
      } else {
        ineligibleUpcs.push(upc);
      }
    }

    const feeConfig = await getReturnFeeConfig();
    feeSummary = calculateReturnFeeSummary(eligibleUpcCounts, upcEntries, feeConfig);
  }

  const dailyCap = Number(process.env.DAILY_RETURN_CAP || 25); // dollars
  const computedEstimatedCredit = Math.min(estimatedCreditFromUpcs, dailyCap);
  const estimatedNetCredit = Math.max(0, computedEstimatedCredit - feeSummary.totalFee);
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

const createPaymentsRouter = ({ stripe }) => {
  const router = express.Router();

  /* =========================
     PAYMENTS
     Option 2: Authorize at checkout, capture after driver verification.
  ========================= */

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
      const deliveryFee = Math.max(0, Number(req.body?.deliveryFee || 0));
      const tierLookupUser = userId
        ? await User.findById(userId, { membershipTier: 1 }).session(sessionDb)
        : null;
      const deliveryFeeDiscountPercent = getDeliveryFeeDiscountPercent(
        tierLookupUser?.membershipTier
      );
      const { deliveryFeeFinal, deliveryFeeFinalCents } = applyDeliveryFeeDiscount(
        deliveryFee,
        deliveryFeeDiscountPercent
      );

      const { eligibleUpcs, eligibleUpcCounts, ineligibleUpcs, estimatedCredit } =
        await buildReturnPreview(req.body?.returnUpcCounts ?? req.body?.returnUpcs);

      const items = normalizeCart(rawItems);
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const orderId = crypto.randomUUID();
      const lineItems = [];
      let totalCents = 0;

      await sessionDb.withTransaction(async () => {
        for (const item of items) {
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

          const unit = Math.round(Number(updated.price) * 100);
          totalCents += unit * item.quantity;

          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: updated.name },
              unit_amount: unit
            },
            quantity: item.quantity
          });
        }

        if (deliveryFeeFinalCents > 0) {
          totalCents += deliveryFeeFinalCents;
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: 'Delivery fee' },
              unit_amount: deliveryFeeFinalCents
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
              total: totalCents / 100,
              deliveryFee,
              deliveryFeeDiscountPercent,
              deliveryFeeFinal,
              creditApplied: 0,

              returnUpcs: eligibleUpcs,
              returnUpcCounts: eligibleUpcCounts,
              estimatedReturnCreditGross: estimatedCredit.gross,
              estimatedReturnCredit: estimatedCredit.net,
              verifiedReturnCreditGross: 0,
              verifiedReturnCredit: 0,

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

      if (deliveryFeeFinalCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: userId || 'GUEST',
          details: `Order ${orderId} created with delivery fee $${deliveryFeeFinal.toFixed(
            2
          )} (${deliveryFeeDiscountPercent}% discount).`
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

    try {
      const rawItems = req.body?.items;
      const address = String(req.body?.address || '').trim();
      const deliveryFee = Math.max(0, Number(req.body?.deliveryFee || 0));

      const items = normalizeCart(rawItems);
      const { eligibleUpcs, eligibleUpcCounts, ineligibleUpcs, estimatedCredit } =
        await buildReturnPreview(req.body?.returnUpcCounts ?? req.body?.returnUpcs);
      const isReturnOnly = Array.isArray(items) && items.length === 0 && eligibleUpcs.length > 0;
      if ((!Array.isArray(items) || items.length === 0) && !isReturnOnly) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not logged in' });

      const user = await User.findById(userId).session(sessionDb);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const deliveryFeeDiscountPercent = getDeliveryFeeDiscountPercent(user?.membershipTier);
      let { deliveryFeeFinal, deliveryFeeFinalCents } = applyDeliveryFeeDiscount(
        deliveryFee,
        deliveryFeeDiscountPercent
      );
      if (isReturnOnly) {
        deliveryFeeFinal = 0;
        deliveryFeeFinalCents = 0;
      }

      const orderId = crypto.randomUUID();
      let totalCents = 0;
      let productSubtotalCents = 0;

      await sessionDb.withTransaction(async () => {
        if (!isReturnOnly) {
          for (const item of items) {
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

            const unit = Math.round(Number(updated.price) * 100);
            const lineTotal = unit * item.quantity;
            totalCents += lineTotal;
            productSubtotalCents += lineTotal;
          }
        }

        if (deliveryFeeFinalCents > 0) {
          totalCents += deliveryFeeFinalCents;
        }

        const tier = String(user?.membershipTier || 'BRONZE').toUpperCase();
        const eligibleCreditCents = CREDIT_DELIVERY_ELIGIBLE_TIERS.has(tier)
          ? totalCents
          : productSubtotalCents;
        const availableCreditsCents = Math.max(
          0,
          Math.round(Number(user.creditBalance || 0) * 100)
        );
        const creditAppliedCents = isReturnOnly
          ? 0
          : Math.min(availableCreditsCents, eligibleCreditCents);
        const remainingCents = Math.max(0, totalCents - creditAppliedCents);

        const creditApplied = creditAppliedCents / 100;
        if (creditAppliedCents > 0) {
          user.creditBalance = Math.max(0, Number(user.creditBalance || 0) - creditApplied);
          await user.save({ session: sessionDb });
        }

        await Order.create(
          [
            {
              orderId,
              customerId: userId,
              address: address || '',
              items,
              total: totalCents / 100,
              deliveryFee,
              deliveryFeeDiscountPercent,
              deliveryFeeFinal,
              creditApplied,
              paymentMethod: isReturnOnly ? 'CREDITS' : remainingCents > 0 ? 'STRIPE' : 'CREDITS',
              status: isReturnOnly ? 'PENDING' : remainingCents > 0 ? 'PENDING' : 'PAID',
              amountAuthorizedCents: remainingCents,
              amountCapturedCents: remainingCents > 0 ? 0 : 0,
              paidAt: isReturnOnly || remainingCents > 0 ? undefined : new Date(),
              capturedAt: isReturnOnly || remainingCents > 0 ? undefined : new Date(),

              returnUpcs: eligibleUpcs,
              returnUpcCounts: eligibleUpcCounts,
              estimatedReturnCreditGross: estimatedCredit.gross,
              estimatedReturnCredit: estimatedCredit.net,
              verifiedReturnCreditGross: 0,
              verifiedReturnCredit: 0
            }
          ],
          { session: sessionDb }
        );
      });

      const remainingOrder = await Order.findOne({ orderId }).lean();
      if (!remainingOrder) return res.status(404).json({ error: 'Order not found' });

      const remainingCents = Number(remainingOrder.amountAuthorizedCents || 0);

      if (deliveryFeeFinalCents > 0) {
        await recordAuditLog({
          type: 'ORDER_CREATED',
          actorId: req.user?.username || req.user?.id || userId,
          details: `Order ${orderId} created with delivery fee $${deliveryFeeFinal.toFixed(
            2
          )} (${deliveryFeeDiscountPercent}% discount).`
        });
      }

      if (remainingOrder.creditApplied > 0) {
        await recordAuditLog({
          type: 'CREDIT_ADJUSTED',
          actorId: req.user?.username || req.user?.id || userId,
          details: `Applied $${Number(remainingOrder.creditApplied || 0).toFixed(
            2
          )} credits to order ${orderId}. Balance: $${Number(
            user.creditBalance || 0
          ).toFixed(2)}.`
        });
      }

      const uniqueIneligibleUpcs = [...new Set(ineligibleUpcs)];

      if (remainingCents === 0) {
        const responsePayload = {
          ok: true,
          order: mapOrderForFrontend(remainingOrder),
          creditBalance: Number(user.creditBalance || 0)
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
        creditsApplied: Number(remainingOrder.creditApplied || 0),
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

      res.status(500).json({ error: 'Credits checkout failed' });
    } finally {
      sessionDb.endSession();
    }
  });

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

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;

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
          const feeConfig = await getReturnFeeConfig();
          const feeSummary = calculateReturnFeeSummary(
            normalized.upcCounts,
            upcEntries,
            feeConfig
          );
          const netCredit = Math.max(0, verifiedReturnCreditGross - feeSummary.totalFee);
          verifiedCredit = {
            gross: verifiedReturnCreditGross,
            net: netCredit
          };
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
        const creditCents = Math.round(verifiedReturnCredit * 100);

        const finalCaptureCents = Math.max(0, authorizedCents - creditCents);

        // If capture would be 0, void the authorization instead of capturing 0.
        if (finalCaptureCents === 0) {
          try {
            await stripe.paymentIntents.cancel(pi);
          } catch {
            // ignore
          }

          order.status = 'PAID';
          order.paidAt = new Date();
          order.capturedAt = new Date();
          order.amountCapturedCents = 0;
          order.verifiedReturnCredit = verifiedReturnCredit;
          order.verifiedReturnCreditGross = verifiedCredit.gross;
          order.verifiedReturnUpcs = verifiedReturnUpcs;
          order.verifiedReturnUpcCounts = verifiedReturnUpcCounts;

          await order.save({ session: sessionDb });
          updatedOrderDoc = order;
          return;
        }

        const captured = await stripe.paymentIntents.capture(pi, {
          amount_to_capture: finalCaptureCents
        });

        order.status = 'PAID';
        order.paidAt = new Date();
        order.capturedAt = new Date();
        order.amountCapturedCents = Number(captured?.amount_received || finalCaptureCents);
        order.verifiedReturnCredit = verifiedReturnCredit;
        order.verifiedReturnCreditGross = verifiedCredit.gross;
        order.verifiedReturnUpcs = verifiedReturnUpcs;
        order.verifiedReturnUpcCounts = verifiedReturnUpcCounts;

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      });

      if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

      await recordAuditLog({
        type: 'ORDER_UPDATED',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: `Order ${orderId} payment captured.`
      });

      res.json({ ok: true, order: mapOrderForFrontend(updatedOrderDoc) });
    } catch (err) {
      if (err?.code === 'ORDER_CANCELED') return res.status(400).json({ error: err.message });
      if (err?.code === 'NO_PAYMENT_INTENT') return res.status(400).json({ error: err.message });
      if (err?.code === 'STAFF_REQUIRED') return res.status(403).json({ error: err.message });
      if (err?.code === 'DRIVER_MISMATCH') return res.status(403).json({ error: err.message });

      console.error('CAPTURE ERROR:', err);
      res.status(500).json({ error: 'Failed to capture payment' });
    } finally {
      sessionDb.endSession();
    }
  });

  return router;
};

export default createPaymentsRouter;
