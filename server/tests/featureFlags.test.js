import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBool, parseBoolWithReason } from '../utils/featureFlags.js';

test('parseBool accepts shared truthy tokens', () => {
  assert.equal(parseBool('true'), true);
  assert.equal(parseBool(' TRUE '), true);
  assert.equal(parseBool('1'), true);
  assert.equal(parseBool('yes'), true);
  assert.equal(parseBool('on'), true);
});

test('parseBoolWithReason reports unset default and normalization reason', () => {
  assert.deepEqual(parseBoolWithReason(undefined, false), {
    value: false,
    reason: 'env unset; default=false',
    raw: '(unset)',
    normalized: null
  });

  assert.deepEqual(parseBoolWithReason(' YES ', false), {
    value: true,
    reason: 'matched truthy token "yes"',
    raw: ' YES ',
    normalized: 'yes'
  });

  assert.deepEqual(parseBoolWithReason('off', false), {
    value: false,
    reason: 'token "off" is not truthy (true, 1, yes, on)',
    raw: 'off',
    normalized: 'off'
  });
});
