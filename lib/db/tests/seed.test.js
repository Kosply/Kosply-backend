/**
 * @title Seed idempotency tests
 * @notice Running the dev seed twice must not duplicate rows (upserts).
 * @dev Skips without `DATABASE_URL`. Uses the generated client directly.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The seeder refuses to run outside an allow-listed dev database (or with
// NODE_ENV=production), so this test opts in deliberately. The production guard
// itself is still absolute.
process.env.ALLOW_PRODUCTION_SEED = '1';

const hasDb = Boolean(process.env.DATABASE_URL);
const generated = path.join(__dirname, '..', 'node_modules', '@prisma', 'client');

const SEED_EMAILS = ['buyer.dev@kosply.test', 'seller.dev@kosply.test'];
const SEED_PRODUCTS = ['dev-product-1', 'dev-product-2', 'dev-product-3'];

const counts = (prisma) => Promise.all([
  prisma.user.count({ where: { email: { in: SEED_EMAILS } } }),
  prisma.product.count({ where: { id: { in: SEED_PRODUCTS } } }),
]);

describe('dev seed', () => {
  test('twice is stable (upserts, no duplicates)', { skip: !hasDb || !fs.existsSync(generated) }, async () => {
    const seed = path.join(__dirname, '..', 'prisma', 'seed.js');
    execFileSync(process.execPath, [seed], { stdio: 'pipe' });
    const prisma = require('../src/client');
    const [usersOnce, productsOnce] = await counts(prisma);
    assert.ok(usersOnce >= 2 && productsOnce >= 3, 'seed must create dev rows');
    execFileSync(process.execPath, [seed], { stdio: 'pipe' });
    const [usersTwice, productsTwice] = await counts(prisma);
    assert.deepEqual([usersTwice, productsTwice], [usersOnce, productsOnce]);
    await prisma.$disconnect();
  });
});
