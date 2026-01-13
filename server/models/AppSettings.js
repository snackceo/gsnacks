import mongoose from 'mongoose';

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    deliveryFee: { type: Number, default: 4.99 },
    referralBonus: { type: Number, default: 5.0 },
    michiganDepositValue: { type: Number, default: 0.1 },
    processingFeePercent: { type: Number, default: 0.05 },
    returnHandlingFeePerContainer: { type: Number, default: 0.02 },
    glassHandlingFeePerContainer: { type: Number, default: 0.02 },
    pickupOnlyMultiplier: { type: Number, default: 0.5 },
    dailyReturnLimit: { type: Number, default: 250 },
    maintenanceMode: { type: Boolean, default: false },
    requirePhotoForRefunds: { type: Boolean, default: false },
    allowGuestCheckout: { type: Boolean, default: false },
    showAdvancedInventoryInsights: { type: Boolean, default: false },
    allowPlatinumTier: { type: Boolean, default: false },
    platinumFreeDelivery: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('AppSettings', appSettingsSchema);
