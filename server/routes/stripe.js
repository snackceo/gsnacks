import express from 'express';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import {
  releaseCreditAuthorization,
  voidStripeAuthorizationBestEffort
} from '../utils/helpers.js';

const createStripeRouter = ({ stripe, webhookSecret }) => {
  const router = express.Router();

  /* =========================
     STRIPE WEBHOOK (AUTHORIZE / RESTOCK)
  ========================= */
  router.post('/webhook', async (req, res) => {
    const sessionDb = await mongoose.startSession();

    try {
      if (!stripe || !webhookSecret) {
        return res.status(500).send('Webhook not configured');
      }

      const sig = req.headers['stripe-signature'];
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err?.message);
        return res.status(400).send('Invalid signature');
      }

      const type = event.type;

      // Checkout complete => payment authorized (manual capture)
      if (type === 'checkout.session.completed') {
        const session = event.data.object;
        const orderId = session?.metadata?.orderId;

        if (orderId) {
          await sessionDb.withTransaction(async () => {
            const order = await Order.findOne({ orderId }).session(sessionDb);
            if (!order) return;

            if (order.status === 'CANCELED' || order.status === 'EXPIRED') {
              await voidStripeAuthorizationBestEffort(stripe, order);
              return;
            }

            const paymentIntentId = session?.payment_intent?.toString();

            order.stripeSessionId = order.stripeSessionId || session.id;
            if (paymentIntentId) {
              order.stripePaymentIntentId = order.stripePaymentIntentId || paymentIntentId;
            }
            order.authorizedAt = order.authorizedAt || new Date();
            if (order.status === 'PENDING') {
              order.status = 'AUTHORIZED';
            }

            await order.save({ session: sessionDb });
          });

          // ...existing code... (removed test/debug log)
        }

        res.json({ received: true });
        return;
      }

      // Session expired / payment failed: restock reserved items and expire order
      if (type === 'checkout.session.expired' || type === 'payment_intent.payment_failed') {
        const obj = event.data.object;
        const orderId = obj?.metadata?.orderId;

        if (orderId) {
          await sessionDb.withTransaction(async () => {
            const order = await Order.findOne({ orderId }).session(sessionDb);
            if (!order) return;

            if (order.status === 'PAID') return;
            if (order.inventoryReleasedAt) return;

            await releaseCreditAuthorization(order, sessionDb);

            order.status = 'EXPIRED';
            order.inventoryReleasedAt = new Date();
            order.expiredAt = new Date();
            order.cancelReason = order.cancelReason || 'stripe_expired_or_failed';

            await order.save({ session: sessionDb });

            await voidStripeAuthorizationBestEffort(stripe, order);
          });

          // ...existing code... (removed test/debug log)
        }

        res.json({ received: true });
        return;
      }

      res.json({ received: true });
    } catch (err) {
      console.error('WEBHOOK ERROR:', err);
      res.status(500).send('Webhook handler error');
    } finally {
      sessionDb.endSession();
    }
  });

  return router;
};

export default createStripeRouter;
