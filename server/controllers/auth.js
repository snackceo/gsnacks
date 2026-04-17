import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import asyncHandler from '../utils/asyncHandler.js';

import * as userService from '../services/userService.js';
import {
  clearAuthCookie,
  isDriverUsername,
  isOwnerUsername,
  setAuthCookie
} from '../utils/helpers.js';

const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;

const hashResetToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');
const normalizeTier = (tier) => {
  const normalized = String(tier || '').trim().toUpperCase();
  return !normalized || normalized === 'NONE' ? 'COMMON' : normalized;
};
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const mapUserForResponse = (user) => {
  if (!user) return null;
  return {
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
  };
};

export const register = asyncHandler(async (req, res, next) => {
  const { username, password } = req.body || {};
  const trimmedUsername = String(username || '').trim();
  if (!trimmedUsername || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const usernameLower = normalizeUsername(trimmedUsername);
  const existing = await userService.findUserByUsernameLower(usernameLower);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const role = isOwnerUsername(trimmedUsername)
    ? 'OWNER'
    : isDriverUsername(trimmedUsername)
      ? 'DRIVER'
      : 'CUSTOMER';
  const user = await userService.createUser({
    username: trimmedUsername,
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
    ok: true, user: mapUserForResponse(user)
  });
});

export const login = asyncHandler(async (req, res, next) => {
  const { username, password } = req.body || {};
  const trimmedUsername = String(username || '').trim();
  if (!trimmedUsername || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const usernameLower = normalizeUsername(trimmedUsername);
  const user = await userService.findUserByUsernameLower(usernameLower);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const ok = await user.comparePassword(password);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

  // The role stored in the database is the source of truth.
  const role = user.role || 'CUSTOMER';

  const token = jwt.sign(
    { userId: user._id.toString(), username: user.username, role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  setAuthCookie(req, res, token);
  res.json({
    ok: true, user: mapUserForResponse(user)
  });
});

export const logout = (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
};

export const resetRequest = asyncHandler(async (req, res, next) => {
  const { username } = req.body || {};
  const trimmedUsername = String(username || '').trim();
  if (!trimmedUsername) {
    return res.status(400).json({ error: 'Username required' });
  }

  const usernameLower = normalizeUsername(trimmedUsername);
  const user = await userService.findUserByUsernameLower(usernameLower);
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
});

export const resetConfirm = asyncHandler(async (req, res, next) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password required' });
  }

  const tokenHash = hashResetToken(token);
  const user = await userService.findUserByResetToken(tokenHash);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  user.password = password;
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  await user.save();

  res.json({ ok: true });
});

export const getMe = asyncHandler(async (req, res, next) => {
  const user = await userService.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    ok: true, user: mapUserForResponse(user)
  });
});