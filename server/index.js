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
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

/* =========================
   MODELS
========================= */
const productSchema = new mongoose.Schema({
  frontendId: { type: String, required: true, unique: true },
  name: String,
  price: Number,
  deposit: Number,
  stock: Number
});

const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  customerId: String,
  items: Array,
  total: Number,
  paymentMethod: String,
  status: String,
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   MIDDLEWARE
========================= */
app.use(cors({ origin: '*' }));

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  express.json()(req, res, next);
});

/* =========================
   CREATE STRIPE SESSION
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  try {
    const { items, userId } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const lineItems = [];
    let totalCents = 0;

    for (const item of items) {
      // MATCH BY frontendId — NOT ObjectId
      const product = await Product.findOne({ frontendId: item.productId });

      if (!product) {
        return res.status(400).json({
          error: `Product not found: ${item.productId}`
        });
      }

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: product.name },
          unit_amount: Math.round(product.price * 100)
        },
        quantity: item.quantity
      });

      totalCents += Math.round(product.price * 100) * item.quantity;
    }

    const orderId = crypto.randomUUID();

    await Order.create({
      customerId: userId || 'GUEST',
      items,
      total: totalCents / 100,
      paymentMethod: 'STRIPE',
      status: 'PENDING'
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { orderId },
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/cancel`
    });

    res.json({ sessionUrl: session.url });
  } catch (err) {
    console.error('STRIPE ERROR:', err);
    res.status(500).json({ error: 'Stripe session failed' });
  }
});

/* =========================
   STRIPE WEBHOOK
========================= */
app.post('/api/stripe/webhook', (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      webhookSecret
    );
  } catch (err) {
    return res.status(400).send('Invalid signature');
  }

  if (event.type === 'checkout.session.completed') {
    console.log('Payment completed');
  }

  res.json({ received: true });
});

/* =========================
   HEALTH CHECK
========================= */
app.get('/', (_, res) => {
  res.send('NINPO MAINFRAME ONLINE');
});

app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
