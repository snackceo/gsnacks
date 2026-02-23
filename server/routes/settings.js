import express from 'express';

import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from '../utils/audit.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';
import { clearMaintenanceModeCache } from '../utils/maintenanceMode.js';

const router = express.Router();

const SETTINGS_KEY = 'default';

const defaultSettings = {
  routeFee: 4.99,
  referralBonus: 5.0,
  pickupOnlyMultiplier: 0.5,
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0,
  hubLat: null,
  hubLng: null,
  /**
   * Feature toggles and experimental/future features:
   * - maintenanceMode: If true, disables all customer-facing endpoints except health.
   * - requirePhotoForRefunds: If true, customers must upload a photo for refund requests.
   * - allowGuestCheckout: If true, allows orders without user registration.
   * - showAdvancedInventoryInsights: Enables advanced inventory analytics in admin UI.
   * - allowPlatinumTier: Enables Platinum loyalty tier (future/experimental).
   * - platinumFreeDelivery: If true, Platinum tier users get free delivery (future/experimental).
   * - allowReceiptApprovalCreateProduct: If true, receipt approvals may create products from review actions.
   */
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier: false,
  allowGreenTier: false,
  platinumFreeDelivery: false,
  allowReceiptApprovalCreateProduct: false,
  autoUpdateProductPriceFromReceipt: false,
  priceLockDays: 7,
  dailyReturnLimit: 250,
  // deliveryFee removed (legacy)
  glassHandlingFeePercent: 0.02,
  michiganDepositValue: 0.1,
  processingFeePercent: 0,
  returnProcessingFeePercent: 0,
  glassHandlingFeePerContainer: 0.02,
  returnHandlingFeePerContainer: 0.02
  ,
  // Handling Fees
  largeOrderIncludedItems: 10,
  largeOrderPerItemFee: 0.3,
  heavyItemFeePerUnit: 1.5
};

const numericFields = [
  'routeFee',
  'referralBonus',
  'pickupOnlyMultiplier',
  'distanceIncludedMiles',
  'distanceBand1MaxMiles',
  'distanceBand2MaxMiles',
  'distanceBand1Rate',
  'distanceBand2Rate',
  'distanceBand3Rate',
  'dailyReturnLimit',
  // 'deliveryFee',
  'glassHandlingFeePercent',
  'michiganDepositValue',
  'processingFeePercent',
  'returnProcessingFeePercent',
  'glassHandlingFeePerContainer',
  'returnHandlingFeePerContainer',
  'priceLockDays',
  'largeOrderIncludedItems',
  'largeOrderPerItemFee',
  'heavyItemFeePerUnit'
];

const booleanFields = [
  'maintenanceMode',
  'requirePhotoForRefunds',
  'allowGuestCheckout',
  'showAdvancedInventoryInsights',
  'allowPlatinumTier',
  'allowGreenTier',
  'platinumFreeDelivery',
  'allowReceiptApprovalCreateProduct',
  'autoUpdateProductPriceFromReceipt'
];

const optionalNumericFields = ['hubLat', 'hubLng'];

const parseOptionalNumber = (value, field) => {
  if (value === null || value === undefined || value === '') {
    return { value: null };
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { error: `${field} must be a number` };
  }
  return { value: number };
};

