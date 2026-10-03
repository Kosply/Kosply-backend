/**
 * @title Social auth tests (direct Google + Apple, no vendor)
 * @notice Validation runs everywhere; linking runs live (skips without DATABASE_URL).
 * @dev True token E2E needs Flutter + real provider accounts (not faked here).
 */
// Social login is now disabled by default outside development (it used to be
// enabled unless the exact string "false" was set, so a typo left it on in
// production). These tests exercise the token-validation path, so the switch is
// turned on explicitly here.
process.env.GOOGLE_LOGIN_ENABLED = 'true';
process.env.APPLE_LOGIN_ENABLED = 'true';

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

  test('provider switches parse an explicit truthy/falsy set', async () => {
    // Both switches default OFF outside development now, and the parser accepts
    // only a known set. The old `!== 'false'` check treated `0`, `off`, `no` and
    // `FALSE` as *enabled*, so a typo left social login on in production.
    // config/env snapshots process.env at require time, so this runs each case
    // in a child process rather than fighting the module cache.
    const { execFileSync } = require('node:child_process');
    const probe = [
      "const e = require('./lib/server/config/env');",
      "console.log(JSON.stringify({google: e.googleLoginEnabled, apple: e.appleLoginEnabled}));",
    ].join('\n');
    const run = (env) => {
      const out = execFileSync(process.execPath, ['-e', probe], {
        cwd: require('node:path').resolve(__dirname, '../../../..'),
        // A production probe must satisfy the production JWT_SECRET guard,
        // which is itself part of the fix under test.
        env: { ...process.env, JWT_SECRET: 'probe-only-not-a-real-secret-0123456789', ...env },
        encoding: 'utf8',
      });
      return JSON.parse(out.trim());
    };

    for (const off of ['false', '0', 'off', 'no', 'FALSE', ' off ']) {
      const parsed = run({ GOOGLE_LOGIN_ENABLED: off, APPLE_LOGIN_ENABLED: off, NODE_ENV: 'production' });
      assert.equal(parsed.google, false, `GOOGLE_LOGIN_ENABLED=${off} must be off`);
      assert.equal(parsed.apple, false, `APPLE_LOGIN_ENABLED=${off} must be off`);
    }
    for (const on of ['true', '1', 'on', 'yes', 'TRUE']) {
      const parsed = run({ GOOGLE_LOGIN_ENABLED: on, APPLE_LOGIN_ENABLED: on, NODE_ENV: 'production' });
      assert.equal(parsed.google, true, `GOOGLE_LOGIN_ENABLED=${on} must be on`);
      assert.equal(parsed.apple, true, `APPLE_LOGIN_ENABLED=${on} must be on`);
    }
    // Default off outside development: production with nothing set.
    const defaults = run({ NODE_ENV: 'production', GOOGLE_LOGIN_ENABLED: '', APPLE_LOGIN_ENABLED: '' });
    assert.equal(defaults.google, false, 'social login must default off in production');
    assert.equal(defaults.apple, false, 'social login must default off in production');
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
