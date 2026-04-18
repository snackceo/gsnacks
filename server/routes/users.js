// Get user's lifetime bottle returns (sum of all finalAcceptedCount from ReturnSettlement)
import express from 'express';
import { getTierBenefits, calculateUserTier, normalizeTier as normalizeTierFromService } from '../services/tierService.js';
import ReturnVerification from '../models/ReturnVerification.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import LedgerEntry, { CREDIT_ORIGINS_ENUM } from '../models/LedgerEntry.js';
import { recordAuditLog } from '../utils/audit.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';
import ReturnSettlement from '../models/ReturnSettlement.js';

const router = express.Router();

router.get('/:id/bottle-returns', authRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    // Find all verifications for this user
    const verifications = await ReturnVerification.find({ customerId: userId }).select('_id');
    const verificationIds = verifications.map(v => v._id);

    // Sum all settlements for these verifications
    const result = await ReturnSettlement.aggregate([
      { $match: { verificationId: { $in: verificationIds } } },
      { $group: { _id: null, total: { $sum: '$finalAcceptedCount' } } }
    ]);
    const lifetimeBottleReturns = result[0]?.total || 0;

    res.json({ ok: true, lifetimeBottleReturns });
  } catch (err) {
    console.error('USER BOTTLE RETURNS ERROR:', err);
    res.status(500).json({ error: 'Failed to load bottle returns' });
  }
});

const mapUser = (user) => ({
  id: user._id.toString(),
  username: user.username,
  role: user.role || 'CUSTOMER',
  creditBalance: Number(user.creditBalance || 0),
  loyaltyPoints: Number(user.loyaltyPoints || 0),
  membershipTier: normalizeTierFromService(user.membershipTier),
  ordersCompleted: Number(user.ordersCompleted || 0),
  phoneVerified: Boolean(user.phoneVerified),
  photoIdVerified: Boolean(user.photoIdVerified),
  createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : undefined
});

const canManageUser = (req, userId) =>
  req.user?.userId === userId ||
  req.user?.id === userId ||
  req.user?.role === 'OWNER';

const recordLedgerEntry = async ({ userId, delta, reason, origin }) => {
  if (!delta) return;
  if (!origin || !CREDIT_ORIGINS_ENUM.includes(origin)) {
    throw new Error(`Invalid credit origin: ${origin}`);
  }
  await LedgerEntry.create({
    userId,
    delta: Number(delta),
    reason: String(reason || ''),
    origin
  });
};

const mapLedgerEntry = (entry) => ({
  id: entry._id.toString(),
  userId: entry.userId,
  delta: Number(entry.delta || 0),
  reason: entry.reason || '',
  createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined
});

const maybeAutoPromote = ({ user }) => {
  // This now uses the centralized tier calculation logic
  const newTier = calculateUserTier({
    orderCount: user.ordersCompleted,
    // totalSpend is not tracked on the user model directly, so we can't use it here.
    // This is a limitation of the current auto-promotion on user update.
    // For full accuracy, stats should be fetched.
    totalSpend: 0,
    phoneVerified: user.phoneVerified,
    photoIdVerified: user.photoIdVerified,
    currentTier: user.membershipTier
  });
  user.membershipTier = newTier;
};

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    // Prevent browser caching for owner-only data
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, users: users.map(mapUser) });
  } catch (err) {
    console.error('USERS LIST ERROR:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.get('/stats', authRequired, ownerRequired, async (_req, res) => {
  try {
    // Prevent browser caching for owner-only data
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const summaries = await Order.aggregate([
      {
        $group: {
          _id: '$customerId',
          orderCount: { $sum: 1 },
          totalSpend: { $sum: { $ifNull: ['$total', 0] } },
          lastOrderAt: { $max: '$createdAt' }
        }
      }
    ]);

    const stats = summaries.map(summary => ({
      userId: String(summary._id),
      orderCount: summary?.orderCount || 0,
      totalSpend: summary?.totalSpend || 0,
      lastOrderAt: summary?.lastOrderAt
        ? new Date(summary.lastOrderAt).toISOString()
        : null
    }));

    res.json({ ok: true, stats });
  } catch (err) {
    console.error('USERS STATS ERROR:', err);
    res.status(500).json({ error: 'Failed to load user stats' });
  }
});

