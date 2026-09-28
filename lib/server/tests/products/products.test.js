/**
 * @title Product API tests (public reads + seller writes)
 * @notice Validation units run everywhere; live flows skip without DATABASE_URL.
 * @dev Seller writes use a registered buyer promoted to SELLER, cleaned up after.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { validateProduct } = require('../../services/products/product.service');

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

describe('validateProduct (no DB)', () => {
  test('create requires title, description, price', () => {
    try {
      validateProduct({ price: -5 });
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.code, 'VALIDATION');
      assert.ok(err.details.length >= 3);
    }
  });

  test('patch accepts partial fields only', () => {
    assert.deepEqual(validateProduct({ price: 10 }, true), { price: 10 });
  });
});

describe('products live', () => {
  const tag = `p${Date.now()}`;
  const email = `${tag}@kosply.test`;
  let prisma;
  let token;
  let productId;

  test('buyer cannot create (403), seller lifecycle works', { skip: !hasDb }, async () => {
    prisma = require('../../../db/src/client');
    try {
      const created = await call('POST', '/api/auth/register', {
        email,
        username: tag,
        name: 'Seller Test',
        password: 'secret123',
        universitas: 'Univ Test',
        programStudi: 'Prodi Test',
      });
      assert.equal(created.status, 201);
      const buyerToken = created.body.token;

      const forbidden = await call(
        'POST',
        '/api/products',
        { title: 'x', description: 'y', price: 1 },
        buyerToken
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.code, 'FORBIDDEN');

      await prisma.user.update({ where: { email }, data: { role: 'SELLER' } });
      const logged = await call('POST', '/api/auth/login', { email, password: 'secret123' });
      token = logged.body.token;

      const made = await call(
        'POST',
        '/api/products',
        { title: 'Kursi test', description: 'Kokoh.', price: 50000, stock: 2 },
        token
      );
      assert.equal(made.status, 201);
      productId = made.body.item.id;

      const listed = await call('GET', '/api/products?q=kursi');
      assert.equal(listed.status, 200);
      assert.ok(listed.body.items.some((i) => i.id === productId));

      const patched = await call('PATCH', `/api/products/${productId}`, { price: 45000 }, token);
      assert.equal(patched.status, 200);
      assert.equal(patched.body.item.price, 45000);

      const archived = await call('DELETE', `/api/products/${productId}`, undefined, token);
      assert.equal(archived.status, 200);
      assert.equal(archived.body.item.status, 'ARCHIVED');

      const gone = await call('GET', '/api/products?q=kursi');
      assert.ok(!gone.body.items.some((i) => i.id === productId));
    } finally {
      if (productId) await prisma.product.deleteMany({ where: { id: productId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});
