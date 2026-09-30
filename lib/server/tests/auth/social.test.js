/**
 * @title Social auth tests (direct Google + Apple, no vendor)
 * @notice Validation runs everywhere; linking runs live (skips without DATABASE_URL).
 * @dev True token E2E needs Flutter + real provider accounts (not faked here).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const social = require('../../services/auth/social.service');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const call = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

describe('social validation (no DB)', () => {
  test('missing google token is 400, never reaches Google', async () => {
    const google = await call('POST', '/api/auth/google', {});
    assert.equal(google.status, 400);
  });

  test('apple is disabled by default (403 before any check)', async () => {
    const apple = await call('POST', '/api/auth/apple', {});
    assert.equal(apple.status, 403);
    assert.equal(apple.body.code, 'SOCIAL_DISABLED');
  });
});

describe('findOrLinkSocial live', () => {
  test('create -> relink by provider -> link by email -> unverified rejected', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `so${Date.now()}`;
    const email = `${tag}@kosply.test`;
    const profile = (over = {}) => ({
      provider: 'google',
      providerId: `g-${tag}`,
      email,
      emailVerified: true,
      name: 'Social Test',
      ...over,
    });
    try {
      const created = await social.findOrLinkSocial(profile());
      assert.equal(created.isNew, true);
      assert.equal(created.onboardingRequired, true);
      assert.equal(created.user.role, 'BUYER');

      const again = await social.findOrLinkSocial(profile());
      assert.equal(again.isNew, false);
      assert.equal(again.user.id, created.user.id);

      await prisma.user.update({
        where: { id: created.user.id },
        data: { googleId: null, universitas: 'U', programStudi: 'P' },
      });
      const linked = await social.findOrLinkSocial(profile());
      assert.equal(linked.isNew, false);
      assert.equal(linked.onboardingRequired, false);

      const bad = await social
        .findOrLinkSocial(profile({ emailVerified: false }))
        .then(
          () => assert.fail('must throw'),
          (err) => err
        );
      assert.equal(bad.code, 'VALIDATION');
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
