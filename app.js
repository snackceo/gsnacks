import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import connectDB from './server/config/db.js';
import errorHandler from './server/middleware/errorHandler.js';
import { initializeNotificationListeners } from './server/services/notificationHandler.js';

// Import Routes
import authRoutes from './server/routes/authRoutes.js';
import productRoutes from './server/routes/productRoutes.js';
import orderRoutes from './server/routes/orderRoutes.js';
import bottleReturnRoutes from './server/routes/bottleReturnRoutes.js';
import adminRoutes from './server/routes/adminRoutes.js';
import paymentRoutes from './server/routes/paymentRoutes.js';
import { stripeWebhook } from './server/controllers/paymentController.js'; // For webhook

// Load environment variables
dotenv.config({ path: './config/config.env' });

// Connect to Database
connectDB();

// Initialize event listeners
initializeNotificationListeners();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Stripe webhook needs raw body
app.post(
  '/api/v1/stripe-webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

// Body Parser
app.use(express.json());

// Security Middleware
app.use(helmet());

const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CORS_ORIGIN_PROD // e.g., https://www.your-app.com
    : process.env.CORS_ORIGIN_DEV, // e.g., http://localhost:3000
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
};
app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Make io accessible to our router
app.set('io', io);

// Mount Routers (to be added)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/returns', bottleReturnRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/payments', paymentRoutes);

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('joinOrderRoom', (orderId) => {
    // Here you would verify if the user is authorized to join this room
    socket.join(`order:${orderId}`);
    console.log(`Client joined room: order:${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Centralized Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});