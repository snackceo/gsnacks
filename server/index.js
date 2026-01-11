import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

import User from './models/User.js';
import Product from './models/Product.js';
import Order from './models/Order.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   MIDDLEWARE
========================= */
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = [
        FRONTEND_URL,
        'http://localhost:5173',
        'http://localhost:3000'
      ];
      if (allowed.includes(origin)) return cb(null, true);
      return cb(null, true);
    },
    credentials: true
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

/* =========================
   HELPERS
========================= */
const uuid = () => crypto.randomUUID();

const mapProductForFrontend = (p) => ({
  id: p.frontendId,
  frontendId: p.frontendId,
  name: p.name,
  price: p.price,
  deposit: p.deposit ?? 0,
  stock: p.stock ?? 0,
  category: p.category ?? 'DRINK',
  image: p.image ?? '',
  isGlass: !!p.isGlass
});

const mapOrderForFrontend = (o) => ({
  id: o.orderId,
  orderId: o.orderId,
  customerId: o.customerId,
  address: o.address || '',
  driverId: o.driverId || '',
  verificationPhoto: o.verificationPhoto || '',
  gpsCoords: o.gpsCoords || null,

  returnUpcs: Array.isArray(o.returnUpcs) ? o.returnUpcs : [],
  estimatedReturnCredit: Number(o.estimatedReturnCredit || 0),
  verifiedReturnCredit: Number(o.verifiedReturnCredit || 0),

  items: Array.isArray(o.items) ? o.items : [],
  total: Number(o.total || 0),
  paymentMethod: o.paymentMethod || 'STRIPE',
  status: o.status || 'PENDING',

  amountAuthorizedCents: Number(o.amountAuthorizedCents || 0),
  amountCapturedCents: Number(o.amountCapturedCents || 0),

  stripeSessionId: o.stripeSessionId || '',
  stripePaymentIntentId: o.stripePaymentIntentId || '',

  createdAt: o.createdAt,
  updatedAt: o.updatedAt
});

const authRequired = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }
};

const ownerRequired = async (req, res, next) => {
  if (req.user?.role !== 'OWNER') {
    return res.status(403).json({ error: 'Owner only' });
  }
  next();
};

const restockOrderItems = async (orderDoc, sessionDb) => {
  const items = Array.isArray(orderDoc.items) ? orderDoc.items : [];

  for (const line of items) {
    const productId = String(line.productId || '').trim();
    const qty = Math.max(0, Number(line.quantity || 0));
    if (!productId || !qty) continue;

    await Product.findOneAndUpdate(
      { frontendId: productId },
      { $inc: { stock: qty } },
      { session: sessionDb }
    );
  }
};

const voidStripeAuthorizationBestEffort = async (orderDoc) => {
  try {
    if (!stripe) return;
    const pi = orderDoc?.stripePaymentIntentId;
    if (!pi) return;
    await stripe.paymentIntents.cancel(pi);
  } catch (e) {
    console.warn('VOID AUTH (best-effort) failed:', e?.message || e);
  }
};