const allowedArrayFields = ['storageZones', 'productTypes'];
const allowedObjectFields = ['scanningModesEnabled'];
const parseSettingsInput = (payload, { partial }) => {
  const updates = partial ? {} : { ...defaultSettings };
  // Check for unknown fields
  const allowedFields = new Set([
    ...numericFields,
    ...booleanFields,
    ...optionalNumericFields,
    ...allowedArrayFields,
    ...allowedObjectFields,
    'priceLockDays',
    'defaultIncrement',
    'cooldownMs',
    'requireSkuForScanning',
    'shelfGroupingEnabled',
    'dailyReturnLimit',
    'heavyItemFeePerUnit',
    'largeOrderIncludedItems',
    'largeOrderPerItemFee',
    'glassHandlingFeePercent',
    'michiganDepositValue',
    'processingFeePercent',
    'returnProcessingFeePercent',
    'glassHandlingFeePerContainer',
    'returnHandlingFeePerContainer'
  ]);
  for (const key of Object.keys(payload || {})) {
    if (!allowedFields.has(key)) {
      return { error: `Unknown field: ${key}` };
    }
  }
  for (const field of numericFields) {
    if (payload?.[field] !== undefined || !partial) {
      const value = Number(
        payload?.[field] !== undefined ? payload[field] : defaultSettings[field]
      );
      if (!Number.isFinite(value)) {
        return { error: `${field} must be a number` };
      }
      updates[field] = value;
    }
  }
  for (const field of booleanFields) {
    if (payload?.[field] !== undefined || !partial) {
      updates[field] = Boolean(
        payload?.[field] !== undefined ? payload[field] : defaultSettings[field]
      );
    }
  }
  for (const field of optionalNumericFields) {
    if (payload?.[field] !== undefined || !partial) {
      const rawValue =
        payload?.[field] !== undefined ? payload[field] : defaultSettings[field];
      const { value, error } = parseOptionalNumber(rawValue, field);
      if (error) {
        return { error };
      }
      updates[field] = value;
    }
  }
  // Validate arrays
  for (const field of allowedArrayFields) {
    if (payload?.[field] !== undefined || !partial) {
      const arr = payload?.[field] !== undefined ? payload[field] : defaultSettings[field];
      if (!Array.isArray(arr)) {
        return { error: `${field} must be an array of strings` };
      }
      if (arr.some(v => typeof v !== 'string' || v.length > 64)) {
        return { error: `${field} must only contain strings (max 64 chars each)` };
      }
      updates[field] = arr;
    }
  }
  // Validate scanningModesEnabled object
  if (payload?.scanningModesEnabled !== undefined || !partial) {
    const obj = payload?.scanningModesEnabled !== undefined ? payload.scanningModesEnabled : defaultSettings.scanningModesEnabled;
    if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) {
      return { error: 'scanningModesEnabled must be an object' };
    }
    const allowedModes = ['A','B','C','D','inventoryCreate','upcLookup','driverVerifyContainers','customerReturnScan'];
    for (const k of Object.keys(obj)) {
      if (!allowedModes.includes(k)) {
        return { error: `Unknown scanning mode: ${k}` };
      }
      if (typeof obj[k] !== 'boolean') {
        return { error: `scanningModesEnabled.${k} must be a boolean` };
      }
    }
    updates.scanningModesEnabled = obj;
  }
  // Validate additional simple fields
  if (payload?.defaultIncrement !== undefined || !partial) {
    const v = Number(payload?.defaultIncrement ?? defaultSettings.defaultIncrement);
    if (!Number.isFinite(v) || v < 1 || v > 100) {
      return { error: 'defaultIncrement must be a number between 1 and 100' };
    }
    updates.defaultIncrement = v;
  }
  if (payload?.cooldownMs !== undefined || !partial) {
    const v = Number(payload?.cooldownMs ?? defaultSettings.cooldownMs);
    if (!Number.isFinite(v) || v < 0 || v > 60000) {
      return { error: 'cooldownMs must be a number between 0 and 60000' };
    }
    updates.cooldownMs = v;
  }
  if (payload?.requireSkuForScanning !== undefined || !partial) {
    updates.requireSkuForScanning = Boolean(payload.requireSkuForScanning);
  }
  if (payload?.shelfGroupingEnabled !== undefined || !partial) {
    updates.shelfGroupingEnabled = Boolean(payload.shelfGroupingEnabled);
  }
  return { updates };
};

const parseOptionalSettingNumber = value => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
};

const mapSettings = (doc) => ({
  routeFee: Number(doc?.routeFee ?? defaultSettings.routeFee),
  referralBonus: Number(doc?.referralBonus ?? defaultSettings.referralBonus),
  pickupOnlyMultiplier: Number(doc?.pickupOnlyMultiplier ?? defaultSettings.pickupOnlyMultiplier),
  distanceIncludedMiles: Number(doc?.distanceIncludedMiles ?? defaultSettings.distanceIncludedMiles),
  distanceBand1MaxMiles: Number(doc?.distanceBand1MaxMiles ?? defaultSettings.distanceBand1MaxMiles),
  distanceBand2MaxMiles: Number(doc?.distanceBand2MaxMiles ?? defaultSettings.distanceBand2MaxMiles),
  distanceBand1Rate: Number(doc?.distanceBand1Rate ?? defaultSettings.distanceBand1Rate),
  distanceBand2Rate: Number(doc?.distanceBand2Rate ?? defaultSettings.distanceBand2Rate),
  distanceBand3Rate: Number(doc?.distanceBand3Rate ?? defaultSettings.distanceBand3Rate),
  hubLat: parseOptionalSettingNumber(doc?.hubLat ?? defaultSettings.hubLat),
  hubLng: parseOptionalSettingNumber(doc?.hubLng ?? defaultSettings.hubLng),
  maintenanceMode: Boolean(doc?.maintenanceMode ?? defaultSettings.maintenanceMode),
  requirePhotoForRefunds: Boolean(doc?.requirePhotoForRefunds ?? defaultSettings.requirePhotoForRefunds),
  allowGuestCheckout: Boolean(doc?.allowGuestCheckout ?? defaultSettings.allowGuestCheckout),
  showAdvancedInventoryInsights: Boolean(doc?.showAdvancedInventoryInsights ?? defaultSettings.showAdvancedInventoryInsights),
  allowPlatinumTier: Boolean(doc?.allowPlatinumTier ?? defaultSettings.allowPlatinumTier),
  allowGreenTier: Boolean(doc?.allowGreenTier ?? defaultSettings.allowGreenTier),
  platinumFreeDelivery: Boolean(doc?.platinumFreeDelivery ?? defaultSettings.platinumFreeDelivery),
  allowReceiptApprovalCreateProduct: Boolean(doc?.allowReceiptApprovalCreateProduct ?? defaultSettings.allowReceiptApprovalCreateProduct),
  autoUpdateProductPriceFromReceipt: Boolean(doc?.autoUpdateProductPriceFromReceipt ?? defaultSettings.autoUpdateProductPriceFromReceipt),
  priceLockDays: Number(doc?.priceLockDays ?? defaultSettings.priceLockDays),
  dailyReturnLimit: Number(doc?.dailyReturnLimit ?? defaultSettings.dailyReturnLimit),
  // deliveryFee removed (legacy)
  glassHandlingFeePercent: Number(doc?.glassHandlingFeePercent ?? defaultSettings.glassHandlingFeePercent),
  michiganDepositValue: Number(doc?.michiganDepositValue ?? defaultSettings.michiganDepositValue),
  processingFeePercent: Number(doc?.processingFeePercent ?? defaultSettings.processingFeePercent),
  returnProcessingFeePercent: Number(doc?.returnProcessingFeePercent ?? defaultSettings.returnProcessingFeePercent),
  glassHandlingFeePerContainer: Number(doc?.glassHandlingFeePerContainer ?? defaultSettings.glassHandlingFeePerContainer),
  returnHandlingFeePerContainer: Number(doc?.returnHandlingFeePerContainer ?? defaultSettings.returnHandlingFeePerContainer)
  ,
  largeOrderIncludedItems: Number(doc?.largeOrderIncludedItems ?? defaultSettings.largeOrderIncludedItems),
  largeOrderPerItemFee: Number(doc?.largeOrderPerItemFee ?? defaultSettings.largeOrderPerItemFee),
  heavyItemFeePerUnit: Number(doc?.heavyItemFeePerUnit ?? defaultSettings.heavyItemFeePerUnit)
});

