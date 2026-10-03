/**
 * @title Wave-2 regression tests
 * @notice Each test failed before its fix and pins the fix in place.
 * @dev Live parts skip without DATABASE_URL.
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

const validators = require('../../services/shared/validators');

describe('numeric coercion rejects blank strings', () => {
  // `Number('  ')` is 0, so a whitespace-only `price` used to become a valid
  // zero and published the listing for free.
  test('toNumber does not treat whitespace as zero', () => {
    assert.throws(() => validators.toNumber('   ', 'price'));
    assert.throws(() => validators.toNumber('\t\n', 'price'));
    assert.throws(() => validators.toNumber('', 'price'));
    assert.equal(validators.toNumber(' 42 ', 'price'), 42);
    assert.equal(validators.toNumber('3.5', 'price'), 3.5);
  });

  test('toInt does not treat whitespace as zero', () => {
    assert.throws(() => validators.toInt('   ', 'days'));
    assert.throws(() => validators.toInt(' ', 'days'));
    assert.equal(validators.toInt(' 7 ', 'days'), 7);
  });

  test('allowNull still accepts null and undefined only', () => {
    assert.equal(validators.toNumber(null, 'price', { allowNull: true }), null);
    assert.equal(validators.toNumber(undefined, 'price', { allowNull: true }), null);
  });

  test('non-numeric junk is still rejected', () => {
    assert.throws(() => validators.toNumber('abc', 'price'));
    assert.throws(() => validators.toNumber('1,5', 'price'));
    assert.throws(() => validators.toNumber(true, 'price'));
    assert.throws(() => validators.toNumber({}, 'price'));
  });
});

describe('wave-2 live regressions', () => {
  test('a product sold inside the window is counted even when listed long before', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `w2-${Date.now()}`;
    const seller = await prisma.user.create({
      data: {
        email: `${tag}@kosply.test`,
        username: tag,
        name: 'W2 Seller',
        passwordHash: 'x',
        universitas: 'U',
        programStudi: 'P',
        role: 'SELLER',
        sellerVerification: {
          create: {
            namaLengkap: 'W2 Seller',
            nim: `nim-${tag}`,
            ktmImageUrl: `https://example.test/ktm/${tag}.jpg`,
            universitas: 'U',
            programStudi: 'P',
            status: 'APPROVED',
            isActive: true,
            reviewedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    const token = require('jsonwebtoken').sign(
      { sub: seller.id, role: 'SELLER' },
      require('../../config/env').jwtSecret
    );
    const oldListing = new Date(Date.now() - 200 * 24 * 3600 * 1000);
    try {
      const created = await call(
        'POST',
        '/api/products',
        { title: 'Old listing', description: 'listed long ago', price: 100, stock: 1 },
        token
      );
      assert.equal(created.status, 201);
      const productId = created.body.item.id;

      // Backdate the listing, then record a sale today. `createdAt >= from`
      // excluded it, so a 7-day window reported nothing at all.
      await prisma.product.update({
        where: { id: productId },
        data: { createdAt: oldListing, updatedAt: oldListing },
      });
      const sold = await call('PATCH', `/api/products/${productId}/sold`, {}, token);
      assert.equal(sold.status, 200);

      const overview = await call('GET', '/api/analytics/seller?days=7', undefined, token);
      assert.equal(overview.status, 200);
      const row = overview.body.item.items.find((i) => i.productId === productId);
      assert.ok(row, 'the sale must be attributed to a product listed 200 days ago');
      assert.equal(row.sales, 1);
      // `soldAt` is the immutable fact the sale is keyed off; the 200-day-old
      // `createdAt` must still be reported honestly alongside it.
      assert.ok(row.soldAt, 'soldAt is exposed on the row');
      assert.ok(
        new Date(row.createdAt).getTime() < Date.now() - 190 * 24 * 3600 * 1000,
        'createdAt stayed backdated'
      );

      // And the per-product endpoint must agree with the overview, otherwise
      // the seller sees two different numbers for the same sale.
      const single = await call(
        'GET',
        `/api/analytics/products/${productId}?days=7`,
        undefined,
        token
      );
      assert.equal(single.status, 200);
      assert.equal(single.body.item.sales, 1, 'overview and per-product must agree');
    } finally {
      await prisma.productEvent.deleteMany({ where: { product: { sellerId: seller.id } } });
      await prisma.product.deleteMany({ where: { sellerId: seller.id } });
      // sellerVerification cascades from user, so it needs no separate delete.
      await prisma.user.deleteMany({ where: { id: seller.id } });
      await prisma.$disconnect();
    }
  });

  test('WARNING neither bans nor un-bans the reported user', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `w2r-${Date.now()}`;
    const admin = await prisma.user.create({
      data: {
        email: `${tag}a@kosply.test`, username: `${tag}a`, name: 'A',
        passwordHash: 'x', universitas: 'U', programStudi: 'P', role: 'ADMIN',
      },
      select: { id: true },
    });
    const victim = await prisma.user.create({
      data: {
        email: `${tag}b@kosply.test`, username: `${tag}b`, name: 'B',
        passwordHash: 'x', universitas: 'U', programStudi: 'P',
        isActive: false, // banned beforehand
      },
      select: { id: true },
    });
    const adminToken = require('jsonwebtoken').sign(
      { sub: admin.id, role: 'ADMIN' },
      require('../../config/env').jwtSecret
    );
    try {
      const created = await call(
        'POST',
        '/api/reports',
        {
          reportedUserId: victim.id,
          category: 'PENIPUAN',
          description: 'test report',
        },
        adminToken
      );
      assert.equal(created.status, 201);
      const review = await call(
        'POST',
        `/api/reports/${created.body.item.id}/review`,
        { action: 'WARNING' },
        adminToken
      );
      assert.equal(review.status, 200);
      // WARNING is a note. An earlier version set isActive: true here, which
      // silently lifted a previous BAN_USER and, with DB-backed auth, revived
      // the account's live sessions.
      const after = await prisma.user.findUnique({ where: { id: victim.id } });
      assert.equal(after.isActive, false, 'WARNING must not reactivate a banned user');
    } finally {
      await prisma.report.deleteMany({ where: { reporterId: admin.id } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, victim.id] } } });
      await prisma.$disconnect();
    }
  });

  test('owner can read their own SOLD listing over HTTP', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `w2p-${Date.now()}`;
    const seller = await prisma.user.create({
      data: {
        email: `${tag}@kosply.test`, username: tag, name: 'S',
        passwordHash: 'x', universitas: 'U', programStudi: 'P', role: 'SELLER',
        sellerVerification: {
          create: {
            namaLengkap: 'W2 Seller',
            nim: `nim-${tag}`,
            ktmImageUrl: `https://example.test/ktm/${tag}.jpg`,
            universitas: 'U',
            programStudi: 'P',
            status: 'APPROVED',
            isActive: true,
            reviewedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    const token = require('jsonwebtoken').sign(
      { sub: seller.id, role: 'SELLER' },
      require('../../config/env').jwtSecret
    );
    try {
      const created = await call(
        'POST',
        '/api/products',
        { title: 'To be sold', description: 'x', price: 10, stock: 1 },
        token
      );
      const productId = created.body.item.id;
      await call('PATCH', `/api/products/${productId}/sold`, {}, token);

      // The route had no optionalAuthenticate, so `req.user` was always
      // undefined and the owner/staff branch in the service was unreachable.
      const owner = await call('GET', `/api/products/${productId}`, undefined, token);
      assert.equal(owner.status, 200);
      assert.equal(owner.body.item.id, productId);

      // An anonymous caller still gets the public view rather than a 401.
      const anon = await call('GET', `/api/products/${productId}`);
      assert.ok([200, 404].includes(anon.status), `anonymous got ${anon.status}`);
    } finally {
      await prisma.productEvent.deleteMany({ where: { product: { sellerId: seller.id } } });
      await prisma.product.deleteMany({ where: { sellerId: seller.id } });
      // sellerVerification cascades from user, so it needs no separate delete.
      await prisma.user.deleteMany({ where: { id: seller.id } });
      await prisma.$disconnect();
    }
  });
});
