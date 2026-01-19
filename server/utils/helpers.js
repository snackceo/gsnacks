import jwt from 'jsonwebtoken';

import Product from '../models/Product.js';
import User from '../models/User.js';

/* =========================
   COOKIE HELPERS (FIXED LOGOUT)
========================= */
function getCookieOptions(req) {
  const host = (req.headers.host || '').toLowerCase();
  const isLocalhost =
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.includes('0.0.0.0');
  const secure = !isLocalhost;
  const sameSite = secure ? 'none' : 'lax';
  const base = {
    httpOnly: true,
    sameSite,
    secure,
    path: '/'
  };
  const cookieDomain = process.env.COOKIE_DOMAIN;
  if (!isLocalhost && cookieDomain) {
    return { ...base, domain: cookieDomain };
  }
  return base;
}

const SESSION_COOKIE_NAME = 'session';
const LEGACY_SESSION_COOKIE_NAME = 'auth_token';

function setAuthCookie(req, res, token) {
  const opts = {
    ...getCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000
  };

  res.cookie(SESSION_COOKIE_NAME, token, opts);
}

function clearAuthCookie(req, res) {
  const cookieDomain = process.env.COOKIE_DOMAIN;
  // Standard clears
  res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions(req));
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, getCookieOptions(req));

  // Extra safety for mixed testing: clear both sameSite: 'none' and 'lax' for secure: true
  if (cookieDomain) {
    // sameSite: 'none', secure: true
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      domain: cookieDomain,
      path: '/'
    });
    res.clearCookie(LEGACY_SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      domain: cookieDomain,
      path: '/'
    });
    // sameSite: 'lax', secure: true (legacy)
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      domain: cookieDomain,
      path: '/'
    });
    res.clearCookie(LEGACY_SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      domain: cookieDomain,
      path: '/'
    });
  }

  // Also clear for insecure (localhost)
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/'
  });
  res.clearCookie(LEGACY_SESSION_COOKIE_NAME, {
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
  const token = req.cookies?.[SESSION_COOKIE_NAME] ?? req.cookies?.[LEGACY_SESSION_COOKIE_NAME];
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

function normalizeReturnPayoutMethod(rawMethod) {
  const normalized = String(rawMethod || '').trim().toUpperCase();
  if (normalized === 'CASH' || normalized === 'CREDIT') {
    return normalized;
  }
  return 'CREDIT';
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

  const entryByUpc = new Map((upcEntries || []).map(entry => [entry?.upc, entry]));
  let eligibleCount = 0;
  for (const [upc, quantity] of countMap.entries()) {
    const entry = entryByUpc.get(upc);
    if (!entry?.isEligible) continue;
    eligibleCount += quantity;
  }

  return eligibleCount * 0.1;
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

async function releaseCreditAuthorization(order, sessionDb) {
  if (!order) return;
  // Idempotency: if creditApplied is already set, capture happened.
  // If inventory is already released, this has been run.
  if (order.creditAppliedCents > 0 || order.inventoryReleasedAt) {
    return;
  }

  const creditToReleaseCents = Number(order.creditAuthorizedCents || 0);
  if (
    creditToReleaseCents > 0 &&
    order.customerId &&
    order.customerId !== 'GUEST'
  ) {
    const user = await User.findById(order.customerId).session(sessionDb);
    if (user) {
      const creditToRelease = creditToReleaseCents / 100;
      const currentBalance = Number(user.creditBalance || 0);
      const currentAuthorized = Number(user.authorizedCreditBalance || 0);

      user.creditBalance = currentBalance + creditToRelease;
      user.authorizedCreditBalance = Math.max(0, currentAuthorized - creditToRelease);
      await user.save({ session: sessionDb });
    }
  }

  // Restock items as part of releasing the hold
  await restockOrderItems(order, sessionDb);
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
    orderType: d.orderType || undefined,
    routeFee: Number(d.routeFeeFinal ?? d.routeFee ?? d.deliveryFeeFinal ?? d.deliveryFee ?? 0),
    distanceMiles: Number(d.distanceMiles || 0),
    distanceFee: Number(d.distanceFeeFinal ?? d.distanceFee ?? 0),
    creditAuthorizedCents: Math.round(Number(d.creditAuthorizedCents || 0)),
    creditAppliedCents: d.creditAppliedAt
      ? Math.round(Number(d.creditAppliedCents || 0))
      : undefined,

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
    returnPayoutMethod: d.returnPayoutMethod || 'CREDIT',

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
    gpsCoords:
      Number.isFinite(d.gpsCoords?.lat) && Number.isFinite(d.gpsCoords?.lng)
        ? d.gpsCoords
        : undefined
  };
}

async function restockOrderItems(order, sessionDb) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return;
  }

  const productUpdates = order.items
    .map(it => {
      const qty = Number(it.quantity || 0);
      if (!it.productId || !qty || qty <= 0) return null;

      return {
        updateOne: {
          filter: { $or: [{ frontendId: it.productId }, { sku: it.productId }] },
          update: { $inc: { stock: qty } }
        }
      };
    })
    .filter(Boolean);

  if (productUpdates.length > 0) {
    await Product.bulkWrite(productUpdates, { session: sessionDb });
  }
}

async function voidStripeAuthorizationBestEffort(stripe, order) {
  if (!stripe || !order?.stripePaymentIntentId) return;

  try {
    await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
  } catch (err) {
    // Ignore if already captured or canceled
    if (err.code === 'payment_intent_unexpected_state') return;
    console.error(`STRIPE VOID FAILED (order ${order.orderId}):`, err);
  }
}

export {
  authRequired,
  clearAuthCookie,
  setAuthCookie,
  buildReturnCountUpdates,
  isDriverUsername,
  isOwnerUsername,
  mapOrderForFrontend,
  normalizeReturnPayoutMethod,
  normalizeCart,
  normalizeUpcCounts,
  calculateReturnFeeSummary,
  sumReturnCredits,
  ownerRequired,
  releaseCreditAuthorization,
  restockOrderItems,
  voidStripeAuthorizationBestEffort
};
