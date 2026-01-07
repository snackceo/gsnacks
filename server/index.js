
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Stripe only if key is present
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(cors());
app.use(express.json());

// MongoDB Connection
const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.warn("WARNING: MONGO_URI is missing. Backend running in ephemeral mode.");
      return;
    }
    await mongoose.connect(uri);
    console.log("LOGISTICS HUB: Connected to MongoDB Cluster.");
  } catch (err) {
    console.error("LOGISTICS HUB: MongoDB Connection Error:", err.message);
  }
};
connectDB();

// Root Route for Health Check (Visible in Browser)
app.get('/', (req, res) => {
  res.send('<h1>NINPO MAINFRAME ONLINE</h1><p>Logistics Node 01 is active and listening.</p>');
});

// API Routes
app.get('/api/sync', async (req, res) => {
  res.json({
    status: "online",
    message: "Ninpo Mainframe Active",
    timestamp: new Date().toISOString()
  });
});

app.post('/api/payments/create-session', async (req, res) => {
  const { items, userId } = req.body;
  
  if (!stripe) {
    return res.status(500).json({ error: "Stripe integration not configured on host." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `Batch SKU: ${item.productId}` },
          unit_amount: 500, 
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

app.post('/api/ai/analyze-bottle', async (req, res) => {
  res.json({ valid: true, material: "ALUMINUM", message: "Mainframe Analysis Successful." });
});

app.listen(PORT, () => {
  console.log(`LOGISTICS HUB: Listening on Node ${PORT}`);
});
