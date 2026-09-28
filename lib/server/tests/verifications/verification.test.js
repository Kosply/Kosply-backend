/**
 * @title Verification API tests (submit + review)
 * @notice Validation units run everywhere; live flows skip without DATABASE_URL.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { validateApplication } = require('../../services/verifications/verification.service');

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

const applicant = (tag) => ({
  email: `${tag}@kosply.test`,
  username: tag,
  name: 'Verify Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('validateApplication (no DB)', () => {
  test('rejects empty application', () => {
    try {
      validateApplication({});
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.code, 'VALIDATION');
    }
  });
});

describe('verification live', () => {
  test('submit -> duplicate 409 -> admin approve promotes to SELLER', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `v${Date.now()}`;
    const adminTag = `va${Date.now()}`;
    const app1 = {
      namaLengkap: 'Verify Test',
      nim: `NIM${Date.now()}`,
      universitas: 'U',
      programStudi: 'P',
      ktmImageUrl: 'dev://ktm',
    };
    try {
      const reg = await call('POST', '/api/auth/register', applicant(tag));
      assert.equal(reg.status, 201);
      const token = reg.body.token;

      const sub = await call('POST', '/api/verifications', app1, token);
      assert.equal(sub.status, 201);
      assert.equal(sub.body.item.status, 'PENDING');

      const dup = await call('POST', '/api/verifications', app1, token);
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, 'VERIFICATION_EXISTS');

      const me = await call('GET', '/api/verifications/me', undefined, token);
      assert.equal(me.status, 200);
      assert.equal(me.body.item.nim, app1.nim);

      await call('POST', '/api/auth/register', applicant(adminTag));
      await prisma.user.update({ where: { email: applicant(adminTag).email }, data: { role: 'ADMIN' } });
      const adminLogin = await call('POST', '/api/auth/login', {
        email: applicant(adminTag).email,
        password: 'secret123',
      });
      assert.equal(adminLogin.status, 200);
      const adminToken = adminLogin.body.token;
      const pending = await call('GET', '/api/verifications?status=PENDING', undefined, adminToken);
      assert.equal(pending.status, 200);
      assert.ok(pending.body.items.some((i) => i.userId === reg.body.user.id));

      const reviewed = await call(
        'POST',
        `/api/verifications/${sub.body.item.id}/review`,
        { action: 'APPROVE' },
        adminToken
      );
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.item.status, 'APPROVED');

      const user = await prisma.user.findUnique({ where: { email: applicant(tag).email } });
      assert.equal(user.role, 'SELLER');
    } finally {
      await prisma.sellerVerification.deleteMany({ where: { user: { email: applicant(tag).email } } });
      await prisma.user.deleteMany({ where: { email: applicant(tag).email } });
      await prisma.user.deleteMany({ where: { email: `${adminTag}@kosply.test` } });
    }
  });

  test('reject needs a reason', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `vr${Date.now()}`;
    const adminTag = `vra${Date.now()}`;
    try {
      const reg = await call('POST', '/api/auth/register', applicant(tag));
      const token = reg.body.token;
      const sub = await call(
        'POST',
        '/api/verifications',
        { namaLengkap: 'X', nim: `R${Date.now()}`, universitas: 'U', programStudi: 'P', ktmImageUrl: 'dev://x' },
        token
      );
      await call('POST', '/api/auth/register', applicant(adminTag));
      await prisma.user.update({ where: { email: applicant(adminTag).email }, data: { role: 'ADMIN' } });
      const adminLogin = await call('POST', '/api/auth/login', {
        email: applicant(adminTag).email,
        password: 'secret123',
      });
      const adminToken = adminLogin.body.token;
      const bad = await call('POST', `/api/verifications/${sub.body.item.id}/review`, { action: 'REJECT' }, adminToken);
      assert.equal(bad.status, 400);
      const ok = await call(
        'POST',
        `/api/verifications/${sub.body.item.id}/review`,
        { action: 'REJECT', rejectionReason: 'blurry photo' },
        adminToken
      );
      assert.equal(ok.status, 200);
      assert.equal(ok.body.item.status, 'REJECTED');
    } finally {
      await prisma.sellerVerification.deleteMany({ where: { user: { email: applicant(tag).email } } });
      await prisma.user.deleteMany({ where: { email: applicant(tag).email } });
      await prisma.user.deleteMany({ where: { email: applicant(adminTag).email } });
    }
  });
});
