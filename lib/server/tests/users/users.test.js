/**
 * @title User profile API tests (public read + self update)
 * @notice Email/password locked here; live parts skip without DATABASE_URL.
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

describe('profile live', () => {
  test('read public, update bio/photo, locked fields rejected', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `up${Date.now()}`;
    const email = `${tag}@kosply.test`;
    try {
      const reg = await call('POST', '/api/auth/register', {
        email,
        username: tag,
        name: 'Profile Test',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
      });
      const token = reg.body.token;
      const uid = reg.body.user.id;

      const pub = await call('GET', `/api/users/${uid}`);
      assert.equal(pub.status, 200);
      assert.equal(pub.body.item.username, tag);
      assert.ok(!('email' in pub.body.item));
      assert.ok(!('passwordHash' in pub.body.item));

      const me = await call('GET', '/api/users/me', undefined, token);
      assert.equal(me.status, 200);

      const updated = await call(
        'PATCH',
        '/api/users/me',
        { bio: 'Lapak halos', photo: 'https://cdn.test/a.png', name: 'Profile Tested' },
        token
      );
      assert.equal(updated.status, 200);
      assert.equal(updated.body.item.bio, 'Lapak halos');
      assert.equal(updated.body.item.photo, 'https://cdn.test/a.png');

      const locked = await call('PATCH', '/api/users/me', { password: 'x' }, token);
      assert.equal(locked.status, 400);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
