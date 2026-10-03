/**
 * @title Rate limiter tests
 * @notice The suite runs with `RATE_LIMIT=off` so auth tests are not throttled
 * @notice by their own traffic, so this file opts back in explicitly.
 * @dev Before this existed the Express API had no rate limiting at all: 25
 * @dev consecutive failed logins all returned 401 and none were throttled.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.RATE_LIMIT = 'on';

const express = require('express');
const { rateLimit, byAccount, reset } = require('../../middlewares/rateLimit');
const asyncHandler = require('../../middlewares/asyncHandler');
const errorHandler = require('../../middlewares/errorHandler');

/** Build a throwaway app around one limiter and return a fetch helper. */
const mount = (limiter, handler = (req, res) => res.json({ ok: true })) => {
  const app = express();
  app.use(express.json());
  app.post('/probe', limiter, asyncHandler(handler));
  // The real error handler, so a 429 carries the catalog body a client sees.
  app.use(errorHandler);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    hit: async (body = {}) => {
      const res = await fetch(`${base}/probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null), res };
    },
    close: () => new Promise((r) => server.close(r)),
  };
};

describe('rate limiter', () => {
  beforeEach(() => reset());

  test('allows up to the limit then returns 429', async () => {
    const t = mount(rateLimit({ name: 't1', limit: 3, windowMs: 60_000 }));
    try {
      for (let i = 1; i <= 3; i += 1) {
        const r = await t.hit();
        assert.equal(r.status, 200, `request ${i} should pass`);
        assert.equal(r.res.headers.get('ratelimit-remaining'), String(3 - i));
      }
      const blocked = await t.hit();
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.code, 'RATE_LIMITED');
      assert.ok(Number(blocked.res.headers.get('retry-after')) > 0, 'Retry-After must be set');
    } finally {
      await t.close();
    }
  });

  test('the window resets and traffic is allowed again', async () => {
    const t = mount(rateLimit({ name: 't2', limit: 1, windowMs: 120 }));
    try {
      assert.equal((await t.hit()).status, 200);
      assert.equal((await t.hit()).status, 429);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal((await t.hit()).status, 200, 'a new window must allow traffic again');
    } finally {
      await t.close();
    }
  });

  test('buckets are isolated per client', async () => {
    // Different IP => different bucket, so one noisy client cannot lock
    // everybody else out.
    const app = express();
    // Without this, req.ip is always the socket address and X-Forwarded-For is
    // ignored, so every request would share one bucket.
    app.set('trust proxy', true);
    app.use(express.json());
    app.post(
      '/probe',
      rateLimit({ name: 't3', limit: 1, windowMs: 60_000 }),
      (req, res) => res.json({ ok: true })
    );
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (ip) =>
      fetch(`${base}/probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: '{}',
      });
    try {
      assert.equal((await call('1.1.1.1')).status, 200);
      assert.equal((await call('1.1.1.1')).status, 429);
      assert.equal((await call('2.2.2.2')).status, 200, 'a different client is unaffected');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('byAccount keys on IP and normalised email', () => {
    const req = (ip, email) => ({ ip, body: { email } });
    // Case and surrounding whitespace must not create a second bucket, or
    // `User@x.com` and `user@x.com ` would each get a full set of guesses.
    assert.equal(byAccount(req('1.1.1.1', ' User@X.com ')), byAccount(req('1.1.1.1', 'user@x.com')));
    // Different account, same IP => different bucket.
    assert.notEqual(byAccount(req('1.1.1.1', 'a@x.com')), byAccount(req('1.1.1.1', 'b@x.com')));
    // No email at all falls back to the IP alone.
    assert.equal(byAccount(req('1.1.1.1', '')), '1.1.1.1');
  });

  test('RATE_LIMIT=off disables throttling entirely', async () => {
    const previous = process.env.RATE_LIMIT;
    process.env.RATE_LIMIT = 'off';
    try {
      // A fresh module instance so the switch is read at build time.
      delete require.cache[require.resolve('../../middlewares/rateLimit')];
      const off = require('../../middlewares/rateLimit');
      const t = mount(off.rateLimit({ name: 't4', limit: 1, windowMs: 60_000 }));
      try {
        for (let i = 0; i < 5; i += 1) {
          assert.equal((await t.hit()).status, 200);
        }
      } finally {
        await t.close();
      }
    } finally {
      process.env.RATE_LIMIT = previous;
      delete require.cache[require.resolve('../../middlewares/rateLimit')];
    }
  });

  test('a limiter with no usable limit is a programming error', () => {
    assert.throws(() => rateLimit({ limit: 0 }));
    assert.throws(() => rateLimit({}));
  });
});

describe('auth routes are throttled', () => {
  beforeEach(() => reset());

  const app = require('../../app');
  const auth = require('../../services/auth/auth.service');

  const call = async (path, body) => {
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      return await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  };

  test('repeated failed logins are throttled', async () => {
    // The whole point: this used to be unlimited.
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await call('/api/auth/login', {
        email: 'nobody@kosply.test',
        password: 'wrong-password',
      });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.includes(429),
      `expected a 429 among ${statuses.join(',')}`
    );
  });

  test('forgot-password is throttled tighter than login', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await call('/api/auth/forgot-password', { email: 'nobody@kosply.test' });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });
});