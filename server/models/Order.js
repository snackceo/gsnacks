import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true }, // our UUID
    customerId: { type: String, default: 'GUEST' },

    address: { type: String, default: '' },
    driverId: { type: String, default: '' },
    gpsCoords: {
      lat: { type: Number },
      lng: { type: Number }
    },
    verificationPhoto: { type: String, default: '' },

    // Bottle returns (client preview + driver verification)
    returnUpcs: { type: [String], default: [] },
    estimatedReturnCredit: { type: Number, default: 0 }, // dollars (preview)
    verifiedReturnCredit: { type: Number, default: 0 }, // dollars (driver)

    items: [
      {
        productId: { type: String, required: true }, // frontendId
        quantity: { type: Number, required: true }
      }
    ],

    total: { type: Number, required: true }, // dollars, pre-credit
    paymentMethod: { type: String, default: 'STRIPE' },

    /**
     * PENDING: order created, stock reserved, payment NOT captured yet
     * PAID: payment captured (after driver verification)
     * CANCELED: canceled/re-stocked
     */
    status: { type: String, default: 'PENDING' },

    // Stripe references + amounts (cents)
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    authorizedAt: { type: Date },
    amountAuthorizedCents: { type: Number, default: 0 },
    capturedAt: { type: Date },
    amountCapturedCents: { type: Number, default: 0 },

    paidAt: { type: Date },
    deliveredAt: { type: Date }
  },
  { timestamps: true }
);

// Prevent model overwrite on hot reload / repeated imports
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

export default Order;
