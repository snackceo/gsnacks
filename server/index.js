import receiptsRouter from './routes/receipts.js';
import storeInventoryRouter from './routes/store-inventory.js';

import './instrument.js';

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import * as Sentry from '@sentry/node';
import connectDB from './db/connect.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

import OpenApiValidator from 'express-openapi-validator';

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
import refundsRouter from './routes/refunds.js';
import cartRouter from './routes/cart.js';
import shoppingRouter from './routes/shopping.js';
import driverRouter from './routes/driver.js';
import itemsNotFoundRouter from './routes/items-not-found.js';
import receiptPricesRouter from './routes/receipt-prices.js';
import receiptAliasesRouter from './routes/receipt-aliases.js';
import storesRouter from './routes/stores.js';
import unmappedProductsRouter from './routes/unmapped-products.js';
import priceObservationsRouter from './routes/price-observations.js';
import { maintenanceModeGuardCached } from './utils/maintenanceMode.js';

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
   STRIPE WEBHOOK
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
   SECURITY
========================= */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    skip: req => req.originalUrl === '/api/stripe/webhook'
  })
);

app.use(cookieParser());

/* =========================
   BODY PARSER
========================= */
app.use('/uploads', express.static('uploads', { fallthrough: false }));

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();

  if (
    req.originalUrl?.includes('/api/driver/upload-receipt-image') ||
    req.originalUrl?.includes('/api/driver/receipt-capture')
  ) {
    return express.json({ limit: '20mb' })(req, res, next);
  }

  return express.json({ limit: '1mb' })(req, res, next);
});

/* =========================
   SWAGGER
========================= */
const swaggerFile = path.join(process.cwd(), 'docs', 'receipt-api.yaml');
const swaggerDocument = YAML.load(swaggerFile);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

/* =========================
   OPENAPI VALIDATION
========================= */
app.use(
  OpenApiValidator.middleware({
    apiSpec: swaggerFile,
    validateRequests: true,
    validateResponses: false
  })
);

/* =========================
   ROUTES
========================= */
app.use('/', healthRouter);
app.use('/api/auth', authRouter);

app.use('/api/products', maintenanceModeGuardCached, productsRouter);
app.use('/api/orders', maintenanceModeGuardCached, createOrdersRouter({ stripe }));
app.use('/api/payments', maintenanceModeGuardCached, createPaymentsRouter({ stripe }));
app.use('/api/stripe', maintenanceModeGuardCached, createStripeRouter({ stripe, webhookSecret }));
app.use('/api/returns', maintenanceModeGuardCached, returnsRouter);
app.use('/api/orders', maintenanceModeGuardCached, refundsRouter);
app.use('/api/cart', maintenanceModeGuardCached, cartRouter);

app.use('/api/upc', upcRouter);
app.use('/api/users', usersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/shopping', shoppingRouter);
app.use('/api/driver', driverRouter);
app.use('/api/driver', itemsNotFoundRouter);

app.use('/api/driver', receiptPricesRouter);
app.use('/api/driver', receiptAliasesRouter);

app.use('/api/stores', storesRouter);

// FIXED ROUTE PREFIX (important)
app.use('/api/store-inventory', storeInventoryRouter);

app.use('/api/unmapped-products', unmappedProductsRouter);
app.use('/api/price-observations', priceObservationsRouter);

app.use('/api/receipts', receiptsRouter);

app.use('/api/approvals', approvalsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/scan-sessions', scanSessionsRouter);
app.use('/api/distance', distanceRouter);
app.use('/api/inventory-audit', inventoryAuditRouter);

/* =========================
   404 HANDLER (IMPORTANT)
========================= */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`
    }
  });
});

/* =========================
   ERROR HANDLING
========================= */
Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  console.error(err);

  const isValidationError = err?.status === 400;

  return res.status(err.status || 500).json({
    success: false,
    error: {
      message: err.message || 'Internal server error',
      type: isValidationError ? 'VALIDATION_ERROR' : 'SERVER_ERROR'
    }
  });
});

/* =========================
   START SERVER
========================= */
(async () => {
  try {
    await connectDB();

    const httpServer = createServer(app);

    const io = new SocketIOServer(httpServer, {
      cors: { origin: allowedOrigins }
    });

    io.on('connection', socket => {
      socket.on('join', userId => {
        socket.join(`user:${userId}`);
      });
    });

    app.locals.io = io;

    httpServer.listen(PORT, () => {
      console.log(`LOGISTICS HUB ONLINE @ ${PORT}`);
      console.log(`Swagger: http://localhost:${PORT}/api-docs`);
    });
  } catch (err) {
    console.error('FAILED TO START SERVER', err);
    process.exit(1);
  }
})();