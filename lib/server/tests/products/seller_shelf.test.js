/**
 * @title Seller shelf tests (`?sellerId=` and the card's seller identity)
 * @notice Covers what the Flutter seller profile and "Jual" tab read.
 * @dev Live only: the filter and the attached seller both need real rows.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { cleanup, createApprovedSeller, createProduct, uniqueTag } = require('../../../db/src/testkit');

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

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};

describe('seller shelf live', () => {
  test('sellerId narrows the catalog and every card names its seller', { skip: !hasDb }, async () => {
    const mine = await createApprovedSeller({ photo: 'https://cdn.test/avatar.png' });
    const other = await createApprovedSeller();
    try {
      const tag = uniqueTag('shelf');
      const ownItem = await createProduct(mine.id, {
        title: `${tag} meja`,
        description: 'Untuk pengujian.',
        price: 50_000,
        stock: 1,
      });
      await createProduct(other.id, {
        title: `${tag} kursi`,
        description: 'Untuk pengujian.',
        price: 70_000,
        stock: 1,
      });

      const shelf = await get(`/api/products?sellerId=${mine.id}&limit=50`);
      assert.equal(shelf.status, 200);
      assert.deepEqual(
        shelf.body.items.map((item) => item.id),
        [ownItem.id],
        'only the requested seller is listed'
      );
      const card = shelf.body.items[0];
      assert.equal(card.seller.id, mine.id);
      assert.equal(card.seller.photo, 'https://cdn.test/avatar.png');
      assert.equal(card.sellerId, undefined, 'the raw foreign key stays private');
      assert.equal(card.seller.email, undefined);

      const detail = await get(`/api/products/${ownItem.id}`);
      assert.equal(detail.body.item.seller.id, mine.id);

      const bad = await get('/api/products?sellerId[a]=b');
      assert.equal(bad.status, 400);
      assert.equal(bad.body.code, 'VALIDATION');
    } finally {
      await cleanup([mine.id, other.id]);
    }
  });
});
