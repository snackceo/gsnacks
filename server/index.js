import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import createOrdersRouter from './routes/orders.js';
import createPaymentsRouter from './routes/payments.js';
import productsRouter from './routes/products.js';
import createStripeRouter from './routes/stripe.js';
import upcRouter from './routes/upc.js';
import usersRouter from './routes/users.js';
import aiRouter from './routes/ai.js';
import approvalsRouter from './routes/approvals.js';
import settingsRouter from './routes/settings.js';
import auditLogsRouter from './routes/audit-logs.js';
import uploadsRouter from './routes/uploads.js';
import scanSessionsRouter from './routes/scan-sessions.js';
import distanceRouter from './routes/distance.js';
import inventoryAuditRouter from './routes/inventory-audit.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

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
   STRIPE WEBHOOK (RAW BODY)
========================= */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

/* =========================
   CORS
========================= */
const defaultOrigins = [
  'https://ninposnacks.com',
  'https://www.ninposnacks.com',
  'https://gsnacks.onrender.com',
  'http://localhost:5173'
];
const envOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : []
].flat();
const allowedOrigins = Array.from(
  new Set([...defaultOrigins, ...envOrigins].filter(Boolean))
);

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
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.originalUrl === '/api/stripe/webhook'
});
app.use(apiLimiter);
app.use(cookieParser());

app.use('/uploads', express.static('uploads', { fallthrough: false }));

// IMPORTANT: Do NOT run JSON parser on webhook route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  return express.json({ limit: '1mb' })(req, res, next);
});

/* =========================
   ROUTES
========================= */
app.use('/', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', createOrdersRouter({ stripe }));
app.use('/api/payments', createPaymentsRouter({ stripe }));
app.use('/api/stripe', createStripeRouter({ stripe, webhookSecret }));
app.use('/api/upc', upcRouter);
app.use('/api/users', usersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/scan-sessions', scanSessionsRouter);
app.use('/api/distance', distanceRouter);
app.use('/api/inventory-audit', inventoryAuditRouter);

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
});
