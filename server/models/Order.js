import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },

    customerId: { type: String },
    address: { type: String, default: '' },

    /* =========================================================
       ORDER INTENT (AUTHORITATIVE)
       ========================================================= */
    orderType: {
      type: String,
      enum: ['DELIVERY_PURCHASE', 'RETURNS_PICKUP'],
      default: 'DELIVERY_PURCHASE'
    },

    /* =========================================================
       ITEMS / TOTALS
       ========================================================= */
    items: { type: Array, default: [] },
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    /* =========================================================
       ROUTE FEES
       ========================================================= */
    routeFee: { type: Number, default: 0 },
    routeFeeDiscountPercent: { type: Number, default: 0 },
    routeFeeFinal: { type: Number, default: 0 },
    // Legacy alias for routeFee (deprecated).
    deliveryFee: { type: Number, default: 0 },
    deliveryFeeDiscountPercent: { type: Number, default: 0 },
    deliveryFeeFinal: { type: Number, default: 0 },
    distanceMiles: { type: Number, default: 0 },
    distanceFee: { type: Number, default: 0 },
    distanceFeeFinal: { type: Number, default: 0 },

    /* =========================================================
       PAYMENT
       ========================================================= */
    paymentMethod: { type: String, default: 'NONE' },
    status: { type: String, default: 'PENDING' },

    amountAuthorizedCents: { type: Number, default: 0 },
    amountCapturedCents: { type: Number, default: 0 },

    authorizedAt: { type: Date },
    capturedAt: { type: Date },
    pointsAwardedAt: { type: Date },
    creditAuthorizedCents: { type: Number, default: 0 },
    creditAppliedCents: { type: Number, default: 0 },
    creditAppliedAt: { type: Date },

    /* =========================================================
       RETURNS (COMMON)
       ========================================================= */
    returnUpcs: { type: [String], default: [] },
    returnUpcCounts: { type: Array, default: [] },

    /* =========================================================
       RETURNS – CREDIT FLOW (NO FEES)
       ========================================================= */
    estimatedReturnCreditGross: { type: Number, default: 0 },
    estimatedReturnCredit: { type: Number, default: 0 },

    verifiedReturnCreditGross: { type: Number, default: 0 },
    verifiedReturnCredit: { type: Number, default: 0 },

    returnCreditsAppliedAt: { type: Date },

    /* =========================================================
       RETURNS – CASH FLOW (FEES)
       ========================================================= */
    returnPayoutMethod: {
      type: String,
      enum: ['CREDIT', 'CASH'],
      default: 'CREDIT'
    },

    estimatedReturnCashGross: { type: Number, default: 0 },
    estimatedReturnCash: { type: Number, default: 0 },

    verifiedReturnCashGross: { type: Number, default: 0 },
    verifiedReturnCash: { type: Number, default: 0 },

    cashPayoutDue: { type: Number, default: 0 },
    cashPayoutDueAt: { type: Date },
    cashPayoutPaidAt: { type: Date },

    /* =========================================================
       INVENTORY / AUDIT
       ========================================================= */
    inventoryReleasedAt: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model('Order', orderSchema);
