import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import UpcItem from '../models/UpcItem.js';
import {
  authRequired,
  mapOrderForFrontend,
  normalizeCart,
  ownerRequired
} from '../utils/helpers.js';

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

      const incomingUpcs = Array.isArray(req.body?.returnUpcs) ? req.body.returnUpcs : [];
      const returnUpcs = incomingUpcs.map(String).map(s => s.trim()).filter(Boolean);

      let eligibleUpcs = [];
      let ineligibleUpcs = [];
      let estimatedCreditFromUpcs = 0;

      if (returnUpcs.length > 0) {
        const upcEntries = await UpcItem.find({ upc: { $in: returnUpcs } }).lean();
        const upcByCode = new Map(upcEntries.map(entry => [entry.upc, entry]));

        for (const upc of returnUpcs) {
          const entry = upcByCode.get(upc);
          if (entry?.isEligible) {
            eligibleUpcs.push(upc);
            estimatedCreditFromUpcs += Number(entry.depositValue || 0);
          } else {
            ineligibleUpcs.push(upc);
          }
        }
      }

      const dailyCap = Number(process.env.DAILY_RETURN_CAP || 25); // dollars
      const computedEstimatedCredit = Math.min(estimatedCreditFromUpcs, dailyCap);

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

        await Order.create(
          [
            {
              orderId,
              customerId: userId || 'GUEST',
              address: address || '',
              items,
              total: totalCents / 100,

              returnUpcs: eligibleUpcs,
              estimatedReturnCredit: computedEstimatedCredit,
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
   * POST /api/payments/capture (owner-only)
   * - Driver submits verifiedReturnCredit
   * - Server captures final amount = authorized - verified credit (never increases)
   */
  router.post('/capture', authRequired, ownerRequired, async (req, res) => {
    const sessionDb = await mongoose.startSession();

    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const orderId = String(req.body?.orderId || '').trim();
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });

      const incomingUpcs = Array.isArray(req.body?.verifiedReturnUpcs)
        ? req.body.verifiedReturnUpcs
        : [];
      const verifiedReturnUpcs = incomingUpcs.map(String).map(s => s.trim()).filter(Boolean);
      const uniqueVerifiedReturnUpcs = [...new Set(verifiedReturnUpcs)];

      let verifiedReturnCredit = 0;
      if (uniqueVerifiedReturnUpcs.length > 0) {
        const upcEntries = await UpcItem.find({
          upc: { $in: uniqueVerifiedReturnUpcs },
          isEligible: true
        }).lean();

        verifiedReturnCredit = upcEntries.reduce(
          (sum, entry) => sum + Number(entry?.depositValue || 0),
          0
        );
      }

      let updatedOrderDoc = null;

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;

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
          order.verifiedReturnUpcs = uniqueVerifiedReturnUpcs;

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
        order.verifiedReturnUpcs = uniqueVerifiedReturnUpcs;

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      });

      if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

      res.json({ ok: true, order: mapOrderForFrontend(updatedOrderDoc) });
    } catch (err) {
      if (err?.code === 'ORDER_CANCELED') return res.status(400).json({ error: err.message });
      if (err?.code === 'NO_PAYMENT_INTENT') return res.status(400).json({ error: err.message });

      console.error('CAPTURE ERROR:', err);
      res.status(500).json({ error: 'Failed to capture payment' });
    } finally {
      sessionDb.endSession();
    }
  });

  return router;
};

export default createPaymentsRouter;
