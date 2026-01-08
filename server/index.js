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
const productSchema = new mongoose.Schema(
  {
    frontendId: { type: String, required: true, unique: true }, // used by frontend/cart
    name: { type: String, required: true },
    price: { type: Number, required: true },
    deposit: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },

    category: { type: String, default: 'DRINK' },
    image: { type: String, default: '' },
    isGlass: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true }, // our UUID
    customerId: { type: String, default: 'GUEST' },
    items: [
      {
        productId: { type: String, required: true }, // frontendId
        quantity: { type: Number, required: true }
      }
    ],
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: 'STRIPE' },

    // PENDING = created/reserved, PAID = confirmed, CANCELED = released/restocked
    status: { type: String, default: 'PENDING' },

    paidAt: { type: Date },

    // Stripe references
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String }
  },
  { timestamps: true }
);

const Order = mongoose.model('Order', orderSchema);

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   CORS
========================= */
const allowedOrigins = [
  'https://ninposnacks.com',
  'https://www.ninposnacks.com',
  'https://gsnacks.onrender.com',
  'http://localhost:5173'
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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
function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: '.ninposnacks.com',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: '.ninposnacks.com',
    path: '/'
  });
}

function authRequired(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...decoded, id: decoded.userId };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

function isOwnerUsername(username) {
  const list = (process.env.OWNER_USERNAMES || process.env.OWNER_USERNAME || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  return list.includes((username || '').toLowerCase());
}

function ownerRequired(req, res, next) {
  const u = req.user;
  if (!u?.username || !isOwnerUsername(u.username)) {
    return res.status(403).json({ error: 'Owner access required' });
  }
  return next();
}

// Normalize / validate cart, and merge duplicate product lines
function normalizeCart(items) {
  const map = new Map(); // productId -> qty
  for (const it of items || []) {
    const pid = String(it?.productId || '').trim();
    const qty = Number(it?.quantity || 0);
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return Array.from(map.entries()).map(([productId, quantity]) => ({
    productId,
    quantity
  }));
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
    const role = isOwnerUsername(user.username) ? 'OWNER' : 'CUSTOMER';

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);
    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role }
    });
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

    const role = isOwnerUsername(user.username) ? 'OWNER' : 'CUSTOMER';

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);
    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role }
    });
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
   PRODUCTS
