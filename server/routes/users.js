import express from 'express';

import Order from '../models/Order.js';
import User from '../models/User.js';
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

router.patch('/:id', authRequired, ownerRequired, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User id is required' });

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

    const user = await User.findByIdAndUpdate(userId, updates, { new: true }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, user: mapUser(user) });
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

    user.creditBalance = Math.max(0, Number(user.creditBalance || 0) + amount);
    await user.save();

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

    user.loyaltyPoints = Math.max(0, currentPoints - points);
    user.creditBalance = Math.max(0, Number(user.creditBalance || 0) + creditsToAdd);

    await user.save();

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
