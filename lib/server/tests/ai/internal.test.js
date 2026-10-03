/**
 * @title Internal API tests (agent -> server)
 * @notice Boots the real Express app on an ephemeral port (no test deps).
 * @dev DB-backed cases skip without `DATABASE_URL`; the 503 degradation
 * @dev case runs everywhere, which is also what CI asserts.
 */
// `config/env` snapshots the environment at require time, so the key must be
// present *before* the app module is loaded.
const INTERNAL_KEY = 'test-internal-key';
process.env.INTERNAL_API_KEY = INTERNAL_KEY;

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

before(async () => {
  process.env.INTERNAL_API_KEY = INTERNAL_KEY;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  delete process.env.INTERNAL_API_KEY;
  await new Promise((resolve) => server.close(resolve));
});

const get = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers: { 'x-internal-key': INTERNAL_KEY, ...headers } });
  return { status: res.status, body: await res.json() };
};

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('internal without database', () => {
  test('search degrades to 503 DB_UNAVAILABLE', { skip: hasDb }, async () => {
    const { status, body } = await get('/api/internal/products/search?q=kipas');
    assert.equal(status, 503);
    assert.equal(body.code, 'DB_UNAVAILABLE');
  });
});

describe('internal with database', () => {
  test('search returns an items array', { skip: !hasDb }, async () => {
    const { status, body } = await get('/api/internal/products/search?q=kipas&limit=5');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(Array.isArray(body.items));
  });

  test('unknown product renders 404 PRODUCT_NOT_FOUND', { skip: !hasDb }, async () => {
    const { status, body } = await get('/api/internal/products/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.code, 'PRODUCT_NOT_FOUND');
  });

  test('unknown user renders 404 USER_NOT_FOUND', { skip: !hasDb }, async () => {
    const { status, body } = await get('/api/internal/users/does-not-exist');
    assert.equal(status, 404);
    assert.equal(body.code, 'USER_NOT_FOUND');
  });

  test('contact intake validates input', { skip: !hasDb }, async () => {
    const res = await post('/api/internal/contact-requests', {});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION');
  });

  test('contact intake queues with fixtures', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const uid = `test-buyer-${Date.now()}`;
    const pid = `test-product-${Date.now()}`;
    try {
      await prisma.user.create({
        data: {
          id: uid,
          email: `${uid}@kosply.test`,
          username: uid,
          name: 'Test Buyer',
          passwordHash: 'test',
          universitas: 'Univ Test',
          programStudi: 'Prodi Test',
        },
      });
      const seller = await prisma.user.findFirst({ where: { role: 'SELLER' } });
      assert.ok(seller, 'seed a seller first: npm run seed (lib/db)');
      await prisma.product.create({
        data: {
          id: pid,
          sellerId: seller.id,
          title: 'Test fixture',
          description: 'Temporary row for the contact test.',
          price: 1000,
        },
      });
      const res = await post('/api/internal/contact-requests', {
        productId: pid,
        buyerId: uid,
        message: 'halo',
      });
      assert.equal(res.status, 202);
      assert.equal(res.body.status, 'queued');
    } finally {
      await prisma.product.deleteMany({ where: { id: pid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
  });
});