router.get('/:id/stats', authRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    if (!canManageUser(req, userId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const [summary] = await Order.aggregate([
      { $match: { customerId: userId } },
      {
        $group: {
          _id: '$customerId',
          orderCount: { $sum: 1 },
          totalSpend: { $sum: { $ifNull: ['$total', 0] } },
          lastOrderAt: { $max: '$createdAt' }
        }
      }
    ]);

    res.json({
      ok: true,
      stats: {
        userId,
        orderCount: summary?.orderCount || 0,
        totalSpend: summary?.totalSpend || 0,
        lastOrderAt: summary?.lastOrderAt
          ? new Date(summary.lastOrderAt).toISOString()
          : null
      }
    });
  } catch (err) {
    console.error('USER STATS ERROR:', err);
    res.status(500).json({ error: 'Failed to load user stats' });
  }
});

router.get('/:id/ledger', authRequired, ownerRequired, async (req, res) => {
  try {
    // Prevent browser caching for owner-only data
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Vary': 'Cookie, Origin'
    });

    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    const ledger = await LedgerEntry.find({ userId }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, ledger: ledger.map(mapLedgerEntry) });
  } catch (err) {
    console.error('USER LEDGER ERROR:', err);
    res.status(500).json({ error: 'Failed to load ledger' });
  }
});

router.patch('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const previousCredits = Number(user.creditBalance || 0);
    const previousPoints = Number(user.loyaltyPoints || 0);
    const updates = {};
    const allowed = [
      'creditBalance',
      'loyaltyPoints',
      'membershipTier',
      'role',
      'ordersCompleted',
      'phoneVerified',
      'photoIdVerified'
    ];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.creditBalance !== undefined) {
      updates.creditBalance = Number(updates.creditBalance || 0);
      if (!Number.isFinite(updates.creditBalance)) {
        return res.status(400).json({ error: 'creditBalance must be a number' });
      }
      updates.creditBalance = Math.max(0, updates.creditBalance);
    }

    if (updates.loyaltyPoints !== undefined) {
      updates.loyaltyPoints = Number(updates.loyaltyPoints || 0);
      if (!Number.isFinite(updates.loyaltyPoints)) {
        return res.status(400).json({ error: 'loyaltyPoints must be a number' });
      }
      updates.loyaltyPoints = Math.max(0, updates.loyaltyPoints);
    }

    if (updates.membershipTier !== undefined) {
      updates.membershipTier = normalizeTierFromService(updates.membershipTier);
    }

    if (updates.role !== undefined) {
      updates.role = String(updates.role || '').toUpperCase();
    }

    if (updates.ordersCompleted !== undefined) {
      updates.ordersCompleted = Number(updates.ordersCompleted || 0);
      if (!Number.isFinite(updates.ordersCompleted)) {
        return res.status(400).json({ error: 'ordersCompleted must be a number' });
      }
      updates.ordersCompleted = Math.max(0, updates.ordersCompleted);
    }

    if (updates.phoneVerified !== undefined) {
      updates.phoneVerified = Boolean(updates.phoneVerified);
    }

    if (updates.photoIdVerified !== undefined) {
      updates.photoIdVerified = Boolean(updates.photoIdVerified);
    }

    user.set(updates);

    if (
      updates.membershipTier === undefined &&
      (updates.ordersCompleted !== undefined ||
        updates.phoneVerified !== undefined ||
        updates.photoIdVerified !== undefined)
    ) {
      maybeAutoPromote({ user });
    }

    await user.save();

    const nextCredits = Number(user.creditBalance || 0);
    const nextPoints = Number(user.loyaltyPoints || 0);

    await Promise.all([
      updates.creditBalance !== undefined
        ? recordLedgerEntry({
            userId,
            delta: nextCredits - previousCredits,
            reason: 'ADMIN_SET_CREDITS',
            origin: 'MANUAL'
          })
        : Promise.resolve(),
      updates.loyaltyPoints !== undefined
        ? recordLedgerEntry({
            userId,
            delta: nextPoints - previousPoints,
            reason: 'ADMIN_SET_POINTS',
            origin: 'MANUAL'
          })
        : Promise.resolve()
    ]);

    res.json({ ok: true, user: mapUser(user.toObject()) });
  } catch (err) {
    console.error('USER UPDATE ERROR:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.patch('/:id/credits', authRequired, ownerRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({ error: 'amount must be a number' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const previousCredits = Number(user.creditBalance || 0);
    user.creditBalance = Math.max(0, previousCredits + amount);
    await user.save();

    await recordLedgerEntry({
      userId,
      delta: Number(user.creditBalance || 0) - previousCredits,
      reason: String(req.body?.reason || 'CREDITS_ADJUSTMENT'),
      origin: 'MANUAL'
    });

    await recordAuditLog({
      type: 'CREDIT_ADJUSTED',
      actorId: req.user?.username || req.user?.id || 'UNKNOWN',
      details: `Adjusted credits for user ${userId} by ${Number(
        user.creditBalance || 0
      ) - previousCredits} (${String(req.body?.reason || 'CREDITS_ADJUSTMENT')}).`
    });

    res.json({ ok: true, user: mapUser(user) });
  } catch (err) {
    console.error('CREDITS UPDATE ERROR:', err);
    res.status(500).json({ error: 'Failed to update credits' });
  }
});

