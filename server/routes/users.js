import express from 'express';

import Order from '../models/Order.js';
import User from '../models/User.js';
import LedgerEntry from '../models/LedgerEntry.js';
import { authRequired, ownerRequired } from '../utils/helpers.js';

const router = express.Router();

const mapUser = (user) => ({
  id: user._id.toString(),
  username: user.username,
  role: user.role || 'CUSTOMER',
  creditBalance: Number(user.creditBalance || 0),
  loyaltyPoints: Number(user.loyaltyPoints || 0),
  membershipTier: user.membershipTier || 'BRONZE',
  createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : undefined
});

const canManageUser = (req, userId) =>
  req.user?.userId === userId ||
  req.user?.id === userId ||
  req.user?.role === 'OWNER';

const recordLedgerEntry = async ({ userId, delta, reason }) => {
  if (!delta) return;
  await LedgerEntry.create({
    userId,
    delta: Number(delta),
    reason: String(reason || '')
  });
};

const mapLedgerEntry = (entry) => ({
  id: entry._id.toString(),
  userId: entry.userId,
  delta: Number(entry.delta || 0),
  reason: entry.reason || '',
  createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined
});

const tierRank = {
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4
};

const autoTierForPoints = (points) => {
  if (points >= 2000) return 'GOLD';
  if (points >= 500) return 'SILVER';
  return 'BRONZE';
};

const maybeAutoPromote = ({ user, previousPoints, nextPoints }) => {
  if (nextPoints <= previousPoints) return;
  if (user.membershipTier === 'PLATINUM') return;

  const autoTier = autoTierForPoints(nextPoints);
  const currentTier = String(user.membershipTier || 'BRONZE').toUpperCase();
  if ((tierRank[autoTier] || 0) > (tierRank[currentTier] || 0)) {
    user.membershipTier = autoTier;
  }
};

router.get('/', authRequired, ownerRequired, async (_req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, users: users.map(mapUser) });
  } catch (err) {
    console.error('USERS LIST ERROR:', err);
    res.status(500).json({ error: 'Failed to load users' });
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
    const allowed = ['creditBalance', 'loyaltyPoints', 'membershipTier', 'role'];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.creditBalance !== undefined) {
      updates.creditBalance = Number(updates.creditBalance || 0);
      if (!Number.isFinite(updates.creditBalance)) {
        return res.status(400).json({ error: 'creditBalance must be a number' });
      }
    }

    if (updates.loyaltyPoints !== undefined) {
      updates.loyaltyPoints = Number(updates.loyaltyPoints || 0);
      if (!Number.isFinite(updates.loyaltyPoints)) {
        return res.status(400).json({ error: 'loyaltyPoints must be a number' });
      }
    }

    if (updates.membershipTier !== undefined) {
      updates.membershipTier = String(updates.membershipTier || '').toUpperCase();
    }

    if (updates.role !== undefined) {
      updates.role = String(updates.role || '').toUpperCase();
    }

    user.set(updates);

    if (updates.loyaltyPoints !== undefined && updates.membershipTier === undefined) {
      const nextPoints = Number(user.loyaltyPoints || 0);
      maybeAutoPromote({ user, previousPoints, nextPoints });
    }

    await user.save();

    const nextCredits = Number(user.creditBalance || 0);
    const nextPoints = Number(user.loyaltyPoints || 0);

    await Promise.all([
      updates.creditBalance !== undefined
        ? recordLedgerEntry({
            userId,
            delta: nextCredits - previousCredits,
            reason: 'ADMIN_SET_CREDITS'
          })
        : Promise.resolve(),
      updates.loyaltyPoints !== undefined
        ? recordLedgerEntry({
            userId,
            delta: nextPoints - previousPoints,
            reason: 'ADMIN_SET_POINTS'
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
      reason: String(req.body?.reason || 'CREDITS_ADJUSTMENT')
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
    if (points > currentPoints) {
      return res.status(400).json({ error: 'Not enough points' });
    }

    const creditsToAdd = points / 1000;

    const previousCredits = Number(user.creditBalance || 0);
    user.loyaltyPoints = Math.max(0, currentPoints - points);
    user.creditBalance = Math.max(0, previousCredits + creditsToAdd);

    await user.save();

    await Promise.all([
      recordLedgerEntry({
        userId,
        delta: Number(user.loyaltyPoints || 0) - currentPoints,
        reason: 'POINTS_REDEEMED'
      }),
      recordLedgerEntry({
        userId,
        delta: Number(user.creditBalance || 0) - previousCredits,
        reason: 'CREDITS_FROM_POINTS'
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

export default router;
