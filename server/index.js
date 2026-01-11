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

    address: { type: String, default: '' },
    driverId: { type: String, default: '' },
    gpsCoords: {
      lat: { type: Number },
      lng: { type: Number }
    },
    verificationPhoto: { type: String, default: '' },

    // Bottle returns (client preview + driver verification)
    returnUpcs: { type: [String], default: [] },
    estimatedReturnCredit: { type: Number, default: 0 }, // dollars (preview)
    verifiedReturnCredit: { type: Number, default: 0 }, // dollars (driver)

    items: [
      {
        productId: { type: String, required: true }, // frontendId
        quantity: { type: Number, required: true }
      }
    ],

    total: { type: Number, required: true }, // dollars, pre-credit

    paymentMethod: { type: String, default: 'STRIPE' },

    /**
     * PENDING: order created, stock reserved, payment NOT captured yet
     * PAID: payment captured (after driver verification)
     * CANCELED: canceled/re-stocked (customer cancel redirect or manual owner cancel)
     * EXPIRED: session expired or payment failed (webhook)
     */
    status: { type: String, default: 'PENDING' },

    // Stripe references + amounts (cents)
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    authorizedAt: { type: Date },
    amountAuthorizedCents: { type: Number, default: 0 },
    capturedAt: { type: Date },
    amountCapturedCents: { type: Number, default: 0 },

    // Lifecycle timestamps
    inventoryReleasedAt: { type: Date }, // set when we restock (idempotency gate)
    canceledAt: { type: Date },
    expiredAt: { type: Date },
    cancelReason: { type: String, default: '' },

    paidAt: { type: Date },
    deliveredAt: { type: Date }
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
function getCookieOptions(req) {
  const host = (req.headers.host || '').toLowerCase();

  const isLocalhost =
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.includes('0.0.0.0');

  const isNinpoDomain = host.includes('ninposnacks.com');

  const secure = !isLocalhost;
  const base = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  };

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
  res.clearCookie('auth_token', getCookieOptions(req));

  // Extra safety for mixed testing
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

/* =========================
   CART / ORDER HELPERS
========================= */
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

function mapOrderForFrontend(d) {
  // Frontend enum does not include CANCELED/EXPIRED, so map them to CLOSED.
  const mappedStatus =
    d.status === 'CANCELED' || d.status === 'EXPIRED' ? 'CLOSED' : d.status;

  const authorizedCents = Number(d.amountAuthorizedCents ?? 0);
  const capturedCents = Number(d.amountCapturedCents ?? 0);

  const authorizedAmount = Number.isFinite(authorizedCents)
    ? Math.round((authorizedCents / 100) * 100) / 100
    : 0;

  const capturedAmount =
    d.capturedAt && Number.isFinite(capturedCents)
      ? Math.round((capturedCents / 100) * 100) / 100
      : undefined;

  return {
    id: d.orderId,
    customerId: d.customerId || 'GUEST',
    driverId: d.driverId || undefined,
    items: Array.isArray(d.items) ? d.items : [],
    total: Number(d.total || 0),

    // Bottle returns
    estimatedReturnCredit: Number(d.estimatedReturnCredit || 0),
    verifiedReturnCredit:
      d.verifiedReturnCredit !== undefined
        ? Number(d.verifiedReturnCredit || 0)
        : undefined,

    // Money movement (dollars)
    authorizedAmount,
    capturedAmount,

    paymentMethod: d.paymentMethod === 'STRIPE' ? 'STRIPE_CARD' : d.paymentMethod,

    address: d.address || '',
    status: mappedStatus,

    createdAt: d.createdAt
      ? new Date(d.createdAt).toISOString()
      : new Date().toISOString(),
    paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : undefined,
    deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : undefined,

    verificationPhoto: d.verificationPhoto || undefined,
    gpsCoords: d.gpsCoords?.lat && d.gpsCoords?.lng ? d.gpsCoords : undefined
  };
}

