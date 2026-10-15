/**
 * @title Report API tests (file + review + enforcement)
 * @notice Live parts skip without DATABASE_URL; fixtures are cleaned up.
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
  name: 'Report Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('reports live', () => {
  test('needs a target; BAN_USER freezes the seller', { skip: !hasDb }, async () => {
    const db = require('../../../db/src/db');
    const tag = `r${Date.now()}`;
    const badTag = `rb${Date.now()}`;
    const adminTag = `ra${Date.now()}`;
    let reportId;
    try {
      const reg = await call('POST', '/api/auth/register', person(tag));
      const token = reg.body.token;
      const { password: _badPw, ...badFields } = person(badTag);
      const bad = await db.insert('users', { ...badFields, passwordHash: 'x', role: 'SELLER' });
      await db.insert('seller_verifications', {
          userId: bad.id, namaLengkap: 'Bad', nim: `N${Date.now()}`, universitas: 'U',
          programStudi: 'P', ktmImageUrl: 'https://cdn.kosply.test/ktm-x.png', status: 'APPROVED', action: 'APPROVE',
        });

      const noTarget = await call('POST', '/api/reports', { description: 'x' }, token);
      assert.equal(noTarget.status, 400);

      const filed = await call(
        'POST',
        '/api/reports',
        { reportedUserId: bad.id, category: 'PENIPUAN', description: 'nipuuu' },
        token
      );
      assert.equal(filed.status, 201);
      assert.match(filed.body.item.reportNo, /^RPT-/);
      reportId = filed.body.item.id;

      await call('POST', '/api/auth/register', person(adminTag));
      await db.update('users', { role: 'ADMIN' }, { where: { email: `${adminTag}@kosply.test` } });
      const adminLogin = await call('POST', '/api/auth/login', {
        email: `${adminTag}@kosply.test`,
        password: 'secret123',
      });
      const adminToken = adminLogin.body.token;
      const listed = await call('GET', '/api/reports?status=PENDING', undefined, adminToken);
      assert.ok(listed.body.items.some((r) => r.id === reportId));

      const reviewed = await call(
        'POST',
        `/api/reports/${reportId}/review`,
        { action: 'BAN_USER', actionNote: 'terbukti' },
        adminToken
      );
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.item.status, 'RESOLVED');
      const frozen = await db.selectOne('seller_verifications', { where: { userId: bad.id } });
      assert.equal(frozen.isActive, false);
    } finally {
      if (reportId) await db.remove('reports', { where: { id: reportId } });
      await db.remove('seller_verifications', { where: { user: { email: `${badTag}@kosply.test` } } });
      await db.remove('users', { where: { email: { in: [`${tag}@kosply.test`, `${badTag}@kosply.test`, `${adminTag}@kosply.test`] } } });
    }
  });
});
