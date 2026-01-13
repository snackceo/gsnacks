import mongoose from 'mongoose';
import Order from '../models/Order.js'; // Adjust path as necessary
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const findAbandonedAuthorizations = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('MONGO_URI not found in environment variables.');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const abandonedOrders = await Order.find({
      status: 'PENDING',
      stripePaymentIntentId: { $exists: true, $ne: null },
      amountAuthorizedCents: { $gt: 0 }, // Ensure it's not a zero-value order
      capturedAt: { $exists: false },
      canceledAt: { $exists: false },
      // Optionally, add a time-based filter to only find older abandoned orders
      // For example, orders older than 24 hours:
      // createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).lean();

    if (abandonedOrders.length === 0) {
      console.log('No abandoned authorized orders found.');
    } else {
      console.log(`Found ${abandonedOrders.length} abandoned authorized orders:`);
      abandonedOrders.forEach(order => {
        console.log(
          `Order ID: ${order.orderId}, Customer ID: ${order.customerId}, ` +
          `Authorized Amount: $${(order.amountAuthorizedCents / 100).toFixed(2)}, ` +
          `Created At: ${order.createdAt}`
        );
      });
    }
  } catch (error) {
    console.error('Error finding abandoned authorized orders:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

findAbandonedAuthorizations();