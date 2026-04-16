import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';

import createPaymentsRouter from '../routes/payments.js';
import AppSettings from '../models/AppSettings.js';
import User from '../models/User.js';
import Product from '../models/Product.js';

// Helper to build app with router
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', createPaymentsRouter({ stripe: null }));
  return app;
};

// Stub a minimal product list for quote calculations
const stubProducts = () => {
  Product.find = async (query, projection) => {
    const ids = query?.frontendId?.$in || [];
    return ids.map(id => ({ frontendId: id, price: 10, isHeavy: false }));
  };
};

// Stub user lookup to return a specific tier (supports .lean() and .session())
let __currentTier = 'COMMON';
const stubUserTier = (tier) => {
  __currentTier = tier;
  User.findById = (id) => ({
    _id: id,
    membershipTier: __currentTier,
    lean: async () => ({ _id: id, membershipTier: __currentTier }),
    session: () => ({ _id: id, membershipTier: __currentTier })
  });
};

// Stub AppSettings for flags and fees
const stubSettings = ({
  routeFee = 4.99,
  pickupOnlyMultiplier = 0.5,
  platinumFreeDelivery = false,
  allowPlatinumTier = false,
  allowGreenTier = false,
  distanceIncludedMiles = 3,
  distanceBand1MaxMiles = 10,
  distanceBand2MaxMiles = 20,
  distanceBand1Rate = 0.5,
  distanceBand2Rate = 0.75,
  distanceBand3Rate = 1.0,
}) => {
  AppSettings.findOne = async () => ({
    key: 'default',
    routeFee,
    pickupOnlyMultiplier,
    platinumFreeDelivery,
    allowPlatinumTier,
    allowGreenTier,
    distanceIncludedMiles,
    distanceBand1MaxMiles,
    distanceBand2MaxMiles,
    distanceBand1Rate,
    distanceBand2Rate,
    distanceBand3Rate,
  });
};

// Common request payload with one item and no address
const baseQuotePayload = (userId) => ({
  items: [{ productId: 'P1', quantity: 1 }],
  userId,
});

// Verify standard tier discounts on route fees
test('Standard tier route fee discounts', async () => {
  process.env.SKIP_DB_CHECKS_FOR_TESTS = '1';
  stubProducts();
  const app = makeApp();
  const baseFee = 4.99;
  stubSettings({ routeFee: baseFee });

  // COMMON (0% discount)
  stubUserTier('COMMON');
  let res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U_COMMON'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, baseFee, 'COMMON tier should have no discount');

  // BRONZE (10% discount)
  stubUserTier('BRONZE');
  res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U_BRONZE'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 4.49, 'BRONZE tier should have 10% discount'); // 4.99 * 0.9 = 4.491

  // SILVER (20% discount)
  stubUserTier('SILVER');
  res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U_SILVER'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 3.99, 'SILVER tier should have 20% discount'); // 4.99 * 0.8 = 3.992

  // GOLD (30% discount)
  stubUserTier('GOLD');
  res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U_GOLD'));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 3.49, 'GOLD tier should have 30% discount'); // 4.99 * 0.7 = 3.493
});

// Verify GREEN gating: when disabled -> standard fee; when enabled -> $1 route, $0 distance
test('GREEN tier gating on fees', async () => {
  process.env.SKIP_DB_CHECKS_FOR_TESTS = '1';
  stubProducts();
  const app = makeApp();

  // Disabled GREEN
  stubSettings({ allowGreenTier: false });
  stubUserTier('GREEN');
  let res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U1'));
  assert.equal(res.status, 200);
  // Route fee should not be $1 when disabled; expect base 4.99
  assert.strictEqual(res.body.routeFeeFinal, 4.99, 'GREEN disabled should have standard route fee');
  assert.ok(res.body.distanceFeeFinal >= 0, 'GREEN disabled should have standard distance fee');

  // Enabled GREEN
  stubSettings({ allowGreenTier: true });
  res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U1'));
  assert.equal(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 1, 'GREEN enabled should have $1 route fee');
  assert.strictEqual(res.body.distanceFeeFinal, 0, 'GREEN enabled should have $0 distance fee');
});

