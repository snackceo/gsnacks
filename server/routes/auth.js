import express from 'express';
import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import {
  authRequired,
  clearAuthCookie,
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

    const user = await User.create({ username, password });
    const role = isOwnerUsername(user.username) ? 'OWNER' : 'CUSTOMER';

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);
    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role }
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

    const role = isOwnerUsername(user.username) ? 'OWNER' : 'CUSTOMER';

    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username, role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(req, res, token);
    res.json({
      ok: true,
      user: { id: user._id.toString(), username: user.username, role }
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

router.get('/me', authRequired, (req, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;