const diffSettings = (before, after) =>
  Object.keys(defaultSettings)
    .filter(key => before?.[key] !== after?.[key])
    .map(key => `${key}: ${before?.[key]} -> ${after?.[key]}`);

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    // Prevent browser caching for owner-only settings (best practice for sensitive data)
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const existing = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
    if (!existing) {
      return res.json({ ok: true, settings: { ...defaultSettings } });
    }
    res.json({ ok: true, settings: mapSettings(existing) });
  } catch (err) {
    // Improved error handling: log request context for diagnostics
    console.error('GET SETTINGS ERROR:', {
      error: err,
      user: res?.locals?.user || 'unknown',
      time: new Date().toISOString()
    });
    res.status(500).json({
      error: 'Settings could not be loaded. Please try again later or contact support if the problem persists.'
    });
  }
});

const handleFullSettingsUpdate = async (req, res) => {
  try {
    const { updates, error } = parseSettingsInput(req.body, { partial: false });
    if (error) {
      return res.status(400).json({
        error: error,
        message: 'Invalid settings update. Please check your input and try again.'
      });
    }

    const current = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
    const previous = mapSettings(current || defaultSettings);

    const doc = await AppSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { key: SETTINGS_KEY, ...updates },
      { new: true, upsert: true }
    ).lean();

    const nextSettings = mapSettings(doc);
    const changes = diffSettings(previous, nextSettings);

    if (changes.length > 0) {
      await recordAuditLog({
        type: 'SETTINGS_UPDATED',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: changes.join(', ')
      });
    }

    // Clear maintenance mode cache when settings are updated
    clearMaintenanceModeCache();

    res.json({ ok: true, settings: nextSettings });
  } catch (err) {
    // Improved error handling: log request context for diagnostics
    console.error('SAVE SETTINGS ERROR:', {
      error: err,
      user: req?.user || 'unknown',
      body: req?.body,
      time: new Date().toISOString()
    });
    res.status(500).json({
      error: 'Settings could not be saved. Please try again later or contact support if the problem persists.'
    });
  }
};

router.post('/', authRequired, ownerRequired, handleFullSettingsUpdate);

router.put('/', authRequired, ownerRequired, handleFullSettingsUpdate);

router.patch('/', authRequired, ownerRequired, async (req, res) => {
  try {
    const { updates, error } = parseSettingsInput(req.body, { partial: true });
    if (error) {
      return res.status(400).json({
        error: error,
        message: 'Invalid settings update. Please check your input and try again.'
      });
    }

    const existing = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
    const previous = mapSettings(existing || defaultSettings);

    const doc = await AppSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: updates, $setOnInsert: { key: SETTINGS_KEY } },
      { new: true, upsert: true }
    ).lean();

    const nextSettings = mapSettings(doc);
    const changes = diffSettings(previous, nextSettings);

    if (changes.length > 0) {
      await recordAuditLog({
        type: 'SETTINGS_UPDATED',
        actorId: req.user?.username || req.user?.id || 'UNKNOWN',
        details: changes.join(', ')
      });
    }

    res.json({ ok: true, settings: nextSettings });
  } catch (err) {
    // Improved error handling: log request context for diagnostics
    console.error('PATCH SETTINGS ERROR:', {
      error: err,
      user: req?.user || 'unknown',
      body: req?.body,
      time: new Date().toISOString()
    });
    res.status(500).json({
      error: 'Settings could not be updated. Please try again later or contact support if the problem persists.'
    });
  }
});

export default router;
