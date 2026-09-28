/**
 * @title Auth API tests (register + login)
 * @notice Validation units run everywhere; live flows skip without DATABASE_URL.
 * @dev Live fixtures use timestamped emails and are deleted afterwards.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { validateRegister } = require('../../services/auth/auth.service');

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

const post = async (path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('validateRegister (no DB)', () => {
  test('rejects bad input with details', () => {
    try {
      validateRegister({ email: 'nope' });
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.code, 'VALIDATION');
      assert.ok(err.details.length > 1);
    }
  });

  test('normalizes email and keeps the rest', () => {
    const out = validateRegister({
      email: '  A@B.co ',
      username: 'abc',
      name: 'A B',
      password: 'secret1',
      universitas: 'U',
      programStudi: 'P',
    });
    assert.equal(out.email, 'a@b.co');
  });
});

describe('auth live', () => {
  const tag = `t${Date.now()}`;
  const email = `${tag}@kosply.test`;

  test('register -> login -> wrong password', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    try {
      const created = await post('/api/auth/register', {
        email,
        username: tag,
        name: 'Test User',
        password: 'secret123',
        universitas: 'Univ Test',
        programStudi: 'Prodi Test',
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.user.role, 'BUYER');
      assert.ok(created.body.token);

      const logged = await post('/api/auth/login', { email, password: 'secret123' });
      assert.equal(logged.status, 200);
      assert.ok(logged.body.token);

      const bad = await post('/api/auth/login', { email, password: 'wrongpass' });
      assert.equal(bad.status, 401);
      assert.equal(bad.body.code, 'INVALID_CREDENTIALS');

      const dup = await post('/api/auth/register', {
        email,
        username: `${tag}x`,
        name: 'Test User',
        password: 'secret123',
        universitas: 'Univ Test',
        programStudi: 'Prodi Test',
      });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, 'EMAIL_TAKEN');
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
