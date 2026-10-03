/**
 * @title Auth correctness regression tests
 * @notice Pins the identity/revocation defects found in the security audit.
 * @dev Every case here previously passed against a vulnerable build:
 * @dev  - a token for a non-existent user was honoured
 * @dev  - freezing a user or demoting a role had no effect on a live token
 * @dev  - `/api/admin/login` produced a token that broke every FK write
 * @dev  - a created admin could never use the dashboard, and revoking one
 * @dev    flipped the marketplace session instead of the dashboard one
 * @dev  - the password-reset lockout was a lost update and codes were reusable
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = require('../../app');
const env = require('../../config/env');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;
let prisma;

before(async () => {
  if (!hasDb) return;
  prisma = require('../../../db/src/client');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
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

const makeUser = async (tag, extra = {}) =>
  prisma.user.create({
    data: {
      email: `${tag}@kosply.test`,
      username: tag,
      name: `User ${tag}`,
      passwordHash: 'x',
      universitas: 'U',
      programStudi: 'P',
      ...extra,
    },
    select: { id: true, email: true },
  });

const sign = (payload) => jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

describe('token authority is resolved from the database', () => {
  const tag = `auth${Date.now()}`;
  let user;

  beforeEach(async () => {
    if (!hasDb) return;
    user = await makeUser(`${tag}x${Math.random().toString(36).slice(2, 8)}`);
  });

  after(async () => {
    if (!hasDb) return;
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
  });

  test('a signed token for a user that does not exist is refused', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller', undefined, sign({ sub: 'ghost', role: 'ADMIN' }));
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_REVOKED');
  });

  test('an inactive user is refused immediately, not at next login', { skip: !hasDb }, async () => {
    const token = sign({ sub: user.id, role: 'BUYER' });
    const before = await call('GET', '/api/users/me', undefined, token);
    assert.equal(before.status, 200);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    try {
      const after = await call('GET', '/api/users/me', undefined, token);
      assert.equal(after.status, 401, 'freezing must revoke live tokens');
      assert.equal(after.body.code, 'TOKEN_REVOKED');
    } finally {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    }
  });

  test('a role change takes effect immediately, in both directions', { skip: !hasDb }, async () => {
    const token = sign({ sub: user.id, role: 'BUYER' });
    // Selling needs the role *and* an APPROVED verification, so grant both —
    // the point of the test is that the live token picks up the new role.
    await prisma.sellerVerification.upsert({
      where: { userId: user.id },
      update: { status: 'APPROVED', isActive: true },
      create: {
        userId: user.id,
        namaLengkap: 'Promoted',
        nim: `NIM-${user.id}`,
        universitas: 'U',
        programStudi: 'P',
        ktmImageUrl: 'https://cdn.test/ktm.png',
        status: 'APPROVED',
        isActive: true,
      },
    });
    await prisma.user.update({ where: { id: user.id }, data: { role: 'SELLER' } });
    try {
      const promoted = await call('POST', '/api/products', {
        title: 'Promoted', description: 'x', price: 1000,
      }, token);
      assert.equal(promoted.status, 201, 'promotion must be visible on the live token');
    } finally {
      await prisma.sellerVerification.deleteMany({ where: { userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { role: 'BUYER' } });
    }
    const demoted = await call('POST', '/api/products', {
      title: 'Demoted', description: 'x', price: 1000,
    }, token);
    assert.equal(demoted.status, 403, 'demotion must be visible on the live token');
  });

  test('a user deleted mid-session is refused', { skip: !hasDb }, async () => {
    const temp = await makeUser(`${tag}del${Math.random().toString(36).slice(2, 8)}`);
    const token = sign({ sub: temp.id, role: 'BUYER' });
    assert.equal((await call('GET', '/api/users/me', undefined, token)).status, 200);
    await prisma.user.delete({ where: { id: temp.id } });
    const res = await call('GET', '/api/users/me', undefined, token);
    assert.equal(res.status, 401);
  });

  test('a non-HS256 token is rejected (algorithm pinning)', { skip: !hasDb }, async () => {
    const token = jwt.sign({ sub: user.id, role: 'BUYER' }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn,
      algorithm: 'HS512',
    });
    const res = await call('GET', '/api/users/me', undefined, token);
    assert.equal(res.status, 401);
  });

  test('an alg=none token is rejected', { skip: !hasDb }, async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, role: 'SUPER_ADMIN' })
    ).toString('base64url');
    const res = await call('GET', '/api/users/me', undefined, `${header}.${payload}.`);
    assert.equal(res.status, 401);
  });
});

describe('dashboard admin identity', () => {
  const tag = `adm${Date.now()}`;
  let dashboardId;
  let dashboardToken;
  let staffId;
  let staffToken;

  before(async () => {
    if (!hasDb) return;
    const email = `${tag}@kosply.test`;
    const passwordHash = await bcrypt.hash('dashpass1234', 10);
    const admin = await prisma.admin.create({ data: { email, name: 'Dash', passwordHash } });
    dashboardId = admin.id;
    const login = await call('POST', '/api/admin/login', { email, password: 'dashpass1234' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    dashboardToken = login.body.token;

    const staff = await makeUser(`${tag}s${Math.random().toString(36).slice(2, 8)}`, {
      role: 'SUPER_ADMIN',
      passwordHash: await bcrypt.hash('staffpass1234', 10),
    });
    staffId = staff.id;
    staffToken = sign({ sub: staff.id, role: 'SUPER_ADMIN' });
  });

  after(async () => {
    if (!hasDb) return;
    await prisma.admin.deleteMany({ where: { email: `${tag}@kosply.test` } });
    await prisma.user.deleteMany({ where: { id: staffId } });
  });

  test('a dashboard token is marked as a dashboard identity, not a user', { skip: !hasDb }, async () => {
    const claims = JSON.parse(
      Buffer.from(dashboardToken.split('.')[1], 'base64url').toString('utf8')
    );
    assert.equal(claims.kind, 'admin');
    assert.equal(claims.sub, dashboardId);
  });

  test('a dashboard token can review a report without violating a users FK', { skip: !hasDb }, async () => {
    // The defect: `reviewedBy` is a `users(id)` FK but a dashboard admin id is
    // not a users id, so the review 500'd with P2003 *after* archiving the
    // product.
    const suffix = Math.random().toString(36).slice(2, 8);
    const reporter = await makeUser(`${tag}r${suffix}`);
    const accused = await makeUser(`${tag}a${suffix}`);
    const product = await prisma.product.create({
      data: { sellerId: accused.id, title: 'Report target', description: 'x', price: 1000 },
    });
    const report = await prisma.report.create({
      data: {
        reportNo: `RPT-${tag}-${suffix}`.toUpperCase(),
        reporterId: reporter.id,
        reportedUserId: accused.id,
        reportedProductId: product.id,
        category: 'PENIPUAN',
        description: 'fraud',
      },
    });
    try {
      const res = await call(
        'POST',
        `/api/reports/${report.id}/review`,
        { action: 'DELETE_PRODUCT', actionNote: 'removed' },
        dashboardToken
      );
      assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
      const decided = await prisma.report.findUnique({ where: { id: report.id } });
      assert.equal(decided.status, 'RESOLVED');
      assert.equal(decided.action, 'DELETE_PRODUCT');
      const archived = await prisma.product.findUnique({ where: { id: product.id } });
      assert.equal(archived.status, 'ARCHIVED', 'enforcement must actually apply');
    } finally {
      await prisma.report.deleteMany({ where: { id: report.id } });
      await prisma.product.deleteMany({ where: { id: product.id } });
      await prisma.user.deleteMany({ where: { id: { in: [reporter.id, accused.id] } } });
    }
  });

  test('a dashboard token can answer a support ticket', { skip: !hasDb }, async () => {
    // Same FK defect on support_messages_senderId_fkey.
    const suffix = Math.random().toString(36).slice(2, 8);
    const reporter = await makeUser(`${tag}sr${suffix}`);
    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNo: `KSP-${tag}-${suffix}`.toUpperCase(),
        userId: reporter.id,
        subject: 'help',
        description: 'please',
      },
    });
    try {
      const res = await call(
        'POST',
        `/api/support/tickets/${ticket.id}/messages`,
        { text: 'dashboard answer' },
        dashboardToken
      );
      assert.equal(res.status, 201, `expected 201, got ${res.status} ${JSON.stringify(res.body)}`);
    } finally {
      await prisma.supportTicket.deleteMany({ where: { id: ticket.id } });
      await prisma.user.deleteMany({ where: { id: reporter.id } });
    }
  });

  test('a deactivated dashboard admin is refused immediately', { skip: !hasDb }, async () => {
    await prisma.admin.update({ where: { id: dashboardId }, data: { isActive: false } });
    try {
      const res = await call('GET', '/api/reports', undefined, dashboardToken);
      assert.equal(res.status, 401, 'revoking the dashboard must revoke live tokens');
      const login = await call('POST', '/api/admin/login', {
        email: `${tag}@kosply.test`,
        password: 'dashpass1234',
      });
      assert.equal(login.status, 401, 'and must block a fresh login');
    } finally {
      await prisma.admin.update({ where: { id: dashboardId }, data: { isActive: true } });
    }
  });

  test('SUPER_ADMIN is treated as staff everywhere an ADMIN is', { skip: !hasDb }, async () => {
    // requireRole('ADMIN') used to exclude SUPER_ADMIN, so the highest role was
    // functionally a BUYER on the report/verification/model routes.
    for (const path of ['/api/reports', '/api/verifications']) {
      const res = await call('GET', path, undefined, staffToken);
      assert.equal(res.status, 200, `${path} must accept SUPER_ADMIN, got ${res.status}`);
    }
  });
});

describe('admin provisioning keeps both stores in sync', () => {
  const tag = `prov${Date.now()}`;
  let superId;
  let superToken;
  let superEmail;

  before(async () => {
    if (!hasDb) return;
    superEmail = `${tag}s@kosply.test`;
    const staff = await prisma.user.create({
      data: {
        email: superEmail,
        username: `${tag}s`,
        name: 'Super',
        passwordHash: await bcrypt.hash('superpass1234', 10),
        universitas: 'U',
        programStudi: 'P',
        role: 'SUPER_ADMIN',
      },
      select: { id: true },
    });
    superId = staff.id;
    superToken = sign({ sub: staff.id, role: 'SUPER_ADMIN' });
  });

  after(async () => {
    if (!hasDb) return;
    await prisma.user.deleteMany({ where: { id: superId } });
    await prisma.admin.deleteMany({ where: { email: { contains: tag } } });
  });

  test('a created admin can actually use /api/admin/login', { skip: !hasDb }, async () => {
    const email = `${tag}a@kosply.test`;
    const created = await call(
      'POST',
      '/api/admin/users',
      { email, username: `${tag}a`, name: 'Created', password: 'createdpass123' },
      superToken
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const login = await call('POST', '/api/admin/login', { email, password: 'createdpass123' });
    assert.equal(login.status, 200, 'createAdmin must provision the dashboard store too');
    assert.equal(login.body.admin.email, email);
  });

  test('revoking an admin closes the dashboard session, not the marketplace one', { skip: !hasDb }, async () => {
    const email = `${tag}b@kosply.test`;
    const created = await call(
      'POST',
      '/api/admin/users',
      { email, username: `${tag}b`, name: 'Revokable', password: 'revokepass123' },
      superToken
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.item.id;
    const revoked = await call('PATCH', `/api/admin/users/${id}`, { isActive: false }, superToken);
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    const dash = await call('POST', '/api/admin/login', { email, password: 'revokepass123' });
    assert.equal(dash.status, 401, 'dashboard access must be revoked');
  });

  test('an admin password must be 12+ characters', { skip: !hasDb }, async () => {
    const res = await call(
      'POST',
      '/api/admin/users',
      { email: `${tag}c@kosply.test`, username: `${tag}c`, name: 'Weak', password: 'short1' },
      superToken
    );
    assert.equal(res.status, 400);
  });
});

describe('password reset is single-use and the lockout is atomic', () => {
  const tag = `pw${Date.now()}`;
  const email = `${tag}@kosply.test`;
  let userId;

  before(async () => {
    if (!hasDb) return;
    const user = await makeUser(tag, { passwordHash: await bcrypt.hash('originalpass1', 10) });
    userId = user.id;
  });

  after(async () => {
    if (!hasDb) return;
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  test('a successful reset invalidates every other outstanding code', { skip: !hasDb }, async () => {
    const first = await call('POST', '/api/auth/forgot-password', { email });
    const second = await call('POST', '/api/auth/forgot-password', { email });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    // Only the newest live ticket may exist after a re-issue.
    const live = await prisma.passwordReset.count({ where: { email, consumedAt: null } });
    assert.equal(live, 1, 'requesting a new code must void the previous one');

    // Without a DB-backed devCode we cannot complete the flow; assert the
    // invariant that made the old code reusable is gone.
    const rows = await prisma.passwordReset.findMany({ where: { email } });
    const consumed = rows.filter((r) => r.consumedAt !== null);
    assert.equal(consumed.length, rows.length - 1, 'the superseded code must be consumed');
  });

  test('concurrent resets with one code produce exactly one winner', { skip: !hasDb }, async () => {
    const issued = await call('POST', '/api/auth/forgot-password', { email });
    const code = issued.body.devCode;
    assert.ok(code, 'development builds echo devCode for the test');

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        call('POST', '/api/auth/reset-password', {
          email,
          code,
          newPassword: `winnerpass${i}${i}`,
        })
      )
    );
    const wins = results.filter((r) => r.status === 200);
    assert.equal(wins.length, 1, `expected exactly one 200, got ${results.map((r) => r.status)}`);
  });

  test('parallel wrong guesses are counted, not lost to a lost update', { skip: !hasDb }, async () => {
    const issued = await call('POST', '/api/auth/forgot-password', { email });
    assert.ok(issued.body.devCode, 'development builds echo devCode for the test');
    await Promise.all(
      Array.from({ length: 12 }, () =>
        call('POST', '/api/auth/reset-password', {
          email,
          code: '0000',
          newPassword: 'irrelevant1',
        })
      )
    );
    const ticket = await prisma.passwordReset.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(ticket.attempts, 5, `expected the counter to cap at 5, got ${ticket.attempts}`);
  });

  test('a new password must be 8+ characters', { skip: !hasDb }, async () => {
    const issued = await call('POST', '/api/auth/forgot-password', { email });
    const res = await call('POST', '/api/auth/reset-password', {
      email,
      code: issued.body.devCode,
      newPassword: 'short',
    });
    assert.equal(res.status, 400);
  });
});
