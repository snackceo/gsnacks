import express from 'express';
import mongoose from 'mongoose';
import ReceiptNameAlias from '../models/ReceiptNameAlias.js';
import { authRequired, driverCanAccessStore, isDriverUsername } from '../utils/helpers.js';
import { isDbReady } from '../db/connect.js';

const router = express.Router();

const ALIAS_CONFIDENCE_HALF_LIFE_DAYS = 90;

const createLockToken = () => new mongoose.Types.ObjectId().toString();

const getAliasEffectiveConfidence = (alias, now = new Date()) => {
  const confirmedCount = Number(alias?.confirmedCount || 0);
  const baseConfidence = Math.min(1.0, 0.7 + confirmedCount * 0.1);
  const lastActivityAt = alias?.lastConfirmedAt || alias?.lastSeenAt;

  if (!lastActivityAt) {
    return { baseConfidence, effectiveConfidence: baseConfidence, lastActivityAt: null };
  }

  const ageMs = now.getTime() - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return { baseConfidence, effectiveConfidence: baseConfidence, lastActivityAt };
  }

  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, ageDays / ALIAS_CONFIDENCE_HALF_LIFE_DAYS);
  const effectiveConfidence = Math.max(0, Math.min(1, baseConfidence * decayFactor));

  return { baseConfidence, effectiveConfidence, lastActivityAt };
};

const formatAlias = alias => {
  const { baseConfidence, effectiveConfidence } = getAliasEffectiveConfidence(alias);
  const store = alias.storeId && typeof alias.storeId === 'object' ? alias.storeId : null;
  const product = alias.productId && typeof alias.productId === 'object' ? alias.productId : null;

  return {
    _id: alias._id,
    normalizedName: alias.normalizedName,
    storeId: store?._id || alias.storeId,
    storeName: store?.name || null,
    productId: product?._id || alias.productId,
    productName: product?.name || null,
    productSku: product?.sku || null,
    upc: alias.upc || product?.upc || null,
    confirmedCount: Number(alias.confirmedCount || 0),
    matchConfidence: Number(alias.matchConfidence || 0),
    baseConfidence,
    effectiveConfidence,
    lastSeenAt: alias.lastSeenAt,
    lastConfirmedAt: alias.lastConfirmedAt,
    rawNames: Array.isArray(alias.rawNames) ? alias.rawNames : [],
    lockToken: alias.lockToken || null
  };
};

const ensureAliasAccess = (req, aliasStoreId) => {
  const isDriver = isDriverUsername(req.user?.username);
  const isOwner = req.user?.role === 'OWNER' || req.user?.role === 'MANAGER';

  if (!isDriver && !isOwner) {
    return { ok: false, status: 403, error: 'Driver or manager access required' };
  }

  if (isDriver && !driverCanAccessStore(req.user?.username, aliasStoreId)) {
    return { ok: false, status: 403, error: 'Driver cannot access this store' };
  }

  return { ok: true };
};

router.get('/receipt-aliases', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { storeId, limit } = req.query;
  const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));

  if (storeId) {
    const access = ensureAliasAccess(req, String(storeId));
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
  } else {
    const access = ensureAliasAccess(req, null);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
  }

  try {
    const query = storeId ? { storeId } : {};

    const aliases = await ReceiptNameAlias.find(query)
      .sort({ lastSeenAt: -1 })
      .limit(parsedLimit)
      .populate('storeId', 'name')
      .populate('productId', 'name sku upc')
      .lean();

    const updates = [];
    const now = new Date();

    const formatted = aliases.map(alias => {
      if (!alias.lockToken) {
        const newToken = createLockToken();
        alias.lockToken = newToken;
        updates.push({
          updateOne: {
            filter: { _id: alias._id },
            update: { $set: { lockToken: newToken, lockTokenUpdatedAt: now } }
          }
        });
      }
      return formatAlias(alias);
    });

    if (updates.length > 0) {
      await ReceiptNameAlias.bulkWrite(updates);
    }

    return res.json({ ok: true, aliases: formatted });
  } catch (error) {
    console.error('Error fetching receipt aliases:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch aliases' });
  }
});

router.post('/receipt-alias-confirm', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { aliasId, lockToken } = req.body || {};
  if (!aliasId || !lockToken) {
    return res.status(400).json({ error: 'aliasId and lockToken are required' });
  }

  try {
    const alias = await ReceiptNameAlias.findById(aliasId).populate('storeId', 'name').populate('productId', 'name sku upc');
    if (!alias) {
      return res.status(404).json({ error: 'Alias not found' });
    }

    const access = ensureAliasAccess(req, String(alias.storeId?._id || alias.storeId));
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    if (!alias.lockToken) {
      alias.lockToken = createLockToken();
      alias.lockTokenUpdatedAt = new Date();
      await alias.save();
      return res.status(409).json({
        error: 'Alias lock token missing. Refresh and retry.',
        alias: formatAlias(alias)
      });
    }

    if (alias.lockToken !== lockToken) {
      return res.status(409).json({
        error: 'Alias lock token mismatch. Refresh and retry.',
        alias: formatAlias(alias)
      });
    }

    alias.confirmedCount = Number(alias.confirmedCount || 0) + 1;
    alias.lastConfirmedAt = new Date();
    alias.lastSeenAt = new Date();
    alias.matchConfidence = Math.min(1.0, 0.7 + alias.confirmedCount * 0.1);
    alias.lockToken = createLockToken();
    alias.lockTokenUpdatedAt = new Date();
    await alias.save();

    return res.json({ ok: true, alias: formatAlias(alias) });
  } catch (error) {
    console.error('Error confirming receipt alias:', error);
    return res.status(500).json({ error: error.message || 'Failed to confirm alias' });
  }
});

router.post('/receipt-alias-reject', authRequired, async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Database not ready' });
  }

  const { aliasId, lockToken } = req.body || {};
  if (!aliasId || !lockToken) {
    return res.status(400).json({ error: 'aliasId and lockToken are required' });
  }

  try {
    const alias = await ReceiptNameAlias.findById(aliasId).populate('storeId', 'name').populate('productId', 'name sku upc');
    if (!alias) {
      return res.status(404).json({ error: 'Alias not found' });
    }

    const access = ensureAliasAccess(req, String(alias.storeId?._id || alias.storeId));
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    if (!alias.lockToken) {
      alias.lockToken = createLockToken();
      alias.lockTokenUpdatedAt = new Date();
      await alias.save();
      return res.status(409).json({
        error: 'Alias lock token missing. Refresh and retry.',
        alias: formatAlias(alias)
      });
    }

    if (alias.lockToken !== lockToken) {
      return res.status(409).json({
        error: 'Alias lock token mismatch. Refresh and retry.',
        alias: formatAlias(alias)
      });
    }

    alias.confirmedCount = Math.max(0, Number(alias.confirmedCount || 0) - 1);
    if (alias.confirmedCount === 0) {
      alias.lastConfirmedAt = null;
    }
    alias.lastSeenAt = new Date();
    alias.matchConfidence = Math.min(1.0, 0.7 + alias.confirmedCount * 0.1);
    alias.lockToken = createLockToken();
    alias.lockTokenUpdatedAt = new Date();
    await alias.save();

    return res.json({ ok: true, alias: formatAlias(alias) });
  } catch (error) {
    console.error('Error rejecting receipt alias:', error);
    return res.status(500).json({ error: error.message || 'Failed to reject alias' });
  }
});

export default router;
