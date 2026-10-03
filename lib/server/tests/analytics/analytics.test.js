/**
 * @title Analytics tests (seller catalog numbers)
 * @notice Pure math always runs; live API/DB flows skip without DATABASE_URL.
 * @dev The pure block is the regression net for CTR/inquiry/conversion math,
 * @dev which is the part of this feature most likely to be silently wrong.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const {
  safeRate,
  parseRange,
  bucketise,
  toProductRow,
  toTotals,
  DEFAULT_RANGE_DAYS,
  MIN_RANGE_DAYS,
  MAX_RANGE_DAYS,
  MAX_PRODUCTS_PER_QUERY,
} = require('../../services/analytics/analytics.service');

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

/* ------------------------------------------------------------------ *
 * Pure math (no DB)
 * ------------------------------------------------------------------ */

describe('safeRate', () => {
  test('returns 0 for a 0/0 division instead of NaN', () => {
    assert.equal(safeRate(0, 0), 0);
    assert.equal(safeRate(5, 0), 0);
  });

  test('returns 0 for a negative denominator', () => {
    assert.equal(safeRate(3, -1), 0);
  });

  test('computes CTR to 4dp', () => {
    assert.equal(safeRate(1, 4), 0.25);
    assert.equal(safeRate(34, 120), 0.2833);
    assert.equal(safeRate(1, 3), 0.3333);
  });

  test('coerces non-numeric input to 0 rather than propagating NaN', () => {
    assert.equal(safeRate(undefined, undefined), 0);
    assert.equal(safeRate('x', 'y'), 0);
  });

  test('handles full coverage (100%)', () => {
    assert.equal(safeRate(7, 7), 1);
  });
});

describe('parseRange', () => {
  const now = new Date('2026-09-30T14:30:00.000Z');

  test('defaults to 30 days', () => {
    assert.equal(parseRange({}, now).days, DEFAULT_RANGE_DAYS);
    assert.equal(parseRange(undefined, now).days, DEFAULT_RANGE_DAYS);
  });

  test('days=1 means today only, starting at the UTC day boundary', () => {
    const range = parseRange({ days: 1 }, now);
    assert.equal(range.days, 1);
    // Boundaries are UTC-stable: the same query must return the same window
    // regardless of the host timezone (local midnight made this host-dependent,
    // and 15 or 16 hours wide on a DST day).
    assert.equal(range.from.toISOString(), '2026-09-30T00:00:00.000Z');
    assert.equal(range.to.toISOString(), now.toISOString());
  });

  test('days=7 starts six days back at the same boundary', () => {
    const range = parseRange({ days: 7 }, now);
    assert.equal(range.days, 7);
    assert.equal(range.from.toISOString(), '2026-09-24T00:00:00.000Z');
  });

  test('the window length is exactly days-1 days, on any calendar day', () => {
    // Includes a US DST fall-back day and a month/year boundary.
    for (const day of ['2026-11-01T12:00:00Z', '2026-03-08T12:00:00Z', '2027-01-01T00:30:00Z', '2028-03-01T23:00:00Z']) {
      for (const days of [1, 7, 30, 365]) {
        const at = new Date(day);
        const { from, to } = parseRange({ days }, at);
        assert.equal(
          Math.round((to.getTime() - from.getTime()) / 60000),
          Math.round(((days - 1) * 24 * 60 + (at.getUTCHours() * 60 + at.getUTCMinutes())) * 1),
          `days=${days} on ${day}`
        );
      }
    }
  });

  test('clamps out-of-range values instead of throwing', () => {
    assert.equal(parseRange({ days: '0' }, now).days, MIN_RANGE_DAYS);
    assert.equal(parseRange({ days: '-99' }, now).days, MIN_RANGE_DAYS);
    assert.equal(parseRange({ days: '100000' }, now).days, MAX_RANGE_DAYS);
  });

  test('rejects a malformed days value rather than silently mis-parsing it', () => {
    // `Number.parseInt` accepted '7abc', '1.9' and ['1','2'] as 7/1/1.
    for (const bad of ['7abc', '1.9', '0x10', '1e3', 'seven']) {
      assert.throws(() => parseRange({ days: bad }, now), (err) => err.code === 'VALIDATION', bad);
    }
  });

  test('a non-numeric days value is refused, not coerced', () => {
    for (const bad of [['1', '2'], { days: 7 }, 7.5, {}, true]) {
      assert.throws(
        () => parseRange({ days: bad }, now),
        (err) => err.code === 'VALIDATION',
        JSON.stringify(bad)
      );
    }
  });

  test('an absent or empty days value falls back to the default', () => {
    assert.equal(parseRange({ days: '' }, now).days, DEFAULT_RANGE_DAYS);
    assert.equal(parseRange({ days: undefined }, now).days, DEFAULT_RANGE_DAYS);
  });

  test('the window is ordered (from <= to)', () => {
    for (const days of ['1', '7', '30', '365']) {
      const { from, to } = parseRange({ days }, now);
      assert.ok(from.getTime() <= to.getTime(), `days=${days} must be ordered`);
    }
  });

  test('to is the injected clock, from never crosses into the future', () => {
    const { from, to } = parseRange({ days: 3 }, now);
    assert.equal(to.getTime(), now.getTime());
    assert.ok(from.getTime() < now.getTime());
  });
});

