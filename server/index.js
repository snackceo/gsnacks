import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   STRIPE
========================= */
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/* =========================
   IMPORTANT:
   Stripe webhooks require RAW body
========================= */
app.use(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' })
);

app.use(cors());

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});


/* =========================
   SERVER-TRUSTED DATA
   (Replace with Mongo later)
========================= */
const PRODUCTS = [
  { id: 'cola', name: 'Cola', price: 2.5 },
  { id: 'orange', name: 'Orange Soda', price: 2.0 },
  { id: 'water', name: 'Spring Water', price: 1.5 }
];

const ORDERS = [];

/* =========================
   HEALTH CHECK
========================= */
app.get('/', (_, res) => {
  res.send('NINPO MAINFRAME ONLINE');
});

app.get('/api/sync', (_, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

/* =========================
   CREATE STRIPE SESSION
========================= */
app.post('/api/payments/create-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const { items, userId } = req.body;

  if (!Array.isArray(items) || !userId) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  let totalCents = 0;
  const lineItems = [];

  for (const item of items) {
    const product = PRODUCTS.find(p => p.id === item.productId);
    if (!product) {
      return res.status(400).json({
        error: `Invalid product: ${item.productId}`
      });
    }

    const unitAmount = Math.round(product.price * 100);
    totalCents += unitAmount * item.quantity;

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: product.name },
        unit_amount: unitAmount
      },
      quantity: item.quantity
    });
  }

  const orderId = crypto.randomUUID();

  ORDERS.push({
    id: orderId,
    customerId: userId,
    items,
    total: totalCents / 100,
    paymentMethod: 'STRIPE_CARD',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      metadata: {
        orderId,
        userId
      },
      success_url:
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/success`,
      cancel_url:
        `${process.env.FRONTEND_URL || 'http://localhost:5173'}/cancel`
    });

    res.json({ sessionUrl: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Stripe session creation failed' });
  }
});

/* =========================
   STRIPE WEBHOOK
========================= */
app.post('/api/stripe/webhook', (req, res) => {
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
    console.error('Webhook signature verification failed.');
    return res.status(400).send('Invalid signature');
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    const order = ORDERS.find(o => o.id === orderId);
    if (order) {
      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      console.log(`ORDER PAID: ${orderId}`);
    }
  }

  res.json({ received: true });
});

/* =========================
   SERVER START
========================= */
app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
