import express from 'express';

import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from '../utils/audit.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const SETTINGS_KEY = 'default';

const defaultSettings = {
  routeFee: 4.99,
  referralBonus: 5.0,
  processingFeePercent: 0.05,
  pickupOnlyMultiplier: 0.5,
  distanceIncludedMiles: 3.0,
  distanceBand1MaxMiles: 10.0,
  distanceBand2MaxMiles: 20.0,
  distanceBand1Rate: 0.5,
  distanceBand2Rate: 0.75,
  distanceBand3Rate: 1.0,
  dailyReturnLimit: 250,
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier: false,
  platinumFreeDelivery: false
};

const numericFields = [
  'routeFee',
  'referralBonus',
  'processingFeePercent',
  'pickupOnlyMultiplier',
  'distanceIncludedMiles',
  'distanceBand1MaxMiles',
  'distanceBand2MaxMiles',
  'distanceBand1Rate',
  'distanceBand2Rate',
  'distanceBand3Rate',
  'dailyReturnLimit'
];

const booleanFields = [
  'maintenanceMode',
  'requirePhotoForRefunds',
  'allowGuestCheckout',
  'showAdvancedInventoryInsights',
  'allowPlatinumTier',
  'platinumFreeDelivery'
];

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

  return { updates };
};

const mapSettings = (doc) => ({
  routeFee: Number(doc?.routeFee ?? doc?.deliveryFee ?? defaultSettings.routeFee),
  referralBonus: Number(doc?.referralBonus ?? defaultSettings.referralBonus),
  processingFeePercent: Number(
    doc?.processingFeePercent ?? defaultSettings.processingFeePercent
  ),
  pickupOnlyMultiplier: Number(
    doc?.pickupOnlyMultiplier ?? defaultSettings.pickupOnlyMultiplier
  ),
  distanceIncludedMiles: Number(
    doc?.distanceIncludedMiles ?? defaultSettings.distanceIncludedMiles
  ),
  distanceBand1MaxMiles: Number(
    doc?.distanceBand1MaxMiles ?? defaultSettings.distanceBand1MaxMiles
  ),
  distanceBand2MaxMiles: Number(
    doc?.distanceBand2MaxMiles ?? defaultSettings.distanceBand2MaxMiles
  ),
  distanceBand1Rate: Number(doc?.distanceBand1Rate ?? defaultSettings.distanceBand1Rate),
  distanceBand2Rate: Number(doc?.distanceBand2Rate ?? defaultSettings.distanceBand2Rate),
  distanceBand3Rate: Number(doc?.distanceBand3Rate ?? defaultSettings.distanceBand3Rate),
  dailyReturnLimit: Number(doc?.dailyReturnLimit ?? defaultSettings.dailyReturnLimit),
  maintenanceMode: Boolean(doc?.maintenanceMode ?? defaultSettings.maintenanceMode),
  requirePhotoForRefunds: Boolean(
    doc?.requirePhotoForRefunds ?? defaultSettings.requirePhotoForRefunds
  ),
  allowGuestCheckout: Boolean(
    doc?.allowGuestCheckout ?? defaultSettings.allowGuestCheckout
  ),
  showAdvancedInventoryInsights: Boolean(
    doc?.showAdvancedInventoryInsights ?? defaultSettings.showAdvancedInventoryInsights
  ),
  allowPlatinumTier: Boolean(
    doc?.allowPlatinumTier ?? defaultSettings.allowPlatinumTier
  ),
  platinumFreeDelivery: Boolean(
    doc?.platinumFreeDelivery ?? defaultSettings.platinumFreeDelivery
  )
});

const diffSettings = (before, after) =>
  Object.keys(defaultSettings)
    .filter(key => before?.[key] !== after?.[key])
    .map(key => `${key}: ${before?.[key]} -> ${after?.[key]}`);

router.get('/', async (_req, res) => {
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

router.post('/', authRequired, ownerRequired, async (req, res) => {
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
    console.error('POST SETTINGS ERROR:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

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