router.post('/:id/redeem-points', authRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

    if (!canManageUser(req, userId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const points = Number(req.body?.points || 0);
    if (!Number.isFinite(points) || points <= 0) {
      return res.status(400).json({ error: 'points must be a positive number' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentPoints = Number(user.loyaltyPoints || 0);
    const benefits = getTierBenefits({ tier: user.membershipTier });

    if (!benefits.canRedeemPoints) {
      return res.status(400).json({ error: 'Tier not eligible for points redemption' });
    }

    if (points > currentPoints) {
      return res.status(400).json({ error: 'Not enough points' });
    }

    // minRedeemPoints can be 0 for GOLD+, so check for null/undefined
    if (benefits.minRedeemPoints !== null && benefits.minRedeemPoints !== undefined && points < benefits.minRedeemPoints) {
      return res.status(400).json({
        error: `Minimum redemption is ${benefits.minRedeemPoints} points for ${benefits.tier} tier`
      });
    }

    const creditsToAdd = points / 100;

    const previousCredits = Number(user.creditBalance || 0);
    user.loyaltyPoints = Math.max(0, currentPoints - points);
    user.creditBalance = Math.max(0, previousCredits + creditsToAdd);

    await user.save();

    await Promise.all([
      recordLedgerEntry({
        userId,
        delta: Number(user.loyaltyPoints || 0) - currentPoints,
        reason: 'POINTS_REDEEMED',
        origin: 'POINTS'
      }),
      recordLedgerEntry({
        userId,
        delta: Number(user.creditBalance || 0) - previousCredits,
        reason: 'CREDITS_FROM_POINTS',
        origin: 'POINTS'
      })
    ]);

    res.json({
      ok: true,
      creditsAdded: creditsToAdd,
      user: mapUser(user)
    });
  } catch (err) {
    console.error('REDEEM POINTS ERROR:', err);
    res.status(500).json({ error: 'Failed to redeem points' });
  }
});

router.delete('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    // Prevent deleting self
    if (req.user?.id === userId || req.user?.userId === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting other owners
    if (user.role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot delete owner accounts' });
    }

    // Delete the user
    await User.findByIdAndDelete(userId);

    // Log the deletion
    await recordAuditLog({
      type: 'USER_DELETED',
      actorId: req.user?.username || req.user?.id || 'SYSTEM',
      details: `Deleted user: ${user.username || userId}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE USER ERROR:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
