
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

// MongoDB Connection
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("CRITICAL: MONGO_URI is missing in environment variables.");
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log("LOGISTICS HUB: Connected to MongoDB Cluster.");
  } catch (err) {
    console.error("LOGISTICS HUB: MongoDB Connection Error:", err.message);
  }
};
connectDB();

// Schemas
const OrderSchema = new mongoose.Schema({
  items: Array,
  total: Number,
  status: String,
  address: String,
  userId: String,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const UserSchema = new mongoose.Schema({
  id: String,
  name: String,
  credits: { type: Number, default: 0 },
  loyaltyPoints: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

// API Routes
app.get('/api/sync', async (req, res) => {
  // In a real app, you'd fetch products and settings from DB
  res.json({
    status: "online",
    message: "Ninpo Mainframe Active"
  });
});

app.post('/api/payments/create-session', async (req, res) => {
  const { items, userId } = req.body;
  
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `Batch SKU: ${item.productId}` },
          unit_amount: 500, // Placeholder $5.00 - in production fetch real price
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/cancel`,
    });

    res.json({ sessionUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Proxy for Bottle Analysis (Protects Gemini API Key)
app.post('/api/ai/analyze-bottle', async (req, res) => {
  // This can proxy to Gemini using process.env.API_KEY
  // For now, it's a placeholder to show the backend is working
  res.json({ valid: true, material: "ALUMINUM", message: "Mainframe Analysis Successful." });
});

app.listen(PORT, () => {
  console.log(`LOGISTICS HUB: Listening on Node ${PORT}`);
});
