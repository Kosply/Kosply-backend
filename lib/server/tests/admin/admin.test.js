/**
 * @title Admin API tests (dashboard login)
 * @notice Separate credentials from marketplace users; live parts skip without DATABASE_URL.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

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

describe('admin login live', () => {
  test('ok, wrong password, frozen admin', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const email = `adm${Date.now()}@kosply.test`;
    try {
      await prisma.admin.create({
        data: { email, name: 'Admin Test', passwordHash: await bcrypt.hash('admin123', 4) },
      });
      const ok = await call('POST', '/api/admin/login', { email, password: 'admin123' });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.token);

      const bad = await call('POST', '/api/admin/login', { email, password: 'nope' });
      assert.equal(bad.status, 401);

      await prisma.admin.update({ where: { email }, data: { isActive: false } });
      const frozen = await call('POST', '/api/admin/login', { email, password: 'admin123' });
      assert.equal(frozen.status, 401);
    } finally {
      await prisma.admin.deleteMany({ where: { email } });
    }
  });
});
