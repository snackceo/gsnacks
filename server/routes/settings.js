import express from 'express';

import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from '../utils/audit.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

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
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier: false,
  platinumFreeDelivery: false,
  dailyReturnLimit: 250,
  deliveryFee: 4.99,
  glassHandlingFeePercent: 0.02,
  michiganDepositValue: 0.1,
  processingFeePercent: 0,
  returnProcessingFeePercent: 0,
  glassHandlingFeePerContainer: 0.02,
  returnHandlingFeePerContainer: 0.02
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
  'deliveryFee',
  'glassHandlingFeePercent',
  'michiganDepositValue',
  'processingFeePercent',
  'returnProcessingFeePercent',
  'glassHandlingFeePerContainer',
  'returnHandlingFeePerContainer'
];

const booleanFields = [
  'maintenanceMode',
  'requirePhotoForRefunds',
  'allowGuestCheckout',
  'showAdvancedInventoryInsights',
  'allowPlatinumTier',
  'platinumFreeDelivery'
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

const parseSettingsInput = (payload, { partial }) => {
  const updates = partial ? {} : { ...defaultSettings };
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

  return { updates };
};

const parseOptionalSettingNumber = value => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
};

const mapSettings = (doc) => ({
  routeFee: Number(doc?.routeFee ?? doc?.deliveryFee ?? defaultSettings.routeFee),
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
  platinumFreeDelivery: Boolean(doc?.platinumFreeDelivery ?? defaultSettings.platinumFreeDelivery),
  dailyReturnLimit: Number(doc?.dailyReturnLimit ?? defaultSettings.dailyReturnLimit),
  deliveryFee: Number(doc?.deliveryFee ?? defaultSettings.deliveryFee),
  glassHandlingFeePercent: Number(doc?.glassHandlingFeePercent ?? defaultSettings.glassHandlingFeePercent),
  michiganDepositValue: Number(doc?.michiganDepositValue ?? defaultSettings.michiganDepositValue),
  processingFeePercent: Number(doc?.processingFeePercent ?? defaultSettings.processingFeePercent),
  returnProcessingFeePercent: Number(doc?.returnProcessingFeePercent ?? defaultSettings.returnProcessingFeePercent),
  glassHandlingFeePerContainer: Number(doc?.glassHandlingFeePerContainer ?? defaultSettings.glassHandlingFeePerContainer),
  returnHandlingFeePerContainer: Number(doc?.returnHandlingFeePerContainer ?? defaultSettings.returnHandlingFeePerContainer)
});

const diffSettings = (before, after) =>
  Object.keys(defaultSettings)
    .filter(key => before?.[key] !== after?.[key])
    .map(key => `${key}: ${before?.[key]} -> ${after?.[key]}`);

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const existing = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
    if (!existing) {
      return res.json({ ok: true, settings: { ...defaultSettings } });
    }

    res.json({ ok: true, settings: mapSettings(existing) });
  } catch (err) {
    console.error('GET SETTINGS ERROR:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

const handleFullSettingsUpdate = async (req, res) => {
  try {
    const { updates, error } = parseSettingsInput(req.body, { partial: false });
    if (error) return res.status(400).json({ error });

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

    res.json({ ok: true, settings: nextSettings });
  } catch (err) {
    console.error('SAVE SETTINGS ERROR:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
};

router.post('/', authRequired, ownerRequired, handleFullSettingsUpdate);

router.put('/', authRequired, ownerRequired, handleFullSettingsUpdate);

router.patch('/', authRequired, ownerRequired, async (req, res) => {
  try {
    const { updates, error } = parseSettingsInput(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

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
    console.error('PATCH SETTINGS ERROR:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
