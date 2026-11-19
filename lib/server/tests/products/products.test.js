/**
 * @title Product API tests (public reads + seller writes)
 * @notice Validation units run everywhere; live flows skip without DATABASE_URL.
 * @dev Seller writes use a registered buyer promoted to SELLER, cleaned up after.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { validateProduct } = require('../../services/products/product.service');
const { approveAsSeller, cleanup } = require('../../../db/src/testkit');

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

describe('categories live', () => {
  test('the list is public and hides an inactive row', { skip: !hasDb }, async () => {
    const db = require('../../../db/src/db');
    const id = `cat-uji-${Date.now()}`;
    const hidden = `Uji ${Date.now()}`;
    try {
      await db.insert('product_categories', {
        id,
        name: hidden,
        sortOrder: 99,
        isActive: false,
      });
      const res = await call('GET', '/api/categories');
      assert.equal(res.status, 200);
      const names = res.body.items.map((item) => item.name);
      for (const name of [
        'Elektronik',
        'Buku',
        'Peralatan Kos',
        'Olahraga',
        'Pakaian',
        'Furnitur',
        'Alat Tulis',
        'Kecantikan',
        'Hobi',
        'Lainnya',
      ]) {
        assert.equal(names.includes(name), true, name);
      }
      assert.equal(names.includes(hidden), false);
      assert.equal('sortOrder' in res.body.items[0], false);
      assert.equal(typeof res.body.items[0].id, 'string');
    } finally {
      await db.remove('product_categories', { where: { id } });
    }
  });
});

describe('products live', () => {
  const tag = `p${Date.now()}`;
  const email = `${tag}@kosply.test`;
  let token;
  let productId;
  let sellerId;

  test('buyer cannot create (403), seller lifecycle works', { skip: !hasDb }, async () => {
    const db = require('../../../db/src/db');
    try {
      // Register through the API first, so the real flow (and its 201) is what
      // is under test; the promotion below then targets the row it created.
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

      // The columns `approveAsSeller` copies onto the verification row. Reading
      // only the id here would leave it writing `undefined` into NOT NULL
      // columns, which the data layer correctly refuses rather than guessing.
      const seller = await db.selectOne('users', {
        where: { email },
        columns: ['id', 'name', 'universitas', 'programStudi'],
      });
      assert.ok(seller, 'registration must have written a user row');
      sellerId = seller.id;

      const forbidden = await call(
        'POST',
        '/api/products',
        { title: 'x', description: 'y', price: 1 },
        buyerToken
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.code, 'FORBIDDEN');

      // Selling needs an APPROVED verification, not just the role claim.
      await approveAsSeller(seller);
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

      const badCategory = await call(
        'POST',
        '/api/products',
        { title: 'Salah kategori', description: 'Tidak.', price: 1000, category: 'Bukan kategori' },
        token
      );
      assert.equal(badCategory.status, 400);
      assert.equal(badCategory.body.code, 'VALIDATION');
      assert.equal(badCategory.body.details, 'unknown category');

      const knownCategory = await call(
        'POST',
        '/api/products',
        { title: 'Kategori benar', description: 'Elektronik bekas.', price: 1000, category: 'elektronik' },
        token
      );
      assert.equal(knownCategory.status, 201);
      assert.equal(knownCategory.body.item.category, 'Elektronik');

      const archived = await call('DELETE', `/api/products/${productId}`, undefined, token);
      assert.equal(archived.status, 200);
      assert.equal(archived.body.item.status, 'ARCHIVED');

      const gone = await call('GET', '/api/products?q=kursi');
      assert.ok(!gone.body.items.some((i) => i.id === productId));
    } finally {
      await cleanup([sellerId]);
    }
  });
});
