import mongoose from 'mongoose';

const OrderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    items: [
      {
        productId: String,
        quantity: Number,
        price: Number
      }
    ],
    total: Number,
    paymentMethod: String,
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'PENDING'
    },
    stripeSessionId: String
  },
  { timestamps: true }
);

export default mongoose.model('Order', OrderSchema);
