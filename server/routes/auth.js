import express from 'express';
import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import {
  authRequired,
  clearAuthCookie,
  isDriverUsername,
  isOwnerUsername,
  setAuthCookie
} from '../utils/helpers.js';

const router = express.Router();

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
      membershipTier: 'BRONZE'
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
        membershipTier: user.membershipTier || 'BRONZE'
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
        membershipTier: user.membershipTier || 'BRONZE'
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
        membershipTier: user.membershipTier || 'BRONZE',
        createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined
      }
    });
  } catch (err) {
    console.error('ME ERROR:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

export default router;
