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

function normalizeUpcCounts(rawUpcs) {
  const counts = new Map();
  if (Array.isArray(rawUpcs)) {
    for (const entry of rawUpcs) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const upc = String(entry.upc || '').trim();
        const qty = Math.floor(Number(entry.quantity || 0));
        if (!upc || !Number.isFinite(qty) || qty <= 0) continue;
        counts.set(upc, (counts.get(upc) || 0) + qty);
        continue;
      }
      const upc = String(entry || '').trim();
      if (!upc) continue;
      counts.set(upc, (counts.get(upc) || 0) + 1);
    }
  }

  const upcCounts = Array.from(counts.entries()).map(([upc, quantity]) => ({
    upc,
    quantity
  }));
  const flattened = upcCounts.flatMap(entry =>
    Array.from({ length: entry.quantity }, () => entry.upc)
  );
  return {
    upcCounts,
    uniqueUpcs: Array.from(counts.keys()),
    flattened
  };
}

function sumReturnCredits(upcCounts, upcEntries) {
  const countMap = new Map();
  if (Array.isArray(upcCounts)) {
    for (const entry of upcCounts) {
      const upc = String(entry?.upc || '').trim();
      const qty = Math.floor(Number(entry?.quantity || 0));
      if (!upc || !Number.isFinite(qty) || qty <= 0) continue;
      countMap.set(upc, (countMap.get(upc) || 0) + qty);
    }
  }

  return (upcEntries || []).reduce((sum, entry) => {
    if (!entry?.isEligible) return sum;
    const count = countMap.get(entry?.upc) || 0;
    return sum + Number(entry?.depositValue || 0) * count;
  }, 0);
}

function calculateReturnFeeSummary(
  upcCounts,
  upcEntries,
  { returnHandlingFeePerContainer = 0, glassHandlingFeePerContainer = 0 } = {}
) {
  const countMap = new Map();
  if (Array.isArray(upcCounts)) {
    for (const entry of upcCounts) {
      const upc = String(entry?.upc || '').trim();
      const qty = Math.floor(Number(entry?.quantity || 0));
      if (!upc || !Number.isFinite(qty) || qty <= 0) continue;
      countMap.set(upc, (countMap.get(upc) || 0) + qty);
    }
  }

  const entryByUpc = new Map((upcEntries || []).map(entry => [entry?.upc, entry]));
  let totalCount = 0;
  let glassCount = 0;
  for (const [upc, quantity] of countMap.entries()) {
    totalCount += quantity;
    const entry = entryByUpc.get(upc);
    if (entry?.isGlass || entry?.containerType === 'glass') {
      glassCount += quantity;
    }
  }

  const baseFee = Math.max(0, Number(returnHandlingFeePerContainer || 0)) * totalCount;
  const glassFee = Math.max(0, Number(glassHandlingFeePerContainer || 0)) * glassCount;
  const totalFee = baseFee + glassFee;

  return {
    totalCount,
    glassCount,
    baseFee,
    glassFee,
    totalFee
  };
}

function buildReturnCountUpdates(order) {
  const updates = {};
  if (
    (!Array.isArray(order.returnUpcCounts) || order.returnUpcCounts.length === 0) &&
    Array.isArray(order.returnUpcs) &&
    order.returnUpcs.length > 0
  ) {
    updates.returnUpcCounts = normalizeUpcCounts(order.returnUpcs).upcCounts;
  }
  if (
    (!Array.isArray(order.verifiedReturnUpcCounts) ||
      order.verifiedReturnUpcCounts.length === 0) &&
    Array.isArray(order.verifiedReturnUpcs) &&
    order.verifiedReturnUpcs.length > 0
  ) {
    updates.verifiedReturnUpcCounts = normalizeUpcCounts(order.verifiedReturnUpcs).upcCounts;
  }
  return updates;
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
    returnUpcCounts:
      Array.isArray(d.returnUpcCounts) && d.returnUpcCounts.length > 0
        ? d.returnUpcCounts
        : normalizeUpcCounts(d.returnUpcs).upcCounts,
    verifiedReturnUpcCounts:
      Array.isArray(d.verifiedReturnUpcCounts) && d.verifiedReturnUpcCounts.length > 0
        ? d.verifiedReturnUpcCounts
        : normalizeUpcCounts(d.verifiedReturnUpcs).upcCounts,
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
    returnPhoto: d.returnPhoto || undefined,
    returnAiAnalysis:
      d.returnAiAnalysis &&
      (d.returnAiAnalysis.summary ||
        d.returnAiAnalysis.confidence !== undefined ||
        (Array.isArray(d.returnAiAnalysis.flags) && d.returnAiAnalysis.flags.length > 0))
        ? {
            confidence: Number(d.returnAiAnalysis.confidence ?? 0),
            flags: Array.isArray(d.returnAiAnalysis.flags) ? d.returnAiAnalysis.flags : [],
            summary: d.returnAiAnalysis.summary || undefined,
            assessedAt: d.returnAiAnalysis.assessedAt
              ? new Date(d.returnAiAnalysis.assessedAt).toISOString()
              : undefined
          }
        : undefined,
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
  buildReturnCountUpdates,
  clearAuthCookie,
  getCookieOptions,
  isDriverUsername,
  isOwnerUsername,
  calculateReturnFeeSummary,
  mapOrderForFrontend,
  normalizeCart,
  normalizeUpcCounts,
  ownerRequired,
  restockOrderItems,
  setAuthCookie,
  sumReturnCredits,
  voidStripeAuthorizationBestEffort
};
