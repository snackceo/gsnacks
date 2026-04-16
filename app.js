const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const connectDB = require('./server/config/db');
const errorHandler = require('./server/middleware/errorHandler');
const { initializeNotificationListeners } = require('./server/services/notificationHandler');

// Load environment variables
require('dotenv').config({ path: './config/config.env' });

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
  require('./server/controllers/paymentController').stripeWebhook
);

// Body Parser
app.use(express.json());

// Security Middleware
app.use(helmet());

const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CORS_ORIGIN // Your frontend URL, e.g., https://www.your-app.com
    : '*', // Allow all for development
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
app.use('/api/v1/auth', require('./server/routes/authRoutes.js'));
app.use('/api/v1/products', require('./server/routes/productRoutes.js'));
app.use('/api/v1/orders', require('./server/routes/orderRoutes.js'));
app.use('/api/v1/returns', require('./server/routes/bottleReturnRoutes.js'));
app.use('/api/v1/admin', require('./server/routes/adminRoutes.js'));
app.use('/api/v1/orders', require('./server/routes/paymentRoutes.js'));

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