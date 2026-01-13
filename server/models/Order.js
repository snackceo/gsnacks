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
    returnPhoto: { type: String, default: '' },
    returnAiAnalysis: {
      confidence: { type: Number },
      flags: { type: [String], default: [] },
      summary: { type: String, default: '' },
      assessedAt: { type: Date }
    },

    // Bottle returns (client preview + driver verification)
    returnUpcs: { type: [String], default: [] },
    returnUpcCounts: {
      type: [
        {
          upc: { type: String },
          quantity: { type: Number }
        }
      ],
      default: []
    },
    verifiedReturnUpcs: { type: [String], default: [] },
    verifiedReturnUpcCounts: {
      type: [
        {
          upc: { type: String },
          quantity: { type: Number }
        }
      ],
      default: []
    },
    estimatedReturnCreditGross: { type: Number, default: 0 }, // dollars (gross)
    estimatedReturnCredit: { type: Number, default: 0 }, // dollars (preview)
    verifiedReturnCreditGross: { type: Number, default: 0 }, // dollars (gross)
    verifiedReturnCredit: { type: Number, default: 0 }, // dollars (driver)
    returnCreditsAppliedAt: { type: Date },
    returnPayoutMethod: { type: String, default: 'CREDIT' },

    items: [
      {
        productId: { type: String, required: true }, // frontendId
        quantity: { type: Number, required: true }
      }
    ],

    total: { type: Number, required: true }, // dollars, pre-credit
    deliveryFee: { type: Number, default: 0 }, // dollars
    deliveryFeeDiscountPercent: { type: Number, default: 0 }, // percent
    deliveryFeeFinal: { type: Number, default: 0 }, // dollars
    creditApplied: { type: Number, default: 0 }, // dollars

    paymentMethod: { type: String, default: 'STRIPE' },

    /**
     * PENDING: order created, stock reserved, payment NOT captured yet
     * PAID: payment captured (after driver verification)
     * CANCELED: canceled/re-stocked (customer cancel redirect or manual owner cancel)
     * EXPIRED: session expired or payment failed (webhook)
     */
    status: { type: String, default: 'PENDING' },

    // Stripe references + amounts (cents)
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    authorizedAt: { type: Date },
    amountAuthorizedCents: { type: Number, default: 0 },
    capturedAt: { type: Date },
    amountCapturedCents: { type: Number, default: 0 },

    // Lifecycle timestamps
    inventoryReleasedAt: { type: Date }, // set when we restock (idempotency gate)
    canceledAt: { type: Date },
    expiredAt: { type: Date },
    cancelReason: { type: String, default: '' },

    paidAt: { type: Date },
    deliveredAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model('Order', orderSchema);
