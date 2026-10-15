/**
 * @title Tool benchmark API tests
 * @notice The auth guard runs everywhere; the aggregate shape needs DATABASE_URL.
 * @dev The live fixture creates its own users (one SUPER_ADMIN, one BUYER) and
 * @dev deletes them afterwards, so the test never depends on seeded or
 * @dev hand-made accounts existing.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../../app');
const env = require('../../config/env');

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

const get = async (path, token) => {
  const res = await fetch(`${base}${path}`, {
    headers: { ...(token && { authorization: `Bearer ${token}` }) },
  });
  return { status: res.status, body: await res.json() };
};

const sign = (payload) => jwt.sign(payload, env.jwtSecret, { expiresIn: '5m' });

describe('tool stats auth guard (no DB)', () => {
  test('anonymous callers get TOKEN_INVALID', async () => {
    const res = await get('/api/tools/stats');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_INVALID');
  });
});

describe('tool stats live', () => {
  test('admin gets the aggregate shape, buyer gets FORBIDDEN', { skip: !hasDb }, async () => {
    const db = require('../../../db/src/db');
    const tag = Date.now();
    const created = [];
    try {
      const staff = await db.insert('users', {
          email: `tools-staff-${tag}@kosply.test`,
          username: `toolsstaff${tag}`,
          name: 'Tools Staff',
          passwordHash: 'marker-not-a-credential',
          universitas: 'Univ Test',
          programStudi: 'Prodi Test',
          role: 'SUPER_ADMIN',
        });
      created.push(staff.id);

      const buyer = await db.insert('users', {
          email: `tools-buyer-${tag}@kosply.test`,
          username: `toolsbuyer${tag}`,
          name: 'Tools Buyer',
          passwordHash: 'marker-not-a-credential',
          universitas: 'Univ Test',
          programStudi: 'Prodi Test',
          role: 'BUYER',
        });
      created.push(buyer.id);

      const staffRes = await get(
        '/api/tools/stats?days=7',
        sign({ sub: staff.id, role: 'SUPER_ADMIN', kind: 'user' })
      );
      assert.equal(staffRes.status, 200);
      assert.equal(staffRes.body.status, 'ok');
      assert.equal(staffRes.body.range.days, 7);
      assert.ok(Array.isArray(staffRes.body.item.tools));
      assert.equal(typeof staffRes.body.item.total, 'number');
      assert.equal(typeof staffRes.body.item.successRate, 'number');

      /** @dev The window bound is enforced in the service, after the role check. */
      const bad = await get(
        '/api/tools/stats?days=999',
        sign({ sub: staff.id, role: 'SUPER_ADMIN', kind: 'user' })
      );
      assert.equal(bad.status, 400);
      assert.equal(bad.body.code, 'VALIDATION');

      const buyerRes = await get(
        '/api/tools/stats',
        sign({ sub: buyer.id, role: 'BUYER', kind: 'user' })
      );
      assert.equal(buyerRes.status, 403);
      assert.equal(buyerRes.body.code, 'FORBIDDEN');
    } finally {
      if (created.length > 0) {
        await db.remove('users', { where: { id: { in: created } } });
      }
    }
  });
});
