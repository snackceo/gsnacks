import jwt from 'jsonwebtoken';

import Product from '../models/Product.js';

/* =========================
   COOKIE HELPERS (FIXED LOGOUT)
========================= */
function getCookieOptions(req) {
  const host = (req.headers.host || '').toLowerCase();

  const isLocalhost =
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.includes('0.0.0.0');

  const isNinpoDomain = host.includes('ninposnacks.com');

  const secure = !isLocalhost;
  const base = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  };

  if (isNinpoDomain && !isLocalhost) {
    return { ...base, domain: '.ninposnacks.com' };
  }

  return base;
}

function setAuthCookie(req, res, token) {
  const opts = {
    ...getCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000
  };

  res.cookie('auth_token', token, opts);
}

function clearAuthCookie(req, res) {
  res.clearCookie('auth_token', getCookieOptions(req));

  // Extra safety for mixed testing
  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    domain: '.ninposnacks.com',
    path: '/'
  });

  res.clearCookie('auth_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  });
}

/* =========================
   AUTH HELPERS
========================= */
function authRequired(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...decoded, id: decoded.userId };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
}

function isOwnerUsername(username) {
  const list = (process.env.OWNER_USERNAMES || process.env.OWNER_USERNAME || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  return list.includes((username || '').toLowerCase());
}

function isDriverUsername(username) {
  const list = (process.env.DRIVER_USERNAMES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  return list.includes((username || '').toLowerCase());
}

function ownerRequired(req, res, next) {
  const u = req.user;
  if (!u?.username || !isOwnerUsername(u.username)) {
    return res.status(403).json({ error: 'Owner access required' });
  }
  return next();
}

/* =========================
   CART / ORDER HELPERS
========================= */
function normalizeCart(items) {
  const map = new Map(); // productId -> qty
  for (const it of items || []) {
    const pid = String(it?.productId || '').trim();
    const qty = Number(it?.quantity || 0);
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    map.set(pid, (map.get(pid) || 0) + qty);
  }
  return Array.from(map.entries()).map(([productId, quantity]) => ({
    productId,
    quantity
  }));
}

function mapOrderForFrontend(d) {
  // Frontend enum does not include CANCELED/EXPIRED, so map them to CLOSED.
  const mappedStatus =
    d.status === 'CANCELED' || d.status === 'EXPIRED' ? 'CLOSED' : d.status;

  const authorizedCents = Number(d.amountAuthorizedCents ?? 0);
  const capturedCents = Number(d.amountCapturedCents ?? 0);

  const authorizedAmount = Number.isFinite(authorizedCents)
    ? Math.round((authorizedCents / 100) * 100) / 100
    : 0;

  const capturedAmount =
    d.capturedAt && Number.isFinite(capturedCents)
      ? Math.round((capturedCents / 100) * 100) / 100
      : undefined;

  return {
    id: d.orderId,
    customerId: d.customerId || 'GUEST',
    driverId: d.driverId || undefined,
    items: Array.isArray(d.items) ? d.items : [],
    total: Number(d.total || 0),
    deliveryFee: Number(d.deliveryFeeFinal ?? d.deliveryFee ?? 0),
    creditApplied: Number(d.creditApplied || 0),

    // Bottle returns
    returnUpcs: Array.isArray(d.returnUpcs) ? d.returnUpcs : [],
    verifiedReturnUpcs: Array.isArray(d.verifiedReturnUpcs) ? d.verifiedReturnUpcs : [],
    estimatedReturnCreditGross: Number(d.estimatedReturnCreditGross || 0),
    estimatedReturnCredit: Number(d.estimatedReturnCredit || 0),
    verifiedReturnCreditGross: Number(d.verifiedReturnCreditGross || 0),
    verifiedReturnCredit:
      d.verifiedReturnCredit !== undefined
        ? Number(d.verifiedReturnCredit || 0)
        : undefined,

    // Money movement (dollars)
    authorizedAmount,
    capturedAmount,

    paymentMethod: d.paymentMethod === 'STRIPE' ? 'STRIPE_CARD' : d.paymentMethod,

    address: d.address || '',
    status: mappedStatus,

    createdAt: d.createdAt
      ? new Date(d.createdAt).toISOString()
      : new Date().toISOString(),
    paidAt: d.paidAt ? new Date(d.paidAt).toISOString() : undefined,
    deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : undefined,

    verificationPhoto: d.verificationPhoto || undefined,
    gpsCoords: d.gpsCoords?.lat && d.gpsCoords?.lng ? d.gpsCoords : undefined
  };
}

async function restockOrderItems(order, sessionDb) {
  for (const it of order.items || []) {
    const qty = Number(it.quantity || 0);
    if (!qty || qty <= 0) continue;

    await Product.findOneAndUpdate(
      { frontendId: it.productId },
      { $inc: { stock: qty } },
      { session: sessionDb }
    );
  }
}

async function voidStripeAuthorizationBestEffort(stripe, order) {
  if (!stripe) return;
  const pi = order?.stripePaymentIntentId;
  if (!pi) return;

  try {
    await stripe.paymentIntents.cancel(pi);
  } catch {
    // ignore (best-effort)
  }
}

export {
  authRequired,
  clearAuthCookie,
  getCookieOptions,
  isDriverUsername,
  isOwnerUsername,
  mapOrderForFrontend,
  normalizeCart,
  ownerRequired,
  restockOrderItems,
  setAuthCookie,
  voidStripeAuthorizationBestEffort
};
