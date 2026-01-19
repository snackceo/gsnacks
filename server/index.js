// IMPORTANT: Import Sentry instrument FIRST before any other modules
import './instrument.js';

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import mongoose from 'mongoose';
import * as Sentry from '@sentry/node';
import connectDB, { isDbReady } from './db/connect.js';
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
import returnsRouter from './routes/returns.js';
import { maintenanceModeGuardCached } from './utils/maintenanceMode.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Sentry request handler must be the first middleware
app.use(Sentry.Handlers.requestHandler());

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
// Health check - always accessible
app.use('/', healthRouter);

// Auth - always accessible (needed for login)
app.use('/api/auth', authRouter);

// Customer-facing routes - blocked during maintenance (except for owners)
app.use('/api/products', maintenanceModeGuardCached, productsRouter);
app.use('/api/orders', maintenanceModeGuardCached, createOrdersRouter({ stripe }));
app.use('/api/payments', maintenanceModeGuardCached, createPaymentsRouter({ stripe }));
app.use('/api/stripe', maintenanceModeGuardCached, createStripeRouter({ stripe, webhookSecret }));
app.use('/api/returns', maintenanceModeGuardCached, returnsRouter);

// Admin/management routes - always accessible (auth protection handles access)
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

// Debug endpoint for testing Sentry (REMOVE IN PRODUCTION)
if (process.env.NODE_ENV !== 'production') {
  app.get("/api/debug-sentry", function mainHandler(req, res) {
    throw new Error("My first Sentry error!");
  });
}

/* =========================
   SENTRY ERROR HANDLER
   Must be registered AFTER all controllers and BEFORE other error middleware
========================= */
app.use(Sentry.Handlers.errorHandler());

/* =========================
   ERROR HANDLING MIDDLEWARE
========================= */
app.use((err, req, res, next) => {
  console.error('UNHANDLED ERROR:', err);
  console.error('Request URL:', req.originalUrl);
  console.error('Request Method:', req.method);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // The error id is attached to `res.sentry` by Sentry middleware
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    sentryId: res.sentry, // Include Sentry error ID for support
    ...(isDevelopment && { stack: err.stack })
  });
});

/* =========================
   START SERVER
========================= */

(async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
    });
  } catch (err) {
    console.error('FAILED TO START SERVER', err);
    process.exit(1);
  }
})();
