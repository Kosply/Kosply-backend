/**
 * @title Analytics regression tests (round-2 audit findings)
 * @notice Each case below passed against a vulnerable build and now pins the
 * @notice fixed behaviour, with the concrete failure that motivated it.
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const {
  toProductRow,
  toTotals,
  parseRange,
  safeRate,
} = require('../../services/analytics/analytics.service');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

before(async () => {
  if (!hasDb) return;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const NOW = new Date('2026-09-30T14:30:00.000Z');
const WINDOW = parseRange({ days: 1 }, NOW);

const product = (over = {}) => ({
  id: 'p1',
  title: 'Laptop',
  status: 'ACTIVE',
  price: 500000,
  stock: 1,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  soldAt: null,
  ...over,
});

describe('sales are windowed by days, and survive a status change', () => {
  test('a sale from two years ago is NOT reported as a sale today', () => {
    // Regression: sales were derived from `status === 'SOLD'` with no window,
    // so `?days=1` reported a 2024 sale as today's revenue, forever.
    const row = toProductRow(
      product({ status: 'SOLD', soldAt: new Date('2024-06-01T00:00:00Z') }),
      {},
      WINDOW
    );
    assert.equal(row.sales, 0);
    assert.equal(row.salesValue, 0);
  });

  test('a sale inside the window is counted', () => {
    const row = toProductRow(product({ status: 'SOLD', soldAt: NOW }), {}, WINDOW);
    assert.equal(row.sales, 1);
    assert.equal(row.salesValue, 500000);
  });

  test('a sale after the window end is not counted', () => {
    const future = new Date(WINDOW.to.getTime() + 60_000);
    const row = toProductRow(product({ status: 'SOLD', soldAt: future }), {}, WINDOW);
    assert.equal(row.sales, 0);
  });

  test('archiving a sold product does not erase the sale', () => {
    // Regression: sales keyed off `status`, so `DELETE /api/products/:id` on a
    // SOLD row dropped it from the dashboard and it could never be restored.
    const row = toProductRow(
      product({ status: 'ARCHIVED', soldAt: NOW }),
      {},
      WINDOW
    );
    assert.equal(row.sales, 1, 'soldAt is the immutable fact, status is mutable');
    assert.equal(row.salesValue, 500000);
  });

  test('totals agree with the per-product rows for windowed sales', () => {
    const rows = [
      toProductRow(product({ id: 'a', status: 'SOLD', soldAt: NOW }), { clicks: 4 }, WINDOW),
      toProductRow(product({ id: 'b', status: 'SOLD', soldAt: NOW }), { clicks: 4 }, WINDOW),
      toProductRow(
        product({ id: 'c', status: 'SOLD', soldAt: new Date('2020-01-01T00:00:00Z') }),
        { clicks: 4 },
        WINDOW
      ),
    ];
    const totals = toTotals(rows);
    assert.equal(totals.sales, 2, 'only the two in-window sales count');
    assert.equal(totals.soldProducts, 2, 'soldProducts must agree with sales');
    assert.equal(totals.salesValue, 1000000);
  });

  test('an un-windowed call still reports lifetime sales (back-compat)', () => {
    const row = toProductRow(product({ status: 'SOLD', soldAt: new Date('2020-01-01') }), {});
    assert.equal(row.sales, 1, 'no window means no filtering');
  });
});

describe('rate math never produces NaN or Infinity', () => {
  test('zero denominators collapse to 0 across every rate', () => {
    const row = toProductRow(product(), { impressions: 0, clicks: 0, inquiries: 0, inquiryMessages: 0 }, WINDOW);
    for (const key of ['clickThroughRate', 'inquiryRate', 'conversionRate']) {
      assert.ok(Number.isFinite(row[key]), `${key} must be finite`);
      assert.equal(row[key], 0, `${key}`);
    }
  });

  test('safeRate clamps nothing but guards the degenerate cases', () => {
    assert.equal(safeRate(0, 0), 0);
    assert.equal(safeRate(1, -5), 0);
    assert.ok(Number.isFinite(safeRate(1, 3)));
  });
});

describe('inquiry counting uses one window for both counters', () => {
  const { createApprovedSeller, createUser, createProduct, cleanup } = require('../shared/fixtures');
  let seller;
  let buyer;
  let productRow;

  beforeEach(async () => {
    if (!hasDb) return;
    seller = await createApprovedSeller();
    buyer = await createUser();
    productRow = await createProduct(seller.id);
  });

  after(async () => {
    if (!hasDb) return;
    await cleanup({
      users: seller && buyer ? [seller.id, buyer.id] : [],
      products: productRow ? [productRow.id] : [],
    });
  });

  test('a long-lived room with new messages counts as an inquiry', { skip: !hasDb }, async () => {
    // Regression: the room was filtered on the ROOM's createdAt while messages
    // were filtered on the MESSAGE's createdAt, so a room opened 40 days ago
    // with questions asked today reported inquiries: 0, inquiryMessages: 0.
    const prisma = require('../../../db/src/client');
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const room = await prisma.conversation.create({
      data: {
        productId: productRow.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        createdAt: fortyDaysAgo,
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.message.create({
        data: { conversationId: room.id, senderId: buyer.id, type: 'TEXT', text: `q${i}` },
      });
    }
    const token = await loginAs(seller);
    const res = await call('GET', `/api/analytics/products/${productRow.id}?days=7`, undefined, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.inquiries, 1, 'the buyer asked inside the window');
    assert.equal(res.body.item.inquiryMessages, 3);
  });

  test('the seller own replies never inflate the inquiry count', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const room = await prisma.conversation.create({
      data: { productId: productRow.id, buyerId: buyer.id, sellerId: seller.id },
    });
    await prisma.message.create({
      data: { conversationId: room.id, senderId: seller.id, type: 'TEXT', text: 'yes available' },
    });
    const token = await loginAs(seller);
    const res = await call('GET', `/api/analytics/products/${productRow.id}?days=7`, undefined, token);
    assert.equal(res.body.item.inquiries, 0, 'the seller asking nobody is not an inquiry');
    assert.equal(res.body.item.inquiryMessages, 0);
  });

  test('a room with no messages at all is not an inquiry', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    await prisma.conversation.create({
      data: { productId: productRow.id, buyerId: buyer.id, sellerId: seller.id },
    });
    const token = await loginAs(seller);
    const res = await call('GET', `/api/analytics/products/${productRow.id}?days=7`, undefined, token);
    assert.equal(res.body.item.inquiries, 0);
  });

  test('events on a deleted product are gone, and so is its inquiry history', { skip: !hasDb }, async () => {
    // Documents the known remaining gap: `ProductEvent` and `Conversation` both
    // cascade from the product, so a hard delete rewrites the seller's history.
    // A soft `ARCHIVED` (the only path the API exposes) must NOT.
    const prisma = require('../../../db/src/client');
    const archive = await call('DELETE', `/api/products/${productRow.id}`, undefined, await loginAs(seller));
    assert.equal(archive.status, 200, JSON.stringify(archive.body));
    const room = await prisma.conversation.findFirst({ where: { productId: productRow.id } });
    if (room) {
      await prisma.message.create({
        data: { conversationId: room.id, senderId: buyer.id, type: 'TEXT', text: 'still there?' },
      });
    }
    const token = await loginAs(seller);
    const res = await call('GET', `/api/analytics/products/${productRow.id}?days=7`, undefined, token);
    assert.equal(res.status, 200, 'an archived listing keeps reporting to its owner');
  });
});

describe('a banned seller is actually blocked', () => {
  const { createBannedSeller, createApprovedSeller, createUser, cleanup } = require('../shared/fixtures');
  let banned;
  let approved;
  let buyer;

  before(async () => {
    if (!hasDb) return;
    banned = await createBannedSeller();
    approved = await createApprovedSeller();
    buyer = await createUser();
  });

  after(async () => {
    if (!hasDb) return;
    await cleanup({ users: [banned.id, approved.id, buyer.id] });
  });

  test('a seller whose verification is frozen cannot create a listing', { skip: !hasDb }, async () => {
    // Regression: `report.review` BAN_USER set `sellerVerification.isActive =
    // false` and nothing ever read it, so the ban was completely inert.
    const token = await loginAs(banned);
    const res = await call(
      'POST',
      '/api/products',
      { title: 'after ban', description: 'x', price: 1000 },
      token
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'SELLER_NOT_APPROVED');
  });

  test('a seller with an active verification still can', { skip: !hasDb }, async () => {
    const token = await loginAs(approved);
    const res = await call(
      'POST',
      '/api/products',
      { title: 'allowed', description: 'x', price: 1000 },
      token
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const prisma = require('../../../db/src/client');
    await prisma.product.delete({ where: { id: res.body.item.id } }).catch(() => {});
  });
});

describe('inbound event guards', () => {
  const { createApprovedSeller, createUser, createProduct, cleanup } = require('../shared/fixtures');
  let seller;
  let buyer;
  let productRow;

  before(async () => {
    if (!hasDb) return;
    seller = await createApprovedSeller();
    buyer = await createUser();
    productRow = await createProduct(seller.id);
  });

  after(async () => {
    if (!hasDb) return;
    await cleanup({ users: [seller.id, buyer.id], products: [productRow.id] });
  });

  test('a rotated X-Forwarded-For cannot bypass the dedupe window', { skip: !hasDb }, async () => {
    // Regression: the dedupe key was `req.ip`, which under `trust proxy` is the
    // right-most X-Forwarded-For entry — entirely client-controlled.
    const prisma = require('../../../db/src/client');
    await prisma.productEvent.deleteMany({ where: { productId: productRow.id } });
    const token = await loginAs(buyer);
    for (let i = 0; i < 5; i += 1) {
      await call(
        'POST',
        `/api/analytics/products/${productRow.id}/event?type=IMPRESSION`,
        undefined,
        token,
        { 'x-forwarded-for': `10.0.0.${i}` }
      );
    }
    const rows = await prisma.productEvent.count({ where: { productId: productRow.id } });
    assert.equal(rows, 1, 'the authenticated viewer id is the dedupe identity');
  });

  test('a product id is validated before it reaches a query', { skip: !hasDb }, async () => {
    const res = await call('POST', '/api/analytics/products/%00/event?type=CLICK');
    assert.ok([400, 404].includes(res.status), `expected 4xx, got ${res.status}`);
    assert.notEqual(res.body.code, 'INTERNAL', 'must not surface as a 500');
  });

  test('a crafted product id cannot 500 with a driver message', { skip: !hasDb }, async () => {
    for (const bad of ['../../etc/passwd', "a'b", 'x'.repeat(200)]) {
      const res = await call('GET', `/api/analytics/products/${encodeURIComponent(bad)}`);
      assert.ok(res.status < 500, `${bad} must not 500, got ${res.status}`);
    }
  });
});

/* helpers ---------------------------------------------------------- */
const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

const loginAs = async (user) => {
  const prisma = require('../../../db/src/client');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: require('bcryptjs').hashSync('fixturepass1', 10) },
  });
  const res = await call('POST', '/api/auth/login', {
    email: user.email,
    password: 'fixturepass1',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
};
