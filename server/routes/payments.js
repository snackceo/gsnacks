import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';

import {
  authRequired,
  normalizeCart
} from '../utils/helpers.js';

import { isDbReady } from '../db/connect.js';
import { getDeliveryOptions } from '../utils/deliveryFees.js';
import { normalizeTier } from '../services/tierService.js';

const createPaymentsRouter = ({ stripe }) => {
  const router = express.Router();

  /**
   * =========================
   * QUOTE
   * =========================
   */
  router.post('/quote', async (req, res) => {
    try {
      if (!isDbReady()) {
        return res.status(503).json({ error: 'Database not ready' });
      }

      const items = normalizeCart(req.body.items || []);
      const userId = req.body.userId;
      const address = req.body.address || '';

      if (!items.length) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const user = userId ? await User.findById(userId) : null;
      const tier = normalizeTier(user?.membershipTier);

      const {
        routeFee,
        routeFeeCents,
        distanceFee,
        distanceFeeCents,
        largeOrderFeeCents,
        heavyItemFeeCents
      } = await getDeliveryOptions({
        orderType: 'DELIVERY_PURCHASE',
        tier,
        distanceMiles: 0,
        items,
        productsByFrontendId: new Map()
      });

      let subtotalCents = 0;

      for (const item of items) {
        const product = await Product.findOne({ frontendId: item.productId });

        if (!product) {
          return res.status(400).json({ error: `Invalid product ${item.productId}` });
        }

        subtotalCents += Math.round(product.price * 100) * item.quantity;
      }

      const totalCents =
        subtotalCents +
        routeFeeCents +
        distanceFeeCents +
        largeOrderFeeCents +
        heavyItemFeeCents;

      return res.json({
        subtotal: subtotalCents / 100,
        total: totalCents / 100,
        routeFee,
        distanceFee,
        largeOrderFee: largeOrderFeeCents / 100,
        heavyItemFee: heavyItemFeeCents / 100
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Quote failed' });
    }
  });

  /**
   * =========================
   * CREATE SESSION
   * =========================
   */
  router.post('/create-session', async (req, res) => {
    const session = await mongoose.startSession();

    try {
      if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
      }

      const items = normalizeCart(req.body.items || []);
      const userId = req.body.userId;
      const address = req.body.address || '';

      if (!items.length) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const user = userId ? await User.findById(userId) : null;
      const tier = normalizeTier(user?.membershipTier);

      let lineItems = [];
      let subtotalCents = 0;

      await session.withTransaction(async () => {
        for (const item of items) {
          const product = await Product.findOneAndUpdate(
            { frontendId: item.productId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { new: true, session }
          );

          if (!product) {
            throw new Error(`Out of stock: ${item.productId}`);
          }

          const priceCents = Math.round(product.price * 100);

          subtotalCents += priceCents * item.quantity;

          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: product.name },
              unit_amount: priceCents
            },
            quantity: item.quantity
          });
        }
      });

      const fees = await getDeliveryOptions({
        orderType: 'DELIVERY_PURCHASE',
        tier,
        distanceMiles: 0,
        items,
        productsByFrontendId: new Map()
      });

      const totalCents =
        subtotalCents +
        fees.routeFeeCents +
        fees.distanceFeeCents +
        fees.largeOrderFeeCents +
        fees.heavyItemFeeCents;

      const orderId = crypto.randomUUID();

      await Order.create({
        orderId,
        customerId: userId || 'GUEST',
        items,
        subtotal: subtotalCents / 100,
        total: totalCents / 100,
        routeFeeFinal: fees.routeFee,
        distanceFeeFinal: fees.distanceFee,
        largeOrderFee: fees.largeOrderFeeCents / 100,
        heavyItemFee: fees.heavyItemFeeCents / 100,
        status: 'PENDING'
      });

      const stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: 'http://localhost:5173/success',
        cancel_url: 'http://localhost:5173/cancel'
      });

      res.json({ sessionUrl: stripeSession.url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Checkout failed' });
    } finally {
      session.endSession();
    }
  });

  return router;
};

export default createPaymentsRouter;
