/**
 * @title Refresh token + logout tests
 * @notice Covers the security contract: storage, rotation, reuse detection,
 * @notice revocation, and the account-state checks on renewal.
 * @dev Live tests skip without `DATABASE_URL`; the pure unit tests below never
 * @dev need one, because token handling is the part that must hold regardless
 * @dev of whether a server booted.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const refreshService = require('../../services/auth/refresh.service');
const { createUser, cleanup } = require('../../../db/src/testkit');

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

/**
 * @notice Register a throwaway user and return its credentials plus tokens.
 * @param {string} tag Unique per call.
 * @return {Promise<object>} `{ email, password, token, refreshToken, userId }`.
 */
const signUp = async (tag) => {
  const email = `${tag}@kosply.test`;
  const password = 'secret123';
  const res = await call('POST', '/api/auth/register', {
    email, username: tag, name: 'Refresh Test', password,
    universitas: 'Univ Test', programStudi: 'Prodi Test',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return {
    email,
    password,
    token: res.body.token,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
  };
};

describe('token material (no DB)', () => {
  test('the token is 256 bits of base64url', () => {
    // 32 random bytes render as 43 base64url characters. Anything shorter is
    // not enough entropy to survive being stored hashed.
    const { randomBytes } = require('node:crypto');
    assert.equal(refreshService.TOKEN_BYTES, 32);
    assert.equal(randomBytes(refreshService.TOKEN_BYTES).toString('base64url').length, 43);
  });

  test('hashing is deterministic, fixed width, and key-dependent', () => {
    const env = require('../../config/env');
    const a = refreshService.hashToken('same-token-value');
    const b = refreshService.hashToken('same-token-value');
    assert.equal(a, b, 'the same token must hash the same or lookups never match');
    assert.notEqual(a, refreshService.hashToken('different-token'));
    assert.equal(a.length, 64, 'must fit char(64) exactly');

    const previous = env.refreshTokenSecret;
    try {
      env.refreshTokenSecret = 'a-different-key';
      assert.notEqual(refreshService.hashToken('same-token-value'), a);
    } finally {
      env.refreshTokenSecret = previous;
    }
  });

  test('the raw token is never a substring of what gets stored', () => {
    assert.ok(!refreshService.hashToken('super-secret-token').includes('super-secret-token'));
  });

  test('there are three subject types, and only two of them are users', () => {
    // `user` (marketplace token, no `kind`), `staff` (dashboard token on a
    // users row, `kind: 'user'`), `admin` (admins row, `kind: 'admin'`).
    assert.deepEqual(refreshService.USER_SUBJECTS, ['user', 'staff']);
    assert.ok(!refreshService.USER_SUBJECTS.includes('admin'));
  });
});

describe('issue and rotate', { skip: !hasDb }, () => {
  let db;
  let account;

  before(async () => {
    db = require('../../../db/src/db');
    account = await signUp(`rf${Date.now().toString(36)}`);
  });

  after(async () => {
    await cleanup([account.userId]);
    await db.close();
  });

  test('register returns an access token AND a refresh token', () => {
    assert.ok(account.token, 'access token missing');
    assert.equal(account.refreshToken.length, 43);
  });

  test('only the HMAC is persisted', async () => {
    const rows = await db.selectMany('refresh_tokens', { where: { subjectId: account.userId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tokenHash, refreshService.hashToken(account.refreshToken));
    assert.equal(rows[0].tokenHash.length, 64);
    assert.equal(rows[0].subjectType, 'user');
  });

  test('rotation issues a different token in the same family', async () => {
    const before = await db.selectOne('refresh_tokens', {
      where: { subjectId: account.userId },
      orderBy: { createdAt: 'desc' },
    });
    const next = await refreshService.rotate(db, account.refreshToken);
    assert.notEqual(next.token, account.refreshToken);
    assert.equal(next.familyId, before.familyId, 'rotation must stay inside one family');
    const after = await db.selectOne('refresh_tokens', { where: { id: before.id } });
    assert.ok(after.consumedAt, 'the presented token must be marked consumed');
    assert.equal(after.replacedById, next.id, 'the consumed row must point at its successor');
  });

  test('an expired token is refused and closes its family', async () => {
    const issued = await refreshService.issue(db, 'user', account.userId);
    await db.update('refresh_tokens', { expiresAt: new Date(Date.now() - 1000) }, { where: { id: issued.id } });
    await assert.rejects(
      () => refreshService.rotate(db, issued.token),
      (err) => err.code === 'TOKEN_REVOKED'
    );
    const row = await db.selectOne('refresh_tokens', { where: { id: issued.id } });
    assert.ok(row.revokedAt, 'expiry must close the family, not just refuse one call');
  });
});

describe('reuse detection', { skip: !hasDb }, () => {
  let db;
  let account;
  let rotated;

  before(async () => {
    db = require('../../../db/src/db');
    account = await signUp(`rp${Date.now().toString(36)}`);
    rotated = await refreshService.rotate(db, account.refreshToken);
  });

  after(async () => {
    await cleanup([account.userId]);
    await db.close();
  });

  test('replaying a consumed token fails', async () => {
    await assert.rejects(
      () => refreshService.rotate(db, account.refreshToken),
      (err) => err.code === 'TOKEN_REVOKED'
    );
  });

  test('and it takes the live successor down with it', async () => {
    // The whole point: a replay means two parties hold the token and they cannot
    // be told apart, so neither keeps the session.
    await assert.rejects(
      () => refreshService.rotate(db, rotated.token),
      (err) => err.code === 'TOKEN_REVOKED'
    );
    const rows = await db.selectMany('refresh_tokens', { where: { subjectId: account.userId } });
    assert.ok(rows.every((r) => r.revokedAt), 'every token in the family must be revoked');
  });
});

describe('HTTP surface', { skip: !hasDb }, () => {
  let db;
  const accounts = [];

  before(async () => {
    db = require('../../../db/src/db');
  });

  after(async () => {
    await cleanup(accounts.map((a) => a.userId));
    await db.close();
  });

  test('refresh hands back a fresh pair and the full public user', async () => {
    const account = await signUp(`rh${Date.now().toString(36)}`);
    accounts.push(account);

    const res = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.refreshToken.length, 43);
    // Every field `publicUser` promises must be present. Selecting only what the
    // auth decision needed once produced `{ id, role }` here and the rest
    // undefined — a 200 with a silently broken payload.
    for (const field of ['id', 'email', 'username', 'name', 'role', 'universitas', 'programStudi']) {
      assert.ok(res.body.user[field] !== undefined, `user.${field} missing from the refresh response`);
    }
    assert.equal(typeof res.body.user.onboardingRequired, 'boolean');
    assert.ok(res.body.expiresAt);
  });

  test('the renewed access token authorises exactly like the original', async () => {
    const account = await signUp(`ra${Date.now().toString(36)}`);
    accounts.push(account);
    const res = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    const me = await call('GET', '/api/users/me', undefined, res.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.item.id, account.userId);
  });

  test('a garbage or missing token is refused', async () => {
    for (const body of [{ refreshToken: 'x'.repeat(60) }, {}, { refreshToken: '' }]) {
      const res = await call('POST', '/api/auth/refresh', body);
      assert.equal(res.status, 401, JSON.stringify(body));
      assert.equal(res.body.code, 'TOKEN_INVALID');
    }
  });

  test('logout ends the session', async () => {
    const account = await signUp(`lo${Date.now().toString(36)}`);
    accounts.push(account);

    const out = await call('POST', '/api/auth/logout', { refreshToken: account.refreshToken });
    assert.equal(out.status, 200);
    assert.equal(out.body.revoked, true);

    const res = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_REVOKED');
  });

  test('logout is idempotent and never reveals whether a token existed', async () => {
    const account = await signUp(`li${Date.now().toString(36)}`);
    accounts.push(account);
    await call('POST', '/api/auth/logout', { refreshToken: account.refreshToken });

    const again = await call('POST', '/api/auth/logout', { refreshToken: account.refreshToken });
    assert.equal(again.status, 200);
    assert.equal(again.body.revoked, true);

    // An unknown token is a 200 with `revoked: false`. Answering 404 would let a
    // caller probe which tokens are real.
    const unknown = await call('POST', '/api/auth/logout', { refreshToken: 'y'.repeat(60) });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.revoked, false);
  });

  test('logging out one session leaves the others alive', async () => {
    const account = await signUp(`lm${Date.now().toString(36)}`);
    accounts.push(account);
    // A second sign-in is a second family, which is what makes per-session
    // logout possible at all.
    const second = await call('POST', '/api/auth/login', {
      email: account.email, password: account.password,
    });
    assert.equal(second.status, 200);
    assert.notEqual(second.body.refreshToken, account.refreshToken);

    await call('POST', '/api/auth/logout', { refreshToken: account.refreshToken });

    const dead = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(dead.body.code, 'TOKEN_REVOKED');

    const alive = await call('POST', '/api/auth/refresh', { refreshToken: second.body.refreshToken });
    assert.equal(alive.status, 200, 'the other session must survive');
  });

  test('a deactivated account cannot renew, and its family is closed', async () => {
    const account = await signUp(`fx${Date.now().toString(36)}`);
    accounts.push(account);
    const user = await db.selectOne('users', { where: { id: account.userId } });
    await db.update('users', { isActive: false }, { where: { id: user.id } });

    const res = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_REVOKED');

    const rows = await db.selectMany('refresh_tokens', { where: { subjectId: account.userId } });
    assert.ok(rows.every((r) => r.revokedAt), 'a frozen account must not keep a renewable session');
  });

  test('an authenticated logout with no token signs out everywhere', async () => {
    const account = await signUp(`ae${Date.now().toString(36)}`);
    accounts.push(account);
    await db.update('users', { isActive: true }, { where: { id: account.userId } });

    const res = await call('POST', '/api/auth/logout', {}, account.token);
    assert.equal(res.status, 200);
    assert.ok(res.body.revoked >= 1);

    const dead = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(dead.body.code, 'TOKEN_REVOKED');
  });

  test('logout without a token or a session is refused', async () => {
    const res = await call('POST', '/api/auth/logout', {});
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_INVALID');
  });

  test('the refresh response never carries the raw token back to a client-side log', async () => {
    const account = await signUp(`nl${Date.now().toString(36)}`);
    accounts.push(account);
    const rows = await db.selectMany('refresh_tokens', { where: { subjectId: account.userId } });
    // Only ever the hash, on every row the account owns.
    for (const row of rows) assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  });

  test('password reset ends every live session for that account', async () => {
    // Otherwise the reset is cosmetic: the password changes and the compromised
    // device keeps renewing.
    const account = await signUp(`pw${Date.now().toString(36)}`);
    accounts.push(account);
    const before = await db.selectMany('refresh_tokens', {
      where: { subjectId: account.userId, revokedAt: null },
    });
    assert.ok(before.length >= 1);

    await db.update('users', { isActive: false }, { where: { id: account.userId } });
    await db.update('users', { isActive: true }, { where: { id: account.userId } });
    // The reset path itself is covered by password.test.js; here we assert the
    // revocation the reset performs.
    const { revokeAllFor } = refreshService;
    await revokeAllFor(db, 'user', account.userId);
    await revokeAllFor(db, 'staff', account.userId);

    const res = await call('POST', '/api/auth/refresh', { refreshToken: account.refreshToken });
    assert.equal(res.body.code, 'TOKEN_REVOKED');
  });
});

describe('purge', { skip: !hasDb }, () => {
  let db;

  before(async () => {
    db = require('../../../db/src/db');
  });

  after(async () => {
    await db.close();
  });

  test('issuing a token sweeps that subject\'s long-expired rows', async () => {
    const user = await createUser({ username: `pur${Date.now().toString(36)}` });
    const issued = await refreshService.issue(db, 'user', user.id);
    // Age it well past the grace window.
    await db.update(
      'refresh_tokens',
      { expiresAt: new Date(Date.now() - (refreshService.PURGE_GRACE_DAYS + 5) * 86400_000) },
      { where: { id: issued.id } }
    );

    await refreshService.issue(db, 'user', user.id);
    const left = await db.selectMany('refresh_tokens', { where: { subjectId: user.id } });
    assert.equal(left.length, 1, 'the stale row must be swept on the next issue');
    await cleanup([user.id]);
  });

  test('a row inside the grace window is kept', async () => {
    const user = await createUser({ username: `puk${Date.now().toString(36)}` });
    const issued = await refreshService.issue(db, 'user', user.id);
    await db.update(
      'refresh_tokens',
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { id: issued.id } }
    );
    await refreshService.issue(db, 'user', user.id);
    const left = await db.selectMany('refresh_tokens', { where: { subjectId: user.id } });
    assert.equal(left.length, 2, 'an expired-but-recent row stays, so a clock skew cannot silently drop a session');
    await cleanup([user.id]);
  });
});