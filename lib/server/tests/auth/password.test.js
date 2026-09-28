/**
 * @title Password reset API tests (4-digit email OTP)
 * @notice Unknown emails stay silent; codes are single-use.
 * @dev Live parts skip without DATABASE_URL; fixtures are cleaned up.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');

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

describe('password reset live', () => {
  test('unknown email stays silent; full OTP flow works once', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `pw${Date.now()}`;
    const email = `${tag}@kosply.test`;
    try {
      const silent = await call('POST', '/api/auth/forgot-password', { email: 'nobody@kosply.test' });
      assert.equal(silent.status, 200);
      assert.equal(silent.body.devCode, undefined);

      await call('POST', '/api/auth/register', {
        email,
        username: tag,
        name: 'Pw Test',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
      });
      const issued = await call('POST', '/api/auth/forgot-password', { email });
      assert.equal(issued.status, 200);
      assert.match(issued.body.devCode, /^\d{4}$/);

      const wrong = await call('POST', '/api/auth/reset-password', {
        email,
        code: '0000',
        newPassword: 'newsecret1',
      });
      assert.equal(wrong.status, 400);

      const done = await call('POST', '/api/auth/reset-password', {
        email,
        code: issued.body.devCode,
        newPassword: 'newsecret1',
      });
      assert.equal(done.status, 200);

      const reuse = await call('POST', '/api/auth/reset-password', {
        email,
        code: issued.body.devCode,
        newPassword: 'newsecret1',
      });
      assert.equal(reuse.status, 400);

      const login = await call('POST', '/api/auth/login', { email, password: 'newsecret1' });
      assert.equal(login.status, 200);
    } finally {
      await prisma.passwordReset.deleteMany({ where: { email } });
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
