/**
 * @title Seed idempotency tests
 * @notice Running the dev seed twice must not duplicate rows (upserts).
 * @dev Skips without `DATABASE_URL`. Talks to the database through the same
 * @dev data layer the application uses, so this also proves the seed writes
 * @dev rows the application can read back.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The seeder refuses to run outside an allow-listed dev database (or with
// NODE_ENV=production), so this test opts in deliberately. The production guard
// itself is still absolute.
process.env.ALLOW_PRODUCTION_SEED = '1';

const hasDb = Boolean(process.env.DATABASE_URL);

const SEED_EMAILS = ['buyer.dev@kosply.test', 'seller.dev@kosply.test'];
const SEED_PRODUCTS = ['dev-product-1', 'dev-product-2', 'dev-product-3'];

const counts = (db) => Promise.all([
  db.count('users', { where: { email: { in: SEED_EMAILS } } }),
  db.count('products', { where: { id: { in: SEED_PRODUCTS } } }),
]);

describe('dev seed', () => {
  test('twice is stable (upserts, no duplicates)', { skip: !hasDb }, async () => {
    const seed = path.join(__dirname, '..', 'schema', 'seed.js');
    const db = require('../src/db');

    execFileSync(process.execPath, [seed], { stdio: 'pipe' });
    const [usersOnce, productsOnce] = await counts(db);
    assert.ok(usersOnce >= 2, 'seed must create the dev users');
    assert.ok(productsOnce >= 3, 'seed must create the dev products');

    execFileSync(process.execPath, [seed], { stdio: 'pipe' });
    const [usersTwice, productsTwice] = await counts(db);
    assert.deepEqual([usersTwice, productsTwice], [usersOnce, productsOnce]);

    // And the rows read back with the types the API promises, not as whatever
    // the driver happened to return.
    const seller = await db.selectOne('users', { where: { email: 'seller.dev@kosply.test' } });
    assert.equal(seller.isActive, true);
    assert.ok(seller.createdAt instanceof Date);

    const product = await db.selectOne('products', { where: { id: 'dev-product-1' } });
    assert.deepEqual(product.imageUrls, [], 'the JSON default must read back as an array');
    assert.equal(typeof product.price, 'number');

    await db.close();
  });
});