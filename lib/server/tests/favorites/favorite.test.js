/**
 * @title Favorite API tests (saved listings)
 * @notice The heart is a toggle: add and remove must both be repeatable.
 * @dev Live flows skip without DATABASE_URL.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { cleanup, createProduct, uniqueTag } = require('../../../db/src/testkit');

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

describe('favorites live', () => {
  test('add -> list -> idempotent add -> remove (idempotent)', { skip: !hasDb }, async () => {
    const tag = uniqueTag('fav');
    let userId;
    let productId;
    try {
      const registered = await call('POST', '/api/auth/register', {
        email: `${tag}@kosply.test`,
        username: tag,
        name: 'Favorite Test',
        password: 'secret123',
        universitas: 'Univ Test',
        programStudi: 'Prodi Test',
      });
      assert.equal(registered.status, 201);
      const token = registered.body.token;

      const me = await call('GET', '/api/users/me', undefined, token);
      userId = me.body.item.id;

      const product = await createProduct(userId, { title: `Simpan ${tag}` });
      productId = product.id;

      const anon = await call('GET', '/api/favorites');
      assert.equal(anon.status, 401);

      // Saving twice must keep one row and the original save position.
      const added = await call('PUT', `/api/favorites/${productId}`, undefined, token);
      assert.equal(added.status, 201);
      const addedAgain = await call('PUT', `/api/favorites/${productId}`, undefined, token);
      assert.equal(addedAgain.status, 201);

      const listed = await call('GET', '/api/favorites', undefined, token);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.items.length, 1);
      assert.equal(listed.body.items[0].id, productId);
      assert.ok(listed.body.items[0].seller, 'the saved card carries its seller');

      const missing = await call('PUT', `/api/favorites/missing-${tag}`, undefined, token);
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'PRODUCT_NOT_FOUND');

      const removed = await call('DELETE', `/api/favorites/${productId}`, undefined, token);
      assert.equal(removed.status, 200);
      assert.equal(removed.body.item.removed, true);

      // Removing again is a success with `removed: false`, not a 404.
      const removedAgain = await call('DELETE', `/api/favorites/${productId}`, undefined, token);
      assert.equal(removedAgain.status, 200);
      assert.equal(removedAgain.body.item.removed, false);

      const empty = await call('GET', '/api/favorites', undefined, token);
      assert.equal(empty.status, 200);
      assert.equal(empty.body.items.length, 0);
    } finally {
      await cleanup([userId]);
    }
  });
});
