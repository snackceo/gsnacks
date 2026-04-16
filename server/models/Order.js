import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },

    customerId: { type: String, index: true },
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
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          ref: 'Product',
        },
      },
    ],
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    /* =========================================================
       ROUTE FEES
       ========================================================= */
    routeFee: { type: Number, default: 0 },
    routeFeeDiscountPercent: { type: Number, default: 0 },
    routeFeeFinal: { type: Number, default: 0 },
    distanceMiles: { type: Number, default: 0 },
    distanceFee: { type: Number, default: 0 },
    distanceFeeFinal: { type: Number, default: 0 },
   // Handling fees
   largeOrderFee: { type: Number, default: 0 },
   heavyItemFee: { type: Number, default: 0 },

      /* =========================================================
          PRICING LOCK (from checkout-preview)
          ========================================================= */
      pricingLock: {
         payload: { type: mongoose.Schema.Types.Mixed, default: null },
         signature: { type: String, default: '' }
      },

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
    inventoryReleasedAt: { type: Date },

    /* =========================================================
       DRIVER ASSIGNMENT & DELIVERY
       ========================================================= */
    driverId: { type: String, index: true },
    assignedAt: { type: Date },
    pickedUpAt: { type: Date },
    deliveryStartedAt: { type: Date },
    deliveredAt: { type: Date },

    /* =========================================================
       DELIVERY PROOF
       ========================================================= */
    deliveryProof: {
      photo: { type: String, default: null },
      capturedAt: { type: Date, default: null }
    },

    /* =========================================================
       CUSTOMER SIGNATURE
       ========================================================= */
    customerSignature: {
      signature: { type: String, default: null },
      signedAt: { type: Date, default: null }
    },

    /* =========================================================
       DRIVER ITEM NOT FOUND TRACKING
       ========================================================= */
    itemsNotFound: {
      type: [
        {
          sku: String,
          name: String,
          quantity: Number,
          price: Number,
          originalStore: String,
          attemptedStores: [String],
          foundAt: { type: String, default: null },
          foundAtTime: { type: Date, default: null },
          removedAt: { type: Date, default: null }
        }
      ],
      default: []
    }
  },
  { timestamps: true }
);

orderSchema.index({ createdAt: 1 });

export default mongoose.model('Order', orderSchema);