/* =========================
   STRIPE WEBHOOK HANDLER
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

          if (order.status === 'CANCELED') {
            await voidStripeAuthorizationBestEffort(order);
            return;
          }

          const paymentIntentId = session?.payment_intent?.toString();

          order.stripeSessionId = order.stripeSessionId || session.id;
          if (paymentIntentId) {
            order.stripePaymentIntentId =
              order.stripePaymentIntentId || paymentIntentId;
          }
          order.authorizedAt = order.authorizedAt || new Date();

          await order.save({ session: sessionDb });
        });

        console.log(`ORDER AUTHORIZED: ${orderId}`);
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

          await restockOrderItems(order, sessionDb);

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
   AUTH
========================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(400).json({ error: 'Username taken' });

    const user = await User.create({ username, password, role: 'CUSTOMER' });

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role || 'CUSTOMER', username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none'
    });

    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role: user.role }
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role || 'CUSTOMER', username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none'
    });

    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role: user.role }
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.post('/api/auth/logout', async (_req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role: user.role }
    });
  } catch (err) {
    console.error('ME ERROR:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

/* =========================
   SYNC
========================= */
app.get('/api/sync', async (_req, res) => {
  try {
    const [products, orders, users] = await Promise.all([
      Product.find({}).lean(),
      Order.find({}).sort({ createdAt: -1 }).lean(),
      User.find({}).lean()
    ]);

    res.json({
      ok: true,
      products: products.map(mapProductForFrontend),
      orders: orders.map(mapOrderForFrontend),
      users: users.map(u => ({
        id: u._id.toString(),
        username: u.username,
        role: u.role || 'CUSTOMER'
      }))
    });
  } catch (err) {
    console.error('SYNC ERROR:', err);
    res.status(500).json({ error: 'Failed to sync' });
  }
});