describe('bucketise', () => {
  test('composes a lookup key from multiple fields', () => {
    const rows = [
      { productId: 'p1', type: 'IMPRESSION', n: 10 },
      { productId: 'p1', type: 'CLICK', n: 3 },
      { productId: 'p2', type: 'IMPRESSION', n: 7 },
    ];
    const out = bucketise(rows, ['productId', 'type'], (row) => row.n);
    // Keys are JSON tuples, so no value can forge another group's key.
    assert.equal(out.get(JSON.stringify(['p1', 'IMPRESSION'])), 10);
    assert.equal(out.get(JSON.stringify(['p1', 'CLICK'])), 3);
    assert.equal(out.get(JSON.stringify(['p2', 'IMPRESSION'])), 7);
    assert.equal(out.size, 3);
  });

  test('defaults to storing the whole record', () => {
    const out = bucketise([{ a: 1, b: 2 }], ['a']);
    assert.deepEqual(out.get(JSON.stringify([1])), { a: 1, b: 2 });
  });

  test('an empty input yields an empty map', () => {
    assert.equal(bucketise([], ['a']).size, 0);
  });

  test('distinct groups cannot collide on a separator inside a value', () => {
    // The old `keys.join('|')` key merged these two groups into one entry and
    // silently discarded a count.
    const out = bucketise(
      [
        { productId: 'a|CLICK', type: 'IMPRESSION', n: 7 },
        { productId: 'a', type: 'CLICK|IMPRESSION', n: 2 },
      ],
      ['productId', 'type'],
      (row) => row.n
    );
    assert.equal(out.size, 2, 'two groups must stay two groups');
    assert.deepEqual([...out.values()].sort(), [2, 7], 'both counts must survive');
  });

  test('null and the literal string "null" do not collapse together', () => {
    const out = bucketise(
      [
        { a: null, n: 1 },
        { a: 'null', n: 2 },
      ],
      ['a'],
      (row) => row.n
    );
    assert.equal(out.size, 2);
  });
});

describe('toProductRow', () => {
  const product = {
    id: 'p1',
    title: 'Kursi折叠',
    status: 'ACTIVE',
    price: 50000,
    stock: 2,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    soldAt: null,
  };

  test('derives CTR from clicks over impressions', () => {
    const row = toProductRow(product, { impressions: 10, clicks: 4, inquiries: 0, inquiryMessages: 0 });
    assert.equal(row.clickThroughRate, 0.4);
  });

  test('a product with no traffic has zero rates, not NaN', () => {
    const row = toProductRow(product, {});
    assert.equal(row.impressions, 0);
    assert.equal(row.clicks, 0);
    assert.equal(row.clickThroughRate, 0);
    assert.equal(row.inquiryRate, 0);
    assert.equal(row.conversionRate, 0);
  });

  test('an ACTIVE product has zero sales even at a soldAt-shaped price', () => {
    const row = toProductRow(product, { impressions: 5, clicks: 1 });
    assert.equal(row.sales, 0);
    assert.equal(row.salesValue, 0);
  });

  test('a SOLD product with soldAt counts one sale worth its price', () => {
    const row = toProductRow(
      { ...product, status: 'SOLD', soldAt: new Date('2026-09-20T00:00:00.000Z') },
      { impressions: 10, clicks: 5 }
    );
    assert.equal(row.sales, 1);
    assert.equal(row.salesValue, 50000);
    assert.equal(row.conversionRate, 0.2);
  });

  test('SOLD without soldAt is not counted as a sale', () => {
    const row = toProductRow({ ...product, status: 'SOLD', soldAt: null }, {});
    assert.equal(row.sales, 0);
    assert.equal(row.salesValue, 0);
  });

  test('never echoes sellerId or other owner-only fields', () => {
    const row = toProductRow({ ...product, sellerId: 'secret-seller' }, {});
    assert.ok(!('sellerId' in row));
  });
});

