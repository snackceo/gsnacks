import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import User from '../models/User.js';
import {
  authRequired,
  clearAuthCookie,
  isDriverUsername,
  isOwnerUsername,
  setAuthCookie
} from '../utils/helpers.js';

const router = express.Router();
const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;

const hashResetToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');
const normalizeTier = (tier) => {
  const normalized = String(tier || '').trim().toUpperCase();
  return !normalized || normalized === 'NONE' ? 'COMMON' : normalized;
};

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const role = isOwnerUsername(username)
      ? 'OWNER'
      : isDriverUsername(username)
        ? 'DRIVER'
        : 'CUSTOMER';
    const user = await User.create({
      username,
      password,
      role,
      loyaltyPoints: 100,
      creditBalance: 0,
      membershipTier: 'COMMON'
    });

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);
    res.json({
      ok: true,
      user: {
        id: user._id.toString(),
        username: user.username,
        role,
        creditBalance: Number(user.creditBalance || 0),
        loyaltyPoints: Number(user.loyaltyPoints || 0),
        ordersCompleted: Number(user.ordersCompleted || 0),
        phoneVerified: Boolean(user.phoneVerified),
        photoIdVerified: Boolean(user.photoIdVerified),
        membershipTier: normalizeTier(user.membershipTier)
      }
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const role = isOwnerUsername(user.username)
      ? 'OWNER'
      : isDriverUsername(user.username)
        ? 'DRIVER'
        : 'CUSTOMER';
    if (!user.role || user.role !== role) {
      user.role = role;
      await user.save();
    }

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);
    res.json({
      ok: true,
      user: {
        id: user._id.toString(),
        username: user.username,
        role,
        creditBalance: Number(user.creditBalance || 0),
        loyaltyPoints: Number(user.loyaltyPoints || 0),
        ordersCompleted: Number(user.ordersCompleted || 0),
        phoneVerified: Boolean(user.phoneVerified),
        photoIdVerified: Boolean(user.photoIdVerified),
        membershipTier: normalizeTier(user.membershipTier)
      }
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

router.post('/reset-request', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    const user = await User.findOne({ username });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = hashResetToken(token);
      user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await user.save();
    }

    res.json({
      ok: true,
      message:
        'If an account exists for that username, a reset link will be sent.'
    });
  } catch (err) {
    console.error('RESET REQUEST ERROR:', err);
    res.status(500).json({ error: 'Failed to request password reset' });
  }
});

router.post('/reset-confirm', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password required' });
    }

    const tokenHash = hashResetToken(token);
    const user = await User.findOne({
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.password = password;
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('RESET CONFIRM ERROR:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user?.userId || req.user?.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      ok: true,
      user: {
        id: user._id.toString(),
        username: user.username,
        role: user.role || 'CUSTOMER',
        creditBalance: Number(user.creditBalance || 0),
        loyaltyPoints: Number(user.loyaltyPoints || 0),
        ordersCompleted: Number(user.ordersCompleted || 0),
        phoneVerified: Boolean(user.phoneVerified),
        photoIdVerified: Boolean(user.photoIdVerified),
        membershipTier: normalizeTier(user.membershipTier),
        createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('ME ERROR:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

export default router;
