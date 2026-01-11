import mongoose from 'mongoose';

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    deliveryFee: { type: Number, default: 4.99 },
    referralBonus: { type: Number, default: 5.0 },
    michiganDepositValue: { type: Number, default: 0.1 },
    processingFeePercent: { type: Number, default: 0.05 },
    glassHandlingFeePercent: { type: Number, default: 0.02 },
    returnProcessingFeePercent: { type: Number, default: 0 },
    dailyReturnLimit: { type: Number, default: 25 },
    maintenanceMode: { type: Boolean, default: false },
    requirePhotoForRefunds: { type: Boolean, default: false },
    allowGuestCheckout: { type: Boolean, default: false },
    showAdvancedInventoryInsights: { type: Boolean, default: false },
    allowPlatinumTier: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model('AppSettings', appSettingsSchema);
