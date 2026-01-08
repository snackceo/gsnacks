import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   STRIPE
========================= */
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/* =========================
   MONGO DB
========================= */
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log("MongoDB Connected");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

/* =========================
   MONGOOSE MODELS
========================= */

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  deposit: { type: Number, required: true },
  stock: { type: Number, required: true },
});

const Product = mongoose.model('Product', productSchema);

// Order Schema
const orderSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  items: [{
    productId: { type: String, required: true },
    quantity: { type: Number, required: true }
  }],
  total: { type: Number, required: true },
  paymentMethod: { type: String, required: true },
  status: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Order = mongoose.model('Order', orderSchema);

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    return next();
  }
  express.json()(req, res, next);
});

/* =========================
   CREATE STRIPE SESSION
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const { items, userId } = req.body;

  if (!Array.isArray(items) || items.length === 0 || !userId) {
    console.error('INVALID PAYLOAD:', req.body);
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  let totalCents = 0;
  const lineItems = [];

  try {
    // Fetch product data from MongoDB
    for (const item of items) {
      // Correctly create ObjectId using `new`
      const productId = new mongoose.Types.ObjectId(item.productId);
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(400).json({
          error: `Invalid product: ${item.productId}`,
        });
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: product.name },
          unit_amount: Math.round(product.price * 100),
        },
        quantity: item.quantity,
      });

      totalCents += Math.round(product.price * 100) * item.quantity;
    }

    const orderId = crypto.randomUUID();

    const newOrder = new Order({
      customerId: userId,
      items,
      total: totalCents / 100,
      paymentMethod: 'STRIPE_CARD',
      status: 'PENDING',
    });

    await newOrder.save();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { orderId, userId },
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/cancel`,
    });

    res.json({ sessionUrl: session.url });
  } catch (err) {
    console.error('STRIPE ERROR:', err);
    res.status(500).json({ error: 'Stripe session creation failed', details: err.message });
  }
});

/* =========================
   STRIPE WEBHOOK
========================= */
app.post('/api/stripe/webhook', async (req, res) => {
  if (!stripe || !webhookSecret) {
    return res.status(500).send('Webhook not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed');
    return res.status(400).send('Invalid signature');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    const order = await Order.findById(orderId);
    if (order) {
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      await order.save();
      console.log(`ORDER PAID: ${orderId}`);
    }
  }

  res.json({ received: true });
});

/* =========================
   HEALTH CHECK
========================= */
app.get('/', (_, res) => {
  res.send('NINPO MAINFRAME ONLINE');
});

app.get('/api/sync', (_, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
  });
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