describe('toTotals', () => {
  const product = {
    id: 'p1',
    title: 'Kursi',
    status: 'ACTIVE',
    price: 1000,
    stock: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    soldAt: null,
  };

  test('an empty catalog totals to zeros, not NaN', () => {
    const totals = toTotals([]);
    assert.equal(totals.products, 0);
    assert.equal(totals.impressions, 0);
    assert.equal(totals.clickThroughRate, 0);
    assert.equal(totals.conversionRate, 0);
    assert.equal(totals.salesValue, 0);
  });

  test('sums counters across products', () => {
    const rows = [
      toProductRow(product, { impressions: 10, clicks: 2, inquiries: 3, inquiryMessages: 5 }),
      toProductRow({ ...product, id: 'p2' }, { impressions: 10, clicks: 3, inquiries: 1, inquiryMessages: 2 }),
    ];    const totals = toTotals(rows);
    assert.equal(totals.products, 2);
    assert.equal(totals.impressions, 20);
    assert.equal(totals.clicks, 5);
    assert.equal(totals.inquiries, 4);
    assert.equal(totals.inquiryMessages, 7);
    assert.equal(totals.clickThroughRate, 0.25);
    assert.equal(totals.inquiryRate, 0.2);
  });

  test('counts active vs sold products separately', () => {
    const soldAt = new Date('2026-09-20T00:00:00.000Z');
    const totals = toTotals([
      toProductRow(product, {}),
      toProductRow({ ...product, id: 'p2', status: 'SOLD', soldAt, price: 2500 }, {}),
      toProductRow({ ...product, id: 'p3', status: 'ARCHIVED' }, {}),
    ]);
    assert.equal(totals.products, 3);
    assert.equal(totals.activeProducts, 1);
    assert.equal(totals.soldProducts, 1);
    assert.equal(totals.sales, 1);
    assert.equal(totals.salesValue, 2500);
  });

  test('conversion rate is sales over clicks, and is 0 with no clicks', () => {
    const soldAt = new Date('2026-09-20T00:00:00.000Z');
    const withClicks = toTotals([
      toProductRow({ ...product, status: 'SOLD', soldAt }, { impressions: 10, clicks: 4 }),
    ]);
    assert.equal(withClicks.conversionRate, 0.25);
    const noClicks = toTotals([toProductRow({ ...product, status: 'SOLD', soldAt }, {})]);
    assert.equal(noClicks.conversionRate, 0);
  });
});

/* ------------------------------------------------------------------ *
 * Live API (needs DATABASE_URL)
 * ------------------------------------------------------------------ */

