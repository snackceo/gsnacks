import mongoose from 'mongoose';
import stripe from 'stripe';
import dotenv from 'dotenv';

import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { recordAuditLog } from '../utils/audit.js';

// Load environment variables
dotenv.config();

const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY);

// Hours to wait before an order is considered abandoned.
const ABANDONED_THRESHOLD_HOURS = 4;

/**
 * Restocks items for a given order within a database session.
 */
const restockOrderItems = async (order, session) => {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return;
  }

  const stockUpdates = order.items.map(item => ({
    updateOne: {
      filter: { frontendId: item.productId },
      update: { $inc: { stock: item.quantity } }
    }
  }));

  if (stockUpdates.length > 0) {
    await Product.bulkWrite(stockUpdates, { session });
  }
};

const cleanupAbandonedOrders = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not found in environment variables.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const cutoffDate = new Date(Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000);

  const abandonedOrders = await Order.find({
    status: { $in: ['PENDING', 'AUTHORIZED'] },
    stripePaymentIntentId: { $exists: true, $ne: null },
    createdAt: { $lt: cutoffDate },
    capturedAt: { $exists: false },
    canceledAt: { $exists: false }
  });

  if (abandonedOrders.length === 0) {
    console.log('No abandoned orders to clean up.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${abandonedOrders.length} abandoned orders to process.`);

  for (const order of abandonedOrders) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Cancel the Stripe Payment Intent
        try {
          await stripeClient.paymentIntents.cancel(order.stripePaymentIntentId);
        } catch (stripeError) {
          // Ignore errors if the intent is already canceled or in a non-cancelable state
          if (stripeError.code !== 'payment_intent_unexpected_state') {
            throw stripeError;
          }
        }

        // 2. Restock inventory
        await restockOrderItems(order, session);

        // 3. Update the order status
        order.status = 'CANCELED';
        order.canceledAt = new Date();
        order.inventoryReleasedAt = new Date();
        order.cancelReason = 'abandoned_checkout';
        await order.save({ session });

        await recordAuditLog({
          type: 'ORDER_CANCELED',
          actorId: 'SYSTEM_CLEANUP',
          details: `Order ${order.orderId} automatically canceled due to abandoned checkout.`
        });

        console.log(`Canceled and restocked order ${order.orderId}.`);
      });
    } catch (error) {
      console.error(`Failed to process order ${order.orderId}:`, error);
    } finally {
      session.endSession();
    }
  }

  await mongoose.disconnect();
  console.log('Finished cleanup process.');
};

cleanupAbandonedOrders();