async function restockOrderItems(order, sessionDb) {
  for (const it of order.items || []) {
    const qty = Number(it.quantity || 0);
    if (!qty || qty <= 0) continue;

    await Product.findOneAndUpdate(
      { frontendId: it.productId },
      { $inc: { stock: qty } },
      { session: sessionDb }
    );
  }
}

async function voidStripeAuthorizationBestEffort(order) {
  if (!stripe) return;
  const pi = order?.stripePaymentIntentId;
  if (!pi) return;

  try {
    await stripe.paymentIntents.cancel(pi);
  } catch {
    // ignore (best-effort)
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
   ORDERS
   - Owner sees all
   - Customers see their own
========================= */
app.get('/api/orders', authRequired, async (req, res) => {
  try {
    const isOwner = isOwnerUsername(req.user?.username);
    const q = isOwner ? {} : { customerId: req.user?.id };

    const docs = await Order.find(q).sort({ createdAt: -1 }).lean();
    const orders = docs.map(mapOrderForFrontend);

    res.json({ ok: true, orders });
  } catch (err) {
    console.error('GET ORDERS ERROR:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

/**
 * POST /api/orders/release-reservation
 * Option A: cancel redirect restocks immediately.
 * Idempotent: guarded by inventoryReleasedAt and terminal statuses.
 */
app.post('/api/orders/release-reservation', async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ stripeSessionId: sessionId }).session(sessionDb);
      if (!order) return;

      if (order.status === 'PAID') return;
      if (order.inventoryReleasedAt) return;

      await restockOrderItems(order, sessionDb);

      order.status = 'CANCELED';
      order.inventoryReleasedAt = new Date();
      order.canceledAt = new Date();
      order.cancelReason = order.cancelReason || 'cancel_redirect';

      await order.save({ session: sessionDb });

      // best-effort void
      await voidStripeAuthorizationBestEffort(order);
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('RELEASE RESERVATION ERROR:', err);
    res.status(500).json({ error: 'Failed to release reservation' });
  } finally {
    sessionDb.endSession();
  }
});

/**
 * PATCH /api/orders/:id (owner-only)
 * - Accepts frontend statuses, including CLOSED (manual cancel).
 * - CLOSED -> immediately restocks and sets DB status to CANCELED, and voids Stripe authorization if present.
 */
app.patch('/api/orders/:id', authRequired, ownerRequired, async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Invalid order id' });

    const allowed = [
      'status',
      'driverId',
      'address',
      'gpsCoords',
      'verificationPhoto',
      'verifiedReturnCredit'
    ];

    const updates = {};
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    const requestedStatus = updates.status ? String(updates.status).trim() : null;

    // Manual cancel from frontend typically sends CLOSED.
    const isManualCancel = requestedStatus === 'CLOSED' || requestedStatus === 'CANCELED';

    if (isManualCancel) {
      let updatedOrderDoc = null;

      await sessionDb.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(sessionDb);
        if (!order) return;

        if (order.status === 'PAID') {
          const e = new Error('Cannot cancel a PAID order (refund flow required).');
          e.code = 'CANNOT_CANCEL_PAID';
          throw e;
        }

        // Already released/canceled/expired => idempotent return
        if (order.inventoryReleasedAt || order.status === 'CANCELED' || order.status === 'EXPIRED') {
          updatedOrderDoc = order;
          return;
        }

        await restockOrderItems(order, sessionDb);

        order.status = 'CANCELED';
        order.inventoryReleasedAt = new Date();
        order.canceledAt = new Date();
        order.cancelReason = order.cancelReason || 'manual_owner_cancel';

        if (updates.driverId !== undefined) order.driverId = String(updates.driverId || '');
        if (updates.address !== undefined) order.address = String(updates.address || '');
        if (updates.gpsCoords !== undefined) order.gpsCoords = updates.gpsCoords;
        if (updates.verificationPhoto !== undefined)
          order.verificationPhoto = String(updates.verificationPhoto || '');

        if (updates.verifiedReturnCredit !== undefined) {
          const v = Number(updates.verifiedReturnCredit);
          order.verifiedReturnCredit = Number.isFinite(v) ? Math.max(0, v) : 0;
        }

        await order.save({ session: sessionDb });
        updatedOrderDoc = order;
      });

      if (!updatedOrderDoc) return res.status(404).json({ error: 'Order not found' });

      await voidStripeAuthorizationBestEffort(updatedOrderDoc);

      return res.json({ ok: true, order: mapOrderForFrontend(updatedOrderDoc) });
    }

    if (requestedStatus === 'DELIVERED') {
      updates.deliveredAt = new Date();
    }
    if (requestedStatus === 'PAID') {
      updates.paidAt = new Date();
    }

    if (updates.verifiedReturnCredit !== undefined) {
      updates.verifiedReturnCredit = Math.max(0, Number(updates.verifiedReturnCredit || 0));
    }

    const updated = await Order.findOneAndUpdate({ orderId }, updates, {
      new: true
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Order not found' });

    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    if (err?.code === 'CANNOT_CANCEL_PAID') {
      return res.status(400).json({ error: err.message });
    }
    console.error('PATCH ORDER ERROR:', err);
    res.status(500).json({ error: 'Failed to update order' });
  } finally {
    sessionDb.endSession();
  }
});

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
app.post('/api/payments/create-session', async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const rawItems = req.body?.items;
    const userId = req.body?.userId;
    const address = String(req.body?.address || '').trim();
    const gateway = String(req.body?.gateway || 'STRIPE').toUpperCase();

    const incomingUpcs = Array.isArray(req.body?.returnUpcs) ? req.body.returnUpcs : [];
    const returnUpcs = incomingUpcs.map(String).map(s => s.trim()).filter(Boolean);

    const depositValue = Number(process.env.MI_DEPOSIT_VALUE || 0.1); // dollars
    const dailyCap = Number(process.env.DAILY_RETURN_CAP || 25); // dollars
    const computedEstimatedCredit = Math.min(returnUpcs.length * depositValue, dailyCap);

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

            returnUpcs,
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

/**
 * POST /api/payments/capture (owner-only)
 * - Driver submits verifiedReturnCredit
 * - Server captures final amount = authorized - verified credit (never increases)
 */
app.post('/api/payments/capture', authRequired, ownerRequired, async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const verifiedReturnCredit = Math.max(0, Number(req.body?.verifiedReturnCredit || 0));
    if (!Number.isFinite(verifiedReturnCredit)) {
      return res.status(400).json({ error: 'verifiedReturnCredit must be a number' });
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

/* =========================
   STRIPE WEBHOOK (AUTHORIZE / RESTOCK)
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

    // Checkout complete => payment authorized (manual capture)
    if (type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        await sessionDb.withTransaction(async () => {
          const order = await Order.findOne({ orderId }).session(sessionDb);
          if (!order) return;

          if (order.status === 'CANCELED' || order.status === 'EXPIRED') {
            await voidStripeAuthorizationBestEffort(order);
            return;
          }

          const paymentIntentId = session?.payment_intent?.toString();

          order.stripeSessionId = order.stripeSessionId || session.id;
          if (paymentIntentId) {
            order.stripePaymentIntentId = order.stripePaymentIntentId || paymentIntentId;
          }
          order.authorizedAt = order.authorizedAt || new Date();

          await order.save({ session: sessionDb });
        });

        console.log(`ORDER AUTHORIZED: ${orderId}`);
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

          await restockOrderItems(order, sessionDb);

          order.status = 'EXPIRED';
          order.inventoryReleasedAt = new Date();
          order.expiredAt = new Date();
          order.cancelReason = order.cancelReason || 'stripe_expired_or_failed';

          await order.save({ session: sessionDb });

          await voidStripeAuthorizationBestEffort(order);
        });

        console.log(`ORDER EXPIRED/RESTOCKED: ${orderId}`);
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
