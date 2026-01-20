import mongoose from 'mongoose';

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    routeFee: { type: Number, default: 4.99 },
    // ...existing code...
    referralBonus: { type: Number, default: 5.0 },
    pickupOnlyMultiplier: { type: Number, default: 0.5 },
    distanceIncludedMiles: { type: Number, default: 3.0 },
    distanceBand1MaxMiles: { type: Number, default: 10.0 },
    distanceBand2MaxMiles: { type: Number, default: 20.0 },
    distanceBand1Rate: { type: Number, default: 0.5 },
    distanceBand2Rate: { type: Number, default: 0.75 },
    distanceBand3Rate: { type: Number, default: 1.0 },
    hubLat: { type: Number, default: null },
    hubLng: { type: Number, default: null },
    maintenanceMode: { type: Boolean, default: false },
    requirePhotoForRefunds: { type: Boolean, default: false },
    allowGuestCheckout: { type: Boolean, default: false },
    showAdvancedInventoryInsights: { type: Boolean, default: false },
    allowPlatinumTier: { type: Boolean, default: false },
    allowGreenTier: { type: Boolean, default: false },
    platinumFreeDelivery: { type: Boolean, default: false }
    ,
    storageZones: { type: [String], default: [] },
    productTypes: { type: [String], default: [] },
    scanningModesEnabled: {
      A: { type: Boolean, default: true },
      B: { type: Boolean, default: true },
      C: { type: Boolean, default: true },
      D: { type: Boolean, default: true }
    },
    defaultIncrement: { type: Number, default: 1 },
    cooldownMs: { type: Number, default: 1000 },
    requireSkuForScanning: { type: Boolean, default: true },
    shelfGroupingEnabled: { type: Boolean, default: true }
    ,
    // Handling fees
    largeOrderIncludedItems: { type: Number, default: 10 },
    largeOrderPerItemFee: { type: Number, default: 0.3 },
    heavyItemFeePerUnit: { type: Number, default: 1.5 }
  },
  { timestamps: true }
);

export default mongoose.model('AppSettings', appSettingsSchema);