describe('analytics live', () => {
  const tag = `an${Date.now()}`;
  const sellerEmail = `${tag}s@kosply.test`;
  const password = 'secret123';
  /**
   * @dev The ingest endpoint dedupes per viewer inside a window, so tests that
   * @dev need N distinct viewers register N accounts rather than weakening the
   * @dev guard. `viewers(n)` returns n buyer tokens.
   */
  const viewerEmails = Array.from({ length: 8 }, (_, i) => `${tag}v${i}@kosply.test`);
  let prisma;
  let sellerToken;
  let sellerId;
  let productId;

  const register = async (email, username) => {
    const res = await call('POST', '/api/auth/register', {
      email,
      username,
      name: 'Analytics Test',
      password,
      universitas: 'Univ Test',
      programStudi: 'Prodi Test',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };

  const login = async (email) => {
    const res = await call('POST', '/api/auth/login', { email, password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.token;
  };

  before(async () => {
    if (!hasDb) return;
    prisma = require('../../../db/src/client');
    await register(sellerEmail, `${tag}s`);
    for (const email of viewerEmails) {
      await register(email, email.split('@')[0]);
    }
    const sellerRow = await prisma.user.update({
      where: { email: sellerEmail },
      data: { role: 'SELLER' },
    });
    // An approved verification is required before a seller may list.
    await prisma.sellerVerification.create({
      data: {
        userId: sellerRow.id,
        namaLengkap: 'Analytics Seller',
        nim: `NIM-${tag}`,
        universitas: 'Univ Test',
        programStudi: 'Prodi Test',
        ktmImageUrl: 'https://cdn.test/ktm.png',
        status: 'APPROVED',
        isActive: true,
      },
    });
    sellerToken = await login(sellerEmail);
    sellerId = (await prisma.user.findUnique({ where: { email: sellerEmail } })).id;
    const made = await call(
      'POST',
      '/api/products',
      { title: `Kursi ${tag}`, description: 'Untuk test analytics.', price: 50000, stock: 3 },
      sellerToken
    );
    assert.equal(made.status, 201, JSON.stringify(made.body));
    productId = made.body.item.id;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: { in: [sellerEmail, ...viewerEmails] } } });
  });

  const emit = async (id, type, token, source) =>
    call(
      'POST',
      `/api/analytics/products/${id}/event?type=${type}${source ? `&source=${source}` : ''}`,
      undefined,
      token
    );

  test('seller overview requires a token', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'TOKEN_INVALID');
  });

  test('a bad token is rejected on the seller overview', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller', undefined, 'not-a-jwt');
    assert.equal(res.status, 401);
  });

  test('seller overview returns range, totals and one row per product', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller?days=30', undefined, sellerToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { range, totals, items } = res.body.item;
    assert.equal(range.days, 30);
    assert.equal(totals.products, items.length);
    assert.ok(items.some((i) => i.productId === productId));
    const mine = items.find((i) => i.productId === productId);
    assert.equal(mine.title, `Kursi ${tag}`);
    assert.equal(mine.price, 50000);
  });

  test('a buyer cannot see the seller catalog in the overview', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller', undefined, await login(viewerEmails[0]));
    assert.equal(res.status, 200);
    assert.ok(!res.body.item.items.some((i) => i.productId === productId));
  });

  test('impressions and clicks from distinct viewers aggregate into CTR', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const a = await login(viewerEmails[0]);
    const b = await login(viewerEmails[1]);
    const c = await login(viewerEmails[2]);
    for (const token of [a, b, c]) {
      const res = await emit(productId, 'IMPRESSION', token, 'feed');
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.recorded, 'recorded');
    }
    const click = await emit(productId, 'CLICK', a, 'feed');
    assert.equal(click.status, 201);

    const res = await call('GET', `/api/analytics/products/${productId}?days=30`, undefined, sellerToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.impressions, 3);
    assert.equal(res.body.item.clicks, 1);
    assert.equal(res.body.item.clickThroughRate, 0.3333);
  });

  test('the seller overview total matches the sum of its items', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller?days=30', undefined, sellerToken);
    const { totals, items } = res.body.item;
    const sum = (key) => items.reduce((acc, i) => acc + (i[key] || 0), 0);
    assert.equal(totals.impressions, sum('impressions'));
    assert.equal(totals.clicks, sum('clicks'));
    assert.equal(totals.inquiries, sum('inquiries'));
    assert.equal(totals.sales, sum('sales'));
    assert.equal(totals.salesValue, sum('salesValue'));
  });

  test('the dedupe window stops one viewer inflating impressions', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const token = await login(viewerEmails[3]);
    const first = await emit(productId, 'IMPRESSION', token);
    assert.equal(first.body.recorded, 'recorded');
    const second = await emit(productId, 'IMPRESSION', token);
    assert.equal(second.status, 201);
    assert.equal(second.body.recorded, 'deduped');
    const count = await prisma.productEvent.count({ where: { productId, type: 'IMPRESSION' } });
    assert.equal(count, 1);
  });

  test('an unknown event type is rejected', { skip: !hasDb }, async () => {
    const res = await emit(productId, 'PURCHASE', await login(viewerEmails[4]));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION');
  });

  test('an unknown product is a 404', { skip: !hasDb }, async () => {
    const res = await emit('nope', 'CLICK', await login(viewerEmails[4]));
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'PRODUCT_NOT_FOUND');
  });

  test('an anonymous ingest is counted with no viewer id', { skip: !hasDb }, async () => {
    // A separate product keeps the ip-based dedupe key independent of the
    // authenticated tests above (same process, same 127.0.0.1).
    const anonTarget = await prisma.product.create({
      data: { sellerId, title: `Anon ${tag}`, description: 'x', price: 3000 },
    });
    try {
      const res = await emit(anonTarget.id, 'IMPRESSION');
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const row = await prisma.productEvent.findFirst({
        where: { productId: anonTarget.id, type: 'IMPRESSION' },
      });
      assert.equal(row.viewerId, null);
      assert.equal(row.source, 'unknown', 'no source supplied falls back to unknown');
    } finally {
      await prisma.product.delete({ where: { id: anonTarget.id } });
    }
  });

  test('an unrecognised source is stored as unknown, never as free text', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const res = await emit(productId, 'CLICK', await login(viewerEmails[5]), 'evil<script>');
    assert.equal(res.status, 201);
    const row = await prisma.productEvent.findFirst({ where: { productId, type: 'CLICK' } });
    assert.equal(row.source, 'unknown');
  });

  test('the seller own traffic is not counted', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const res = await emit(productId, 'CLICK', sellerToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.recorded, 'deduped');
    const count = await prisma.productEvent.count({ where: { productId, type: 'CLICK' } });
    assert.equal(count, 0);
  });

  test('buyer chat messages become inquiries', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const buyerToken = await login(viewerEmails[6]);
    const room = await call('POST', '/api/conversations', { productId }, buyerToken);
    assert.equal(room.status, 201, JSON.stringify(room.body));
    const conversationId = room.body.item.id;

    await call('POST', `/api/conversations/${conversationId}/messages`, { text: 'Still available?' }, buyerToken);
    await call('POST', `/api/conversations/${conversationId}/messages`, { text: 'Can I COD tomorrow?' }, buyerToken);
    await call('POST', `/api/conversations/${conversationId}/messages`, { text: 'Yes, available.' }, sellerToken);

    const res = await call('GET', `/api/analytics/products/${productId}?days=30`, undefined, sellerToken);
    const item = res.body.item;
    assert.equal(item.inquiries, 1, 'one buyer room = one inquiry');
    assert.equal(item.inquiryMessages, 2, 'only buyer bubbles count, not the seller reply');
  });

  test('a second buyer asking is a second inquiry', { skip: !hasDb }, async () => {
    const other = await login(viewerEmails[7]);
    const room = await call('POST', '/api/conversations', { productId }, other);
    assert.equal(room.status, 201, JSON.stringify(room.body));
    await call('POST', `/api/conversations/${room.body.item.id}/messages`, { text: 'Sold?' }, other);
    const res = await call('GET', `/api/analytics/products/${productId}?days=30`, undefined, sellerToken);
    assert.equal(res.body.item.inquiries, 2);
    assert.equal(res.body.item.inquiryMessages, 3);
  });

  test('a non-owner cannot read per-product analytics', { skip: !hasDb }, async () => {
    const res = await call('GET', `/api/analytics/products/${productId}`, undefined, await login(viewerEmails[0]));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
  });

  test('an unknown product is a 404 on per-product analytics', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/products/nope', undefined, sellerToken);
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'PRODUCT_NOT_FOUND');
  });

  test('days is clamped instead of being trusted', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller?days=999999', undefined, sellerToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.item.range.days, MAX_RANGE_DAYS);
  });

  test('marking sold moves status, zeroes stock and stamps soldAt', { skip: !hasDb }, async () => {
    const res = await call('PATCH', `/api/products/${productId}/sold`, undefined, sellerToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.status, 'SOLD');
    const row = await prisma.product.findUnique({ where: { id: productId } });
    assert.equal(row.stock, 0);
    assert.ok(row.soldAt instanceof Date);
  });

  test('re-marking sold keeps the original soldAt (idempotent)', { skip: !hasDb }, async () => {
    const before = await prisma.product.findUnique({ where: { id: productId }, select: { soldAt: true } });
    const res = await call('PATCH', `/api/products/${productId}/sold`, undefined, sellerToken);
    assert.equal(res.status, 200);
    const after = await prisma.product.findUnique({ where: { id: productId }, select: { soldAt: true } });
    assert.equal(after.soldAt.getTime(), before.soldAt.getTime());
  });

  test('a sold product is excluded from the public catalog', { skip: !hasDb }, async () => {
    const res = await call('GET', `/api/products?q=${encodeURIComponent(`Kursi ${tag}`)}`);
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.some((i) => i.id === productId));
  });

  test('sales show up in the seller overview', { skip: !hasDb }, async () => {
    const res = await call('GET', '/api/analytics/seller?days=30', undefined, sellerToken);
    const { totals, items } = res.body.item;
    assert.equal(totals.sales, 1);
    assert.equal(totals.soldProducts, 1);
    assert.equal(totals.salesValue, 50000);
    const mine = items.find((i) => i.productId === productId);
    assert.equal(mine.sales, 1);
    assert.equal(mine.salesValue, 50000);
  });

  test('a non-owner cannot mark a product sold', { skip: !hasDb }, async () => {
    const other = await prisma.product.create({
      data: { sellerId, title: `Not yours ${tag}`, description: 'x', price: 1000 },
    });
    const res = await call('PATCH', `/api/products/${other.id}/sold`, undefined, await login(viewerEmails[0]));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    await prisma.product.delete({ where: { id: other.id } });
  });

  test('marking sold requires a token', { skip: !hasDb }, async () => {
    const res = await call('PATCH', `/api/products/${productId}/sold`);
    assert.equal(res.status, 401);
  });

  test('an archived product cannot be marked sold', { skip: !hasDb }, async () => {
    const other = await prisma.product.create({
      data: { sellerId, title: `Archived ${tag}`, description: 'x', price: 1000, status: 'ARCHIVED' },
    });
    const res = await call('PATCH', `/api/products/${other.id}/sold`, undefined, sellerToken);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION');
    await prisma.product.delete({ where: { id: other.id } });
  });

  test('events for one product do not leak into another product total', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const other = await prisma.product.create({
      data: { sellerId, title: `Other ${tag}`, description: 'x', price: 2000 },
    });
    try {
      const token = await login(viewerEmails[1]);
      await emit(other.id, 'IMPRESSION', token);
      const mine = await call('GET', `/api/analytics/products/${productId}`, undefined, sellerToken);
      const theirs = await call('GET', `/api/analytics/products/${other.id}`, undefined, sellerToken);
      assert.equal(mine.body.item.impressions, 0, 'the other product recorded nothing here');
      assert.equal(theirs.body.item.impressions, 1);
      assert.equal(theirs.body.item.title, `Other ${tag}`);
    } finally {
      await prisma.product.delete({ where: { id: other.id } });
    }
  });

  test('day windows are honoured: an old event falls outside a 1-day window', { skip: !hasDb }, async () => {
    await prisma.productEvent.deleteMany({ where: { productId } });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.productEvent.create({
      data: { productId, type: 'IMPRESSION', createdAt: old },
    });
    const wide = await call('GET', `/api/analytics/products/${productId}?days=30`, undefined, sellerToken);
    const narrow = await call('GET', `/api/analytics/products/${productId}?days=1`, undefined, sellerToken);
    assert.equal(wide.body.item.impressions, 1);
    assert.equal(narrow.body.item.impressions, 0, 'a 10-day-old event is outside days=1');
  });

  test('the query guard rail is a named constant above 0', () => {
    assert.ok(MAX_PRODUCTS_PER_QUERY > 0);
  });

  test('the fixture seller still exists before teardown', { skip: !hasDb }, async () => {
    const left = await prisma.user.count({ where: { email: sellerEmail } });
    assert.equal(left, 1);
  });
});
