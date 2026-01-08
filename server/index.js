import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

import User from './models/User.js';

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
   MODELS (Product/Order inline for now)
========================= */
const productSchema = new mongoose.Schema({
  frontendId: { type: String, required: true, unique: true }, // IMPORTANT
  name: { type: String, required: true },
  price: { type: Number, required: true },
  deposit: { type: Number, default: 0 },
  stock: { type: Number, default: 0 }
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true }, // we store our UUID here
  customerId: { type: String, default: 'GUEST' },
  items: [
    {
      productId: { type: String, required: true }, // frontendId
      quantity: { type: Number, required: true }
    }
  ],
  total: { type: Number, required: true },
  paymentMethod: { type: String, default: 'STRIPE' },
  status: { type: String, default: 'PENDING' },
  paidAt: { type: Date }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

/* =========================
   STRIPE WEBHOOK (RAW BODY)
   Must be before JSON parser
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   CORS (must allow credentials for cookies)
========================= */
const allowedOrigins = [
  'https://ninposnacks.com',
  'https://www.ninposnacks.com',
  // Your Render frontend (if different):
  'https://gsnacks.onrender.com',
  // Local dev:
  'http://localhost:5173'
];

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser requests (like curl/postman) where origin is undefined
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

/* =========================
   MIDDLEWARE
========================= */
app.use(cookieParser());

// IMPORTANT: Do NOT run JSON parser on webhook route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  return express.json()(req, res, next);
});

/* =========================
   HELPERS
========================= */
const isProd = process.env.NODE_ENV === 'production';

function setAuthCookie(res, token) {
  // Cross-site cookie (frontend domain != backend domain) requires:
  // sameSite: 'none' AND secure: true
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isProd,         // true on Render/production (https)
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearAuthCookie(res) {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  });
}

function authRequired(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

/* =========================
   HEALTH CHECK
========================= */
app.get('/', (_, res) => {
  res.send('NINPO MAINFRAME ONLINE');
});

app.get('/api/sync', (_, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

/* =========================
   AUTH
========================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const user = await User.create({ username, password });

    // Create session immediately after register
    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);
    res.json({ ok: true, user: { id: user._id.toString(), username: user.username } });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);
    res.json({ ok: true, user: { id: user._id.toString(), username: user.username } });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ ok: true, user: req.user });
});

/* =========================
   CREATE STRIPE SESSION
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const { items, userId } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const lineItems = [];
    let totalCents = 0;

    for (const item of items) {
      const product = await Product.findOne({ frontendId: item.productId });
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }

      const unit = Math.round(product.price * 100);
      totalCents += unit * item.quantity;

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: product.name },
          unit_amount: unit
        },
        quantity: item.quantity
      });
    }

    const orderId = crypto.randomUUID();

    await Order.create({
      orderId,
      customerId: userId || 'GUEST',
      items,
      total: totalCents / 100,
      paymentMethod: 'STRIPE',
      status: 'PENDING'
    });

    const frontendUrl =
      process.env.FRONTEND_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { orderId },
      success_url: `${frontendUrl}/success`,
      cancel_url: `${frontendUrl}/cancel`
    });

    res.json({ sessionUrl: session.url });
  } catch (err) {
    console.error('STRIPE SESSION ERROR:', err);
    res.status(500).json({ error: 'Stripe session failed' });
  }
});

/* =========================
   STRIPE WEBHOOK
========================= */
app.post('/api/stripe/webhook', async (req, res) => {
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        await Order.findOneAndUpdate(
          { orderId },
          { status: 'PAID', paidAt: new Date() }
        );
        console.log(`ORDER PAID: ${orderId}`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK ERROR:', err);
    res.status(500).send('Webhook handler error');
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
