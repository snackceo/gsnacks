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

    // Optional fields (frontend currently may not send all of these yet)
    address: { type: String, default: '' },
    driverId: { type: String, default: '' },
    gpsCoords: {
      lat: { type: Number },
      lng: { type: Number }
    },
    verificationPhoto: { type: String, default: '' },

    items: [
      {
        productId: { type: String, required: true }, // frontendId
        quantity: { type: Number, required: true }
      }
    ],

    total: { type: Number, required: true },

    // Keep schema flexible; frontend maps to its own union
    paymentMethod: { type: String, default: 'STRIPE' },

    // PENDING = created/reserved, PAID = confirmed, CANCELED = released/restocked
    status: { type: String, default: 'PENDING' },

    paidAt: { type: Date },
    deliveredAt: { type: Date },

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
   COOKIE HELPERS (FIXED LOGOUT)
========================= */

/**
 * Cookie options MUST match between set and clear, otherwise the browser will not remove it.
 * We support:
 * - Production on *.ninposnacks.com (secure + domain)
 * - Local dev on localhost (not secure + no domain)
 */
function getCookieOptions(req) {
  const host = (req.headers.host || '').toLowerCase();

  const isLocalhost =
    host.includes('localhost') || host.startsWith('127.0.0.1') || host.includes('0.0.0.0');

  // If you're deploying to ninposnacks.com (or api.ninposnacks.com), treat as production cookie.
  const isNinpoDomain = host.includes('ninposnacks.com');

  const secure = !isLocalhost; // secure cookies required on HTTPS
  const base = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  };

  // Only set domain on your real domain; never on localhost.
  if (isNinpoDomain && !isLocalhost) {
    return { ...base, domain: '.ninposnacks.com' };
  }

  return base;
}

function setAuthCookie(req, res, token) {
  const opts = {
    ...getCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000
  };

  res.cookie('auth_token', token, opts);
}

function clearAuthCookie(req, res) {
  // Clear using the "current environment" options
  res.clearCookie('auth_token', getCookieOptions(req));

  // Extra safety: also clear the other variant so you don't get "logged back in"
  // when switching between localhost and production during testing.
  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    domain: '.ninposnacks.com',
    path: '/'
  });

  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  });
}

/* =========================
   AUTH HELPERS
========================= */
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

// Map DB order -> frontend Order shape
function mapOrderForFrontend(d) {
  // Frontend enum does not include CANCELED, so map it to CLOSED.
  const mappedStatus = d.status === 'CANCELED' ? 'CLOSED' : d.status;

  return {
    id: d.orderId,
    customerId: d.customerId || 'GUEST',
    driverId: d.driverId || undefined,
    items: Array.isArray(d.items) ? d.items : [],
    total: Number(d.total || 0),

    // Frontend expects these fields; safe defaults
    estimatedReturnCredit: 0,
    verifiedReturnCredit: undefined,

    paymentMethod: d.paymentMethod === 'STRIPE' ? 'STRIPE_CARD' : d.paymentMethod,

    address: d.address || '',
    status: mappedStatus,

    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
    paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : undefined,
    deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : undefined,

    verificationPhoto: d.verificationPhoto || undefined,
    gpsCoords: d.gpsCoords?.lat && d.gpsCoords?.lng ? d.gpsCoords : undefined
  };
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

    setAuthCookie(req, res, token);
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

    setAuthCookie(req, res, token);
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
  clearAuthCookie(req, res);
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
   ORDERS (OWNER DASHBOARD)
========================= */
app.get('/api/orders', authRequired, ownerRequired, async (req, res) => {
  try {
    const docs = await Order.find({}).sort({ createdAt: -1 }).lean();
    const orders = docs.map(mapOrderForFrontend);
    res.json({ ok: true, orders });
  } catch (err) {
    console.error('GET ORDERS ERROR:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.patch('/api/orders/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Invalid order id' });

    const allowed = ['status', 'driverId', 'address', 'gpsCoords', 'verificationPhoto'];

    const updates = {};
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    // Auto-set timestamps for common status moves (safe, optional)
    if (updates.status === 'DELIVERED') {
      updates.deliveredAt = new Date();
    }
    if (updates.status === 'PAID') {
      updates.paidAt = new Date();
    }

    const updated = await Order.findOneAndUpdate({ orderId }, updates, {
      new: true
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Order not found' });

    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    console.error('PATCH ORDER ERROR:', err);
    res.status(500).json({ error: 'Failed to update order' });
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
    const address = String(req.body?.address || '').trim();
    const gateway = String(req.body?.gateway || 'STRIPE').toUpperCase();

    const items = normalizeCart(rawItems);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const orderId = crypto.randomUUID();
    const lineItems = [];
    let totalCents = 0;

    // Reserve stock atomically.
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
            paymentMethod: gateway === 'GPAY' ? 'GOOGLE_PAY' : 'STRIPE',
            status: 'PENDING'
          }
        ],
        { session: sessionDb }
      );
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      metadata: { orderId },
      success_url: `${frontendUrl}/success`,
      cancel_url: `${frontendUrl}/cancel`
    });

    await Order.findOneAndUpdate({ orderId }, { stripeSessionId: stripeSession.id });

    res.json({ sessionUrl: stripeSession.url });
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

    if (type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;
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

    if (type === 'checkout.session.expired' || type === 'payment_intent.payment_failed') {
      const obj = event.data.object;
      const orderId = obj?.metadata?.orderId;

      if (orderId) {
        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;
          if (order.status === 'CANCELED' || order.status === 'PAID') return;

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
