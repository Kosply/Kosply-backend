/**
 * @title Registration email-code tests
 * @notice A real inbox needs the mailed code; the suite domain does not.
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

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

describe('registration email codes', () => {
  test('suite addresses still register, and a real address needs the mailed code', { skip: !hasDb }, async () => {
    const db = require('../../../db/src/db');
    const tag = `em${Date.now()}`;
    const suite = `${tag}@kosply.test`;
    const real = `${tag}@kampus.test`;
    try {
      const bare = await call('POST', '/api/auth/register', {
        email: real,
        username: `${tag}r`,
        name: 'No Code',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
      });
      assert.equal(bare.status, 400);
      assert.equal(bare.body.code, 'EMAIL_CODE_INVALID');

      const open = await call('POST', '/api/auth/register', {
        email: suite,
        username: tag,
        name: 'Suite',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
      });
      assert.equal(open.status, 201);

      const taken = await call('POST', '/api/auth/email-code', { email: suite });
      assert.equal(taken.status, 409);
      assert.equal(taken.body.code, 'EMAIL_TAKEN');

      const fresh = `${tag}b@kosply.test`;
      const issued = await call('POST', '/api/auth/email-code', { email: fresh });
      assert.equal(issued.status, 200);
      assert.match(issued.body.devCode, /^\d{4}$/);

      const wrongCode = issued.body.devCode === '0000' ? '1111' : '0000';
      const wrong = await call('POST', '/api/auth/email-code/verify', { email: fresh, code: wrongCode });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.code, 'EMAIL_CODE_INVALID');

      const preview = await call('POST', '/api/auth/email-code/verify', {
        email: fresh,
        code: issued.body.devCode,
      });
      assert.equal(preview.status, 200);

      const created = await call('POST', '/api/auth/register', {
        email: fresh,
        username: `${tag}b`,
        name: 'Fresh',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
        code: issued.body.devCode,
      });
      assert.equal(created.status, 201);

      const spent = await call('POST', '/api/auth/email-code/verify', {
        email: fresh,
        code: issued.body.devCode,
      });
      assert.equal(spent.status, 400);
      assert.equal(spent.body.code, 'EMAIL_CODE_INVALID');
    } finally {
      await db.remove('email_verifications', { where: { email: { in: [suite, real, `${tag}b@kosply.test`] } } });
      await db.remove('users', { where: { email: { in: [suite, real, `${tag}b@kosply.test`] } } });
    }
  });
});
