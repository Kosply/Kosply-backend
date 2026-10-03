/**
 * @title Admin segmentation tests (super admin manages admins)
 * @notice Only SUPER_ADMIN registers/disables admins; admin password locked.
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

const person = (tag) => ({
  email: `${tag}@kosply.test`,
  username: tag,
  name: 'Seg Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

const superToken = async (tag) => {
  const prisma = require('../../../db/src/client');
  await call('POST', '/api/auth/register', person(tag));
  await prisma.user.update({ where: { email: `${tag}@kosply.test` }, data: { role: 'SUPER_ADMIN' } });
  const logged = await call('POST', '/api/auth/login', {
    email: `${tag}@kosply.test`,
    password: 'secret123',
  });
  return logged.body.token;
};

describe('segmentation live', () => {
  test('super registers admin; buyer forbidden; admin self-update; password locked', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const sup = `ss${Date.now()}`;
    const adm = `sa${Date.now()}`;
    const buy = `sb${Date.now()}`;
    try {
      const root = await superToken(sup);

      const buyerReg = await call('POST', '/api/auth/register', person(buy));
      const refused = await call(
        'POST',
        '/api/admin/users',
        { ...person(adm), password: 'adminpass1234' },
        buyerReg.body.token
      );
      assert.equal(refused.status, 403);

      const made = await call(
        'POST',
        '/api/admin/users',
        { ...person(adm), password: 'adminpass1234', photo: 'https://cdn.test/b.png' },
        root
      );
      assert.equal(made.status, 201);
      assert.equal(made.body.item.role, 'ADMIN');
      const adminId = made.body.item.id;

      const adminLogin = await call('POST', '/api/auth/login', {
        email: `${adm}@kosply.test`,
        password: 'adminpass1234',
      });
      const adminToken = adminLogin.body.token;

      const self = await call(
        'PATCH',
        '/api/admin/users/me',
        { name: 'Admin Renamed', photo: 'https://cdn.test/c.png' },
        adminToken
      );
      assert.equal(self.status, 200);
      assert.equal(self.body.item.photo, 'https://cdn.test/c.png');

      const locked = await call(
        'PATCH',
        '/api/admin/users/me',
        { password: 'newpass123' },
        adminToken
      );
      assert.equal(locked.status, 400);

      const frozen = await call(
        'PATCH',
        `/api/admin/users/${adminId}`,
        { isActive: false },
        root
      );
      assert.equal(frozen.status, 200);
      assert.equal(frozen.body.item.isActive, false);

      const denied = await call('POST', '/api/auth/login', {
        email: `${adm}@kosply.test`,
        password: 'adminpass1234',
      });
      assert.equal(denied.status, 401);
    } finally {
      await prisma.user.deleteMany({
        where: { email: { in: [`${sup}@kosply.test`, `${adm}@kosply.test`, `${buy}@kosply.test`] } },
      });
    }
  });
});
