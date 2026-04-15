import assert from 'node:assert/strict';
import test from 'node:test';
import requireRole from '../middleware/requireRole.js';

const makeRes = () => {
  const res = {
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
  };

  return res;
};

test('requireRole returns unauthorized when req.user is missing', () => {
  const middleware = requireRole(['ADMIN']);
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

test('requireRole returns unauthorized when req.user.role is missing', () => {
  const middleware = requireRole(['ADMIN']);
  const req = { user: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
  assert.equal(nextCalled, false);
});

test('requireRole returns forbidden when authenticated role is not allowed', () => {
  const middleware = requireRole(['ADMIN']);
  const req = { user: { role: 'CUSTOMER' } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
  assert.equal(nextCalled, false);
});

test('requireRole calls next when authenticated role is allowed', () => {
  const middleware = requireRole(['ADMIN']);
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
