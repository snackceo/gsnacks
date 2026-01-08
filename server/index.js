import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import User from './models/User';  // Import the User model

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
   MONGOOSE MODELS
========================= */

// Product Schema
const productSchema = new mongoose.Schema({
  frontendId: { type: String, required: true, unique: true }, // IMPORTANT
  name: String,
  price: Number,
  deposit: Number,
  stock: Number
});

const Product = mongoose.model('Product', productSchema);

// Order Schema
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
app.use(cors({ origin: '*', credentials: true }));
app.use(cookieParser());
app.use(express.json());

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
    console.error(err);
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
   LOGIN (USER)
========================= */

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login user and send JWT
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

  // Send JWT as cookie for persistent login
  res.cookie('auth_token', token, { httpOnly: true, secure: true, sameSite: 'Strict' });
  res.json({ message: 'Login successful' });
});

// Protect routes
const authenticate = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = decoded;
    next();
  });
};

// Example of a protected route
app.get('/api/protected', authenticate, (req, res) => {
  res.json({ message: 'You have access to this route', userId: req.user.userId });
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