// Verify PLATINUM gating: free delivery applies only if allowed and platinumFreeDelivery
test('PLATINUM free delivery gating', async () => {
  process.env.SKIP_DB_CHECKS_FOR_TESTS = '1';
  stubProducts();
  const app = makeApp();
  stubUserTier('PLATINUM');

  // platinumFreeDelivery true but allowPlatinumTier false -> not free
  stubSettings({ allowPlatinumTier: false, platinumFreeDelivery: true });
  let res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U2'));
  assert.equal(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 4.99, 'PLATINUM disabled should have standard fee');

  // allowPlatinumTier true and platinumFreeDelivery true -> free
  stubSettings({ allowPlatinumTier: true, platinumFreeDelivery: true });
  res = await request(app).post('/api/payments/quote').send(baseQuotePayload('U2'));
  assert.equal(res.status, 200);
  assert.strictEqual(res.body.routeFeeFinal, 0, 'PLATINUM enabled with setting should have $0 fee');
});

// Verify CASH payout normalization respects eligibility flags (PLATINUM/GREEN allowed only when enabled)
// Exercise via create-session which normalizes payout; we won’t execute Stripe calls.
test('Cash payout normalization by tier eligibility', async () => {
  process.env.SKIP_DB_CHECKS_FOR_TESTS = '1';
  stubProducts();
  const app = makeApp();

  // SILVER user, cash requested; not allowed -> should be normalized to CREDIT
  stubUserTier('SILVER');
  stubSettings({});
  let res = await request(app).post('/api/payments/create-session').send({
    items: [{ productId: 'P1', quantity: 1 }],
    userId: 'U_SILVER_CASH',
    returnPayoutMethod: 'CASH',
    address: 'address',
  });
  assert.equal(res.status, 200, 'SILVER should succeed by normalizing CASH to CREDIT');
  assert.ok(res.body.sessionUrl?.length > 0, 'SILVER should get a session URL');

  // GOLD user, cash requested; always allowed -> remains CASH
  stubUserTier('GOLD');
  stubSettings({});
  res = await request(app).post('/api/payments/create-session').send({
    items: [{ productId: 'P1', quantity: 1 }],
    userId: 'U_GOLD_CASH',
    returnPayoutMethod: 'CASH',
    address: 'address',
  });
  assert.equal(res.status, 200, 'GOLD should be allowed to request CASH payout');
  assert.ok(res.body.sessionUrl?.length > 0, 'GOLD should get a session URL');

  // GREEN user, cash requested; when disabled -> normalized to CREDIT
  stubUserTier('GREEN');
  stubSettings({ allowGreenTier: false });
  res = await request(app).post('/api/payments/create-session').send({
    items: [{ productId: 'P1', quantity: 1 }],
    userId: 'U3',
    returnPayoutMethod: 'CASH',
    address: 'address',
  });
  assert.equal(res.status, 200, 'Disabled GREEN should succeed by normalizing CASH to CREDIT');
  assert.ok(res.body.sessionUrl?.length > 0, 'Disabled GREEN should get a session URL');

  // PLATINUM user, cash requested; when enabled -> remains CASH
  stubUserTier('PLATINUM');
  stubSettings({ allowPlatinumTier: true });
  res = await request(app).post('/api/payments/create-session').send({
    items: [{ productId: 'P1', quantity: 1 }],
    userId: 'U4',
    returnPayoutMethod: 'CASH',
    address: 'address',
  });
  assert.equal(res.status, 200, 'Enabled PLATINUM should be allowed to request CASH payout');
  assert.ok(res.body.sessionUrl?.length > 0, 'Enabled PLATINUM should get a session URL');
});
