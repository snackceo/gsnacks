import express from 'express';

import AppSettings from '../models/AppSettings.js';
import { recordAuditLog } from '../utils/audit.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const SETTINGS_KEY = 'default';

const defaultSettings = {
  deliveryFee: 4.99,
  referralBonus: 5.0,
  michiganDepositValue: 0.1,
  processingFeePercent: 0.05,
  returnHandlingFeePerContainer: 0.02,
  glassHandlingFeePerContainer: 0.02,
  dailyReturnLimit: 250,
  maintenanceMode: false,
  requirePhotoForRefunds: false,
  allowGuestCheckout: false,
  showAdvancedInventoryInsights: false,
  allowPlatinumTier: false,
  platinumFreeDelivery: false
};

const numericFields = [
  'deliveryFee',
  'referralBonus',
  'michiganDepositValue',
  'processingFeePercent',
  'returnHandlingFeePerContainer',
  'glassHandlingFeePerContainer',
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
  deliveryFee: Number(doc?.deliveryFee ?? defaultSettings.deliveryFee),
  referralBonus: Number(doc?.referralBonus ?? defaultSettings.referralBonus),
  michiganDepositValue: Number(
    doc?.michiganDepositValue ?? defaultSettings.michiganDepositValue
  ),
  processingFeePercent: Number(
    doc?.processingFeePercent ?? defaultSettings.processingFeePercent
  ),
  returnHandlingFeePerContainer: Number(
    doc?.returnHandlingFeePerContainer ?? defaultSettings.returnHandlingFeePerContainer
  ),
  glassHandlingFeePerContainer: Number(
    doc?.glassHandlingFeePerContainer ?? defaultSettings.glassHandlingFeePerContainer
  ),
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