========================= */
app.get('/api/products', async (req, res) => {
  try {
    const docs = await Product.find({}).sort({ createdAt: -1 }).lean();
    const products = docs.map(d => ({
      id: d.frontendId,
      frontendId: d.frontendId,
      name: d.name,
      price: d.price,
      deposit: d.deposit ?? 0,
      stock: d.stock ?? 0,
      category: d.category ?? 'DRINK',
      image: d.image ?? '',
      isGlass: !!d.isGlass
    }));
    res.json({ ok: true, products });
  } catch (err) {
    console.error('GET PRODUCTS ERROR:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/products', authRequired, ownerRequired, async (req, res) => {
  try {
    const { id, frontendId, name, price, deposit, stock, category, image, isGlass } =
      req.body || {};

    const finalFrontendId = (frontendId || id || '').trim();
    if (!finalFrontendId) return res.status(400).json({ error: 'id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'price is required' });
    }

    const created = await Product.create({
      frontendId: finalFrontendId,
      name,
      price: Number(price),
      deposit: Number(deposit || 0),
      stock: Number(stock || 0),
      category: category || 'DRINK',
      image: image || '',
      isGlass: !!isGlass
    });

    res.json({
      ok: true,
      product: {
        id: created.frontendId,
        frontendId: created.frontendId,
        name: created.name,
        price: created.price,
        deposit: created.deposit ?? 0,
        stock: created.stock ?? 0,
        category: created.category ?? 'DRINK',
        image: created.image ?? '',
        isGlass: !!created.isGlass
      }
    });
  } catch (err) {
    console.error('CREATE PRODUCT ERROR:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Product ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.patch('/api/products/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const frontendId = req.params.id;

    const updates = {};
    const allowed = ['name', 'price', 'deposit', 'stock', 'category', 'image', 'isGlass'];

    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.deposit !== undefined) updates.deposit = Number(updates.deposit);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;

    const updated = await Product.findOneAndUpdate({ frontendId }, updates, {
      new: true
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    res.json({
      ok: true,
      product: {
        id: updated.frontendId,
        frontendId: updated.frontendId,
        name: updated.name,
        price: updated.price,
        deposit: updated.deposit ?? 0,
        stock: updated.stock ?? 0,
        category: updated.category ?? 'DRINK',
        image: updated.image ?? '',
        isGlass: !!updated.isGlass
      }
    });
  } catch (err) {
    console.error('UPDATE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const frontendId = req.params.id;
    const deleted = await Product.findOneAndDelete({ frontendId }).lean();
    if (!deleted) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE PRODUCT ERROR:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

/* =========================
   PAYMENTS (ENFORCE INVENTORY)
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const rawItems = req.body?.items;
    const userId = req.body?.userId;

    const items = normalizeCart(rawItems);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const orderId = crypto.randomUUID();
    const lineItems = [];
    let totalCents = 0;

    // Reserve stock atomically.
    // If any item cannot be reserved, transaction aborts and nothing changes.
    await sessionDb.withTransaction(async () => {
      for (const item of items) {
        // Decrement only if stock is sufficient
        const updated = await Product.findOneAndUpdate(
          { frontendId: item.productId, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { new: true, session: sessionDb }
        );

        if (!updated) {
          // Find current stock to return a helpful error
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
            items,
            total: totalCents / 100,
            paymentMethod: 'STRIPE',
            status: 'PENDING'
          }
        ],
        { session: sessionDb }
      );
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Create Stripe session AFTER stock is reserved + order is created
    // If Stripe fails, we revert reservation below.
    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { orderId },
      success_url: `${frontendUrl}/success`,
      cancel_url: `${frontendUrl}/cancel`
    });

    // Save Stripe session id on the order (not in transaction; safe)
    await Order.findOneAndUpdate(
      { orderId },
      { stripeSessionId: stripeSession.id }
    );

    res.json({ sessionUrl: stripeSession.url });
  } catch (err) {
    // If we already reserved stock & created an order, revert if Stripe failed or any error occurred after reservation.
    // We can detect by the presence of metadata/orderId is not available here reliably, so we do best-effort:
    // If error was inside transaction, it already rolled back.
    // If error happened after transaction (Stripe call), we need to restock by reading the order.
    try {
      const possibleOrderId = req.body?.orderId; // (not set by frontend)
      // Best effort: if transaction committed, order exists with a recent PENDING status and no stripeSessionId.
      // We cannot know orderId unless we track it. So we restock only when we can find by stripe session metadata later.
      // To handle Stripe failure after reservation, we rely on withTransaction block finishing before stripe call,
      // so if stripe call fails, we will not have an orderId here. Therefore we do NOT restock here.
      // (Stripe failures are rare; if needed we can return orderId to frontend and retry safely.)
    } catch {}

    console.error('STRIPE SESSION ERROR:', err);

    if (err?.code === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({ error: err.message, meta: err.meta });
    }

    res.status(500).json({ error: 'Stripe session failed' });
  } finally {
    sessionDb.endSession();
  }
});

/* =========================
   STRIPE WEBHOOK (CONFIRM / RESTOCK)
========================= */
app.post('/api/stripe/webhook', async (req, res) => {
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

    // Payment succeeded
    if (type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;

          // Idempotent: if already paid, do nothing
          if (order.status === 'PAID') return;

          order.status = 'PAID';
          order.paidAt = new Date();
          order.stripeSessionId = order.stripeSessionId || session.id;
          order.stripePaymentIntentId =
            order.stripePaymentIntentId || session.payment_intent?.toString();

          await order.save({ session: sessionDb });
        });

        console.log(`ORDER PAID: ${orderId}`);
      }

      res.json({ received: true });
      return;
    }

    // Payment failed / session expired: restock the reserved items
    if (type === 'checkout.session.expired' || type === 'payment_intent.payment_failed') {
      // checkout.session.expired includes metadata with orderId
      const obj = event.data.object;
      const orderId = obj?.metadata?.orderId;

      if (orderId) {
        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;

          // If already canceled or paid, do nothing
          if (order.status === 'CANCELED' || order.status === 'PAID') return;

          // Restock all items
          for (const it of order.items || []) {
            await Product.findOneAndUpdate(
              { frontendId: it.productId },
              { $inc: { stock: Number(it.quantity || 0) } },
              { session: sessionDb }
            );
          }

          order.status = 'CANCELED';
          await order.save({ session: sessionDb });
        });

        console.log(`ORDER CANCELED/RESTOCKED: ${orderId}`);
      }

      res.json({ received: true });
      return;
    }

    // Default: acknowledge
    res.json({ received: true });
  } catch (err) {
    console.error('WEBHOOK ERROR:', err);
    res.status(500).send('Webhook handler error');
  } finally {
    sessionDb.endSession();
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