/* =========================
   PRODUCTS
========================= */
app.post('/api/products', authRequired, ownerRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const frontendId = String(body.id || body.frontendId || uuid()).trim();

    const created = await Product.create({
      frontendId,
      name: String(body.name || 'Unnamed'),
      price: Number(body.price || 0),
      deposit: Number(body.deposit || 0),
      stock: Number(body.stock || 0),
      category: String(body.category || 'DRINK'),
      image: String(body.image || ''),
      isGlass: !!body.isGlass
    });

    res.json({ ok: true, product: mapProductForFrontend(created) });
  } catch (err) {
    console.error('CREATE PRODUCT ERROR:', err);
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

    if (updates.price !== undefined) updates.price = Number(updates.price || 0);
    if (updates.deposit !== undefined) updates.deposit = Number(updates.deposit || 0);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock || 0);
    if (updates.isGlass !== undefined) updates.isGlass = !!updates.isGlass;

    const updated = await Product.findOneAndUpdate({ frontendId }, updates, {
      new: true
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    res.json({ ok: true, product: mapProductForFrontend(updated) });
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
========================= */
app.get('/api/orders', authRequired, ownerRequired, async (_req, res) => {
  try {
    const docs = await Order.find({}).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, orders: docs.map(mapOrderForFrontend) });
  } catch (err) {
    console.error('GET ORDERS ERROR:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.patch('/api/orders/:id', authRequired, ownerRequired, async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Invalid order id' });

    const allowed = ['status', 'driverId', 'address', 'gpsCoords', 'verificationPhoto', 'verifiedReturnCredit'];
    const updates = {};
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }

    const requestedStatus = updates.status ? String(updates.status).trim() : null;
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

        if (order.status === 'CANCELED') {
          updatedOrderDoc = order;
          return;
        }

        await restockOrderItems(order, sessionDb);

        order.status = 'CANCELED';

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
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const rawItems = req.body?.items || [];
    const userId = req.body?.userId || 'GUEST';
    const gateway = String(req.body?.gateway || 'STRIPE').toUpperCase();
    const address = String(req.body?.address || '');
    const returnUpcs = Array.isArray(req.body?.returnUpcs) ? req.body.returnUpcs : [];

    const items = Array.isArray(rawItems)
      ? rawItems.map(i => ({
          productId: String(i.productId || '').trim(),
          quantity: Math.max(0, Number(i.quantity || 0))
        }))
      : [];

    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

    const orderId = uuid();

    const lineItems = [];
    let totalCents = 0;

    // Estimate credit: 10 cents per eligible UPC (backend trusts list for now)
    const estimatedReturnCredit = (returnUpcs.length * 0.10);

    await sessionDb.withTransaction(async () => {
      for (const item of items) {
        if (!item.productId || !item.quantity) continue;

        const updated = await Product.findOneAndUpdate(
          { frontendId: item.productId, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { new: true, session: sessionDb }
        );

        if (!updated) {
          const current = await Product.findOne({ frontendId: item.productId }).lean();
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
            driverId: '',
            verificationPhoto: '',
            gpsCoords: null,

            returnUpcs,
            estimatedReturnCredit,
            verifiedReturnCredit: 0,

            items,
            total: totalCents / 100,
            paymentMethod: gateway === 'GPAY' ? 'GOOGLE_PAY' : 'STRIPE',
            status: 'PENDING',
            amountAuthorizedCents: totalCents,
            amountCapturedCents: 0
          }
        ],
        { session: sessionDb }
      );
    });

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      payment_intent_data: { capture_method: 'manual' },
      metadata: { orderId },
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel?session_id={CHECKOUT_SESSION_ID}`
    });

    await Order.findOneAndUpdate(
      { orderId },
      { stripeSessionId: stripeSession.id, amountAuthorizedCents: totalCents }
    );

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

app.post('/api/orders/release-reservation', async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    const stripeSessionId = String(req.body?.sessionId || '').trim();
    if (!stripeSessionId) return res.status(400).json({ error: 'Missing sessionId' });

    let order = null;

    await sessionDb.withTransaction(async () => {
      order = await Order.findOne({ stripeSessionId }).session(sessionDb);
      if (!order) return;

      if (order.status === 'CANCELED' || order.status === 'PAID') return;

      await restockOrderItems(order, sessionDb);

      order.status = 'CANCELED';
      await order.save({ session: sessionDb });
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    await voidStripeAuthorizationBestEffort(order);

    res.json({ ok: true, order: mapOrderForFrontend(order) });
  } catch (err) {
    console.error('RELEASE RESERVATION ERROR:', err);
    res.status(500).json({ error: 'Failed to release reservation' });
  } finally {
    sessionDb.endSession();
  }
});

app.post('/api/payments/capture', authRequired, ownerRequired, async (req, res) => {
  const sessionDb = await mongoose.startSession();

  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const verifiedReturnCredit = Math.max(0, Number(req.body?.verifiedReturnCredit || 0));

    let updated = null;

    await sessionDb.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(sessionDb);
      if (!order) return;

      if (!order.stripePaymentIntentId) {
        const e = new Error('Order has no payment_intent id (not authorized yet).');
        e.code = 'NO_PAYMENT_INTENT';
        throw e;
      }

      const authorized = Number(order.amountAuthorizedCents || Math.round(Number(order.total || 0) * 100));
      const creditCents = Math.round(verifiedReturnCredit * 100);
      const finalCaptureCents = Math.max(0, authorized - creditCents);

      if (finalCaptureCents === 0) {
        await stripe.paymentIntents.cancel(order.stripePaymentIntentId);

        order.verifiedReturnCredit = verifiedReturnCredit;
        order.amountAuthorizedCents = authorized;
        order.amountCapturedCents = 0;
        order.status = 'PAID';
        order.paidAt = order.paidAt || new Date();

        await order.save({ session: sessionDb });
        updated = order;
        return;
      }

      const captured = await stripe.paymentIntents.capture(order.stripePaymentIntentId, {
        amount_to_capture: finalCaptureCents
      });

      order.verifiedReturnCredit = verifiedReturnCredit;
      order.amountAuthorizedCents = authorized;
      order.amountCapturedCents = Number(captured?.amount_received || finalCaptureCents);
      order.status = 'PAID';
      order.paidAt = order.paidAt || new Date();

      await order.save({ session: sessionDb });
      updated = order;
    });

    if (!updated) return res.status(404).json({ error: 'Order not found' });

    res.json({ ok: true, order: mapOrderForFrontend(updated) });
  } catch (err) {
    if (err?.code === 'NO_PAYMENT_INTENT') return res.status(400).json({ error: err.message });

    console.error('CAPTURE ERROR:', err);
    res.status(500).json({ error: 'Failed to capture payment' });
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
