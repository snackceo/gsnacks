import assert from 'node:assert/strict';
import test from 'node:test';

import { authorize, Roles } from '../middleware/rbac.js';

const makeRes = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});

test('authorize returns unauthorized when req.user is missing', () => {
  const middleware = authorize(Roles.ADMIN);
  const req = {};
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
  assert.equal(nextCalled, false);
});

test('authorize allows owner override', () => {
  const middleware = authorize(Roles.ADMIN);
  const req = { user: { role: 'owner' } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
  assert.equal(nextCalled, true);
});

test('authorize supports case-insensitive role matching', () => {
  const middleware = authorize('admin');
  const req = { user: { role: 'ADMIN' } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
  assert.equal(nextCalled, true);
});

test('authorize returns forbidden for non-allowed non-owner role', () => {
  const middleware = authorize(Roles.ADMIN);
  const req = { user: { role: Roles.CUSTOMER } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
  assert.equal(nextCalled, false);
});
