/**
 * @title Analytics service (seller catalog numbers)
 * @notice Answers the seller dashboard: impressions, clicks, click-through
 * @notice rate, inquiries ("bertanya" = buyer chat messages), and sales.
 * @dev No revenue/profit math here on purpose — Kosply is COD/off-platform,
 * @dev so the only money figure is the seller's own gross sales value.
 * @dev Rate math lives in the pure helpers below (`safeRate`, `parseRange`,
 * @dev `bucketise`) so it is unit-testable without a database.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { isStaff } = require('../../middlewares/auth/auth');
const { SELLER_ANALYTICS_PRODUCT_SELECT } = require('../../../db/src/selects');
const { toId } = require('../shared/validators');

/** @dev Event types a client is allowed to report. */
const EVENT_TYPES = ['IMPRESSION', 'CLICK'];

/** @dev Surfaces that may produce an event, kept small so `source` stays useful. */
const SOURCES = ['feed', 'search', 'share', 'detail', 'unknown'];

/**
 * @dev Minutes east of UTC that defines "today" for analytics. 0 = UTC.
 * @dev WIB is +420. Configurable so the numbers do not shift with the host
 * @dev timezone; never derived from the server's local clock.
 */
const BUSINESS_UTC_OFFSET_MINUTES = Number.parseInt(process.env.ANALYTICS_UTC_OFFSET_MINUTES ?? '0', 10) || 0;

/** @dev Default window when the caller passes no `days`. */
const DEFAULT_RANGE_DAYS = 30;
const MIN_RANGE_DAYS = 1;
const MAX_RANGE_DAYS = 365;

/** @dev Guard rail: a seller with more products than this gets a validation error. */
const MAX_PRODUCTS_PER_QUERY = 500;

/** @dev Cap on conversations pulled when counting inquiries. */
const MAX_CONVERSATIONS = 2000;

/**
 * @notice Divide without producing NaN/Infinity (0/0 must be 0, not NaN).
 * @param {number} numerator Part of the whole.
 * @param {number} denominator Total.
 * @return {number} Ratio rounded to 4dp, or 0 when the denominator is 0.
 */
/** @dev Composite lookup key for a (product, type) pair, matching `bucketise`. */
const eventKey = (productId, type) => JSON.stringify([productId, type]);

const safeRate = (numerator, denominator) => {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
};

/**
 * @notice Turn a `days` query value into a concrete window.
 * @dev The window is inclusive of today and starts at 00:00.000 local time
 * @dev `days - 1` days back, so `days=1` means "today only".
 * @param {object} [query] Query object, reads `days`.
 * @param {Date} [now] Injectable clock, so tests do not depend on wall time.
 * @return {{days: number, from: Date, to: Date}} Clamped, ordered window.
 */
const parseRange = (query = {}, now = new Date()) => {
  const raw = query?.days;
  let days = DEFAULT_RANGE_DAYS;
  if (raw !== undefined && raw !== null && raw !== '') {
    // Accept a plain integer or a string of digits only. `Number.parseInt`
    // accepted '7abc', '1.9' and '0x10' as 7/1/1, and an array as its first
    // element, so `?days=1&days=2` silently became 1. Out-of-range is clamped.
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
        throwError('VALIDATION', { details: 'days must be an integer' });
      }
    } else if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) {
      throwError('VALIDATION', { details: 'days must be an integer' });
    }
    days = Math.min(Math.max(Number(raw), MIN_RANGE_DAYS), MAX_RANGE_DAYS);
  }
  // Day boundaries are computed in a fixed offset from UTC, not in the
  // server's local time. Local midnight made the same query return a different
  // window depending on the host timezone, and on a DST transition day
  // `days=1` was 15 or 16 hours wide. The window is now identical everywhere.
  const offsetMinutes = BUSINESS_UTC_OFFSET_MINUTES;
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const fromShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - (days - 1)
  );
  return {
    days,
    from: new Date(fromShifted - offsetMinutes * 60_000),
    to: new Date(now.getTime()),
  };
};

/**
 * @notice Group a flat list of records into a lookup keyed by field values.
 * @dev Replaces a `groupBy` per bucket so the number of round-trips stays
 * @dev constant regardless of how many products the seller owns.
 * @param {Array<object>} rows Records to index.
 * @param {string[]} keys Fields to compose the lookup key from.
 * @param {Function} [valueOf] Maps a record to the value stored at the key.
 * @return {Map<string, object>} Key -> record, or key -> valueOf(record).
 */
const bucketise = (rows, keys, valueOf = (row) => row) => {
  const out = new Map();
  for (const row of rows) {
    // JSON encoding of the raw key tuple. The old `keys.map(String).join('|')`
    // collapsed `('a|CLICK','IMPRESSION')` and `('a','CLICK|IMPRESSION')` into a
    // single entry and silently discarded a count; it also made `null` and the
    // string "null" indistinguishable. JSON escapes both problems away.
    out.set(JSON.stringify(keys.map((key) => row[key])), valueOf(row));
  }
  return out;
};

/**
 * @notice Assemble the per-product analytics row returned to the seller.
 * @dev Pure so the response shape is pinned by unit tests, not just by a DB read.
 * @param {object} product Seller's product row.
 * @param {{impressions: number, clicks: number, inquiries: number, inquiryMessages: number}} counts Raw counters.
 * @return {object} Row with derived rates.
 */
const toProductRow = (product, counts, window = {}) => {
  const impressions = counts.impressions || 0;
  const clicks = counts.clicks || 0;
  const inquiries = counts.inquiries || 0;
  const inquiryMessages = counts.inquiryMessages || 0;
  const from = window.from || new Date(0);
  const to = window.to || new Date(8640000000000000);
  const soldInWindow = Boolean(
    product.soldAt && product.soldAt.getTime() >= from.getTime() && product.soldAt.getTime() <= to.getTime()
  );
  return {
    productId: product.id,
    title: product.title,
    status: product.status,
    price: product.price,
    stock: product.stock,
    createdAt: product.createdAt,
    soldAt: product.soldAt,
    impressions,
    clicks,
    clickThroughRate: safeRate(clicks, impressions),
    inquiries,
    inquiryMessages,
    inquiryRate: safeRate(inquiries, impressions),
    // Sales are counted from `soldAt` inside the requested window, NOT from
    // the mutable `status`. Two bugs: (a) nothing windowed them, so a sale from
    // two years ago was reported as "sales today"; (b) keying off `status` let
    // `archive` erase a completed sale from the dashboard, and `PATCH price`
    // retroactively rewrite its value. `soldAt` is the immutable fact.
    sales: soldInWindow ? 1 : 0,
    salesValue: soldInWindow ? product.price : 0,
    conversionRate: safeRate(soldInWindow ? 1 : 0, clicks),
  };
};

/**
 * @notice Sum per-product rows into the seller overview totals.
 * @param {object[]} rows Output of `toProductRow`.
 * @return {object} Totals plus the rates derived from the sums.
 */
const toTotals = (rows) => {
  const sum = (key) => rows.reduce((acc, row) => acc + (row[key] || 0), 0);
  const impressions = sum('impressions');
  const clicks = sum('clicks');
  const inquiries = sum('inquiries');
  const inquiryMessages = sum('inquiryMessages');
  const sales = sum('sales');
  return {
    products: rows.length,
    activeProducts: rows.filter((row) => row.status === 'ACTIVE').length,
    soldProducts: rows.filter((row) => row.sales > 0).length,
    impressions,
    clicks,
    clickThroughRate: safeRate(clicks, impressions),
    inquiries,
    inquiryMessages,
    inquiryRate: safeRate(inquiries, impressions),
    inquiryMessageRate: safeRate(inquiryMessages, impressions),
    sales,
    salesValue: sum('salesValue'),
    conversionRate: safeRate(sales, clicks),
  };
};

/**
 * @notice Load one seller's products, enforcing the query guard rail.
 * @param {object} prisma Prisma client.
 * @param {string} sellerId Owner of the catalog.
 * @return {Promise<object[]>} The seller's products.
 */
const loadSellerProducts = async (prisma, sellerId, from) => {
  // Window-scoped and deterministic. This used to load the seller's ENTIRE
  // catalog regardless of `days` and then refuse above the cap, so a seller
  // with 501 products could never load analytics again and the error told them
  // to "narrow the range" — which changed nothing.
  // Scope by *activity*, not creation: filtering on `createdAt >= from` hid the
  // sale of a listing uploaded 200 days ago and sold today, so the overview
  // disagreed with the per-product endpoint and the whole catalogue vanished
  // for short windows. A product is in scope if it was created, sold, or had
  // traffic in the window.
  const products = await prisma.product.findMany({
    where: {
      sellerId,
      OR: [
        { createdAt: { gte: from } },
        { soldAt: { gte: from } },
        { events: { some: { createdAt: { gte: from } } } },
      ],
    },
    select: SELLER_ANALYTICS_PRODUCT_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_PRODUCTS_PER_QUERY + 1,
  });
  if (products.length > MAX_PRODUCTS_PER_QUERY) {
    throwError('VALIDATION', {
      details: `too many products active in this window (>${MAX_PRODUCTS_PER_QUERY}); request a shorter range`,
    });
  }
  return products;
};

/**
 * @notice Count impressions and clicks per product inside the window.
 * @param {object} prisma Prisma client.
 * @param {string[]} productIds Seller's product ids.
 * @param {Date} from Window start.
 * @param {Date} to Window end.
 * @return {Promise<Map<string, {impressions: number, clicks: number}>>} Keyed `productId|TYPE`.
 */
const countEvents = async (prisma, productIds, from, to) => {
  if (!productIds.length) return new Map();
  const grouped = await prisma.productEvent.groupBy({
    by: ['productId', 'type'],
    where: { productId: { in: productIds }, createdAt: { gte: from, lte: to } },
    _count: { _all: true },
  });
  return bucketise(grouped, ['productId', 'type'], (row) => row._count._all);
};

/**
 * @notice Count buyer inquiries per product ("bertanya ke message").
 * @dev `inquiries` = distinct chat rooms opened on the product (one per buyer,
 * @dev enforced by `@@unique([productId, buyerId])`).
 * @dev `inquiryMessages` = buyer-authored bubbles only, so a chatty seller
 * @dev cannot inflate their own number.
 * @param {object} prisma Prisma client.
 * @param {object[]} products Seller's products.
 * @param {string} sellerId Owner (excluded so self-chat is not counted).
 * @param {Date} from Window start.
 * @return {Promise<Map<string, {inquiries: number, inquiryMessages: number}>>} Keyed by productId.
 */
const countInquiries = async (prisma, products, sellerId, from, to) => {
  const out = new Map();
  for (const product of products) out.set(product.id, { inquiries: 0, inquiryMessages: 0 });
  if (!products.length) return out;
  const productIds = products.map((p) => p.id);

  // One grouped query over messages in the window, keyed by room *and* sender,
  // so the buyer's bubbles can be told apart from the seller's replies without
  // an N+1 per conversation. Bounded by recent traffic, not by total rooms.
  const byRoom = await prisma.message.groupBy({
    by: ['conversationId', 'senderId'],
    where: {
      conversation: { productId: { in: productIds } },
      createdAt: { gte: from, lte: to },
    },
    _count: { _all: true },
  });
  if (!byRoom.length) return out;

  const activeRoomIds = [...new Set(byRoom.map((row) => row.conversationId))];
  const conversations = await prisma.conversation.findMany({
    where: { id: { in: activeRoomIds } },
    select: { id: true, productId: true, buyerId: true },
  });
  const room = new Map(conversations.map((row) => [row.id, row]));

  for (const row of byRoom) {
    const convo = room.get(row.conversationId);
    if (!convo) continue;
    const bucket = out.get(convo.productId);
    if (!bucket) continue;
    // Only the buyer counts: a seller reply (or a staff note added to the room)
    // must never inflate the seller's own "bertanya" number.
    if (row.senderId === convo.buyerId) {
      bucket.inquiryMessages += row._count._all;
      bucket.inquiries += 1;
    }
  }
  return out;
};

/**
 * @notice Seller-wide analytics across every product in the window.
 * @param {object} actor Authenticated seller (`{ id, role }`).
 * @param {object} [query] Query `{ days? }`.
 * @return {Promise<object>} `{ range, totals, items }`.
 */
const sellerOverview = async (actor, query = {}) => {
  const prisma = requireDb();
  const { days, from, to } = parseRange(query);
  const products = await loadSellerProducts(prisma, actor.id, from);
  const events = await countEvents(
    prisma,
    products.map((p) => p.id),
    from,
    to
  );
  const inquiries = await countInquiries(prisma, products, actor.id, from, to);
  const items = products.map((product) => {
    const inquiry = inquiries.get(product.id) || { inquiries: 0, inquiryMessages: 0 };
    return toProductRow(
      product,
      {
        impressions: events.get(eventKey(product.id, 'IMPRESSION')) || 0,
        clicks: events.get(eventKey(product.id, 'CLICK')) || 0,
        inquiries: inquiry.inquiries,
        inquiryMessages: inquiry.inquiryMessages,
      },
      { from, to }
    );
  });
  return {
    range: { days, from: from.toISOString(), to: to.toISOString() },
    totals: toTotals(items),
    items,
  };
};

/**
 * @notice Analytics for a single product. Owner or ADMIN only.
 * @dev Re-reads ownership server-side; never trusts a sellerId from the caller.
 * @param {string} productId Product id.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @param {object} [query] Query `{ days? }`.
 * @return {Promise<object>} `{ range, item }` or throws not-found/forbidden.
 */
const productStats = async (rawProductId, actor, query = {}) => {
  const prisma = requireDb();
  const productId = toId(rawProductId, 'productId');
  const { days, from, to } = parseRange(query);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { ...SELLER_ANALYTICS_PRODUCT_SELECT, sellerId: true },
  });
  if (!product) throwError('PRODUCT_NOT_FOUND');
  if (product.sellerId !== actor.id && !isStaff(actor.role)) throwError('FORBIDDEN');

  const events = await countEvents(prisma, [product.id], from, to);
  const inquiries = await countInquiries(prisma, [product], product.sellerId, from, to);
  const inquiry = inquiries.get(product.id) || { inquiries: 0, inquiryMessages: 0 };
  return {
    range: { days, from: from.toISOString(), to: to.toISOString() },
    item: toProductRow(
      product,
      {
        impressions: events.get(eventKey(product.id, 'IMPRESSION')) || 0,
        clicks: events.get(eventKey(product.id, 'CLICK')) || 0,
        inquiries: inquiry.inquiries,
        inquiryMessages: inquiry.inquiryMessages,
      },
      { from, to }
    ),
  };
};

/* ------------------------------------------------------------------ *
 * Event ingest
 * ------------------------------------------------------------------ */

/**
 * @notice In-process de-duplication window for recorded events.
 * @dev Without a rate limiter (see audit: no `express-rate-limit` anywhere)
 * @dev an anonymous caller could inflate a seller's numbers in a loop.
 * @dev POC-grade only: in-memory, per-process, lost on restart. A real
 * @dev deployment needs a shared limiter (Redis) or a DB-side unique key.
 */
const DEDUP_WINDOW_MS = { IMPRESSION: 30 * 60 * 1000, CLICK: 10 * 60 * 1000 };
const MAX_DEDUP_ENTRIES = 20000;
const seen = new Map();

/**
 * @notice Stable, non-spoofable-ish identifier for an anonymous viewer.
 * @dev `req.ip` was used directly, and with `trust proxy` enabled it is the
 * @dev right-most `X-Forwarded-For` entry — which any client chooses, so
 * @dev rotating the header produced unlimited recorded impressions and
 * @dev defeated the window entirely. Hashing the socket address keeps the key
 * @dev stable without putting a raw address in memory.
 * @param {object} context `{ ip }`.
 * @return {string} Short hash, or `anon` when nothing is known.
 */
const hashViewer = (context) => {
  const seed = String(context?.ip || '').split(',').pop().trim();
  if (!seed) return 'anon';
  return crypto.createHash('sha256').update(seed).digest('base64url').slice(0, 16);
};

/**
 * @notice Decide whether an event is far enough from the last one to count.
 * @param {string} key Dedupe key.
 * @param {number} windowMs Window length for the type.
 * @return {boolean} True when the event should be recorded.
 * @dev Evicts the oldest entry when the map grows past the cap, so a long
 * @dev lived process cannot leak memory through this map.
 */
const shouldRecord = (key, windowMs) => {
  const now = Date.now();
  const previous = seen.get(key);
  if (previous && now - previous < windowMs) {
    // Re-insert so `Map` iteration order is least-recently-used first. Without
    // this, `Map.set` on an existing key kept its original position, so a hot
    // key stayed at the front and was the *first* thing evicted at the cap —
    // which re-opened the window it was supposed to hold.
    seen.delete(key);
    seen.set(key, now);
    return false;
  }
  // Evict only when actually about to insert, and only the coldest entry.
  if (seen.size >= MAX_DEDUP_ENTRIES) {
    seen.delete(seen.keys().next().value);
  }
  seen.set(key, now);
  return true;
};

/**
 * @notice Record one impression/click event for a product.
 * @dev Public endpoint by design (the feed/detail surfaces are anonymous), so:
 * @dev - the product must exist and be ACTIVE,
 * @dev - the seller's own traffic is dropped,
 * @dev - the type/source come from a fixed allowlist, never a free string,
 * @dev - a per-viewer dedupe window caps trivial inflation.
 * @param {string} productId Product id.
 * @param {string} type `IMPRESSION` | `CLICK`.
 * @param {object} [context] `{ viewerId?, source?, ip? }`.
 * @return {Promise<object>} `{ status: 'recorded' | 'deduped' }`.
 */
const recordEvent = async (rawProductId, type, context = {}) => {
  const prisma = requireDb();
  // Validate the id before it reaches Prisma: a NUL byte in the path produced
  // `invalid byte sequence for encoding "UTF8": 0x00` from Postgres and a 500.
  const productId = toId(rawProductId, 'productId');
  const eventType = String(type || '').trim().toUpperCase();
  if (!EVENT_TYPES.includes(eventType)) throwError('VALIDATION', { details: 'unknown event type' });
  const source = SOURCES.includes(context.source) ? context.source : 'unknown';
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sellerId: true, status: true },
  });
  if (!product || product.status !== 'ACTIVE') throwError('PRODUCT_NOT_FOUND');
  if (context.viewerId && context.viewerId === product.sellerId) {
    return { status: 'deduped', reason: 'own_traffic' };
  }
  const key = `${eventType}:${product.id}:${context.viewerId || hashViewer(context)}`;
  if (!shouldRecord(key, DEDUP_WINDOW_MS[eventType])) {
    return { status: 'deduped', reason: 'window' };
  }
  await prisma.productEvent.create({
    data: { productId: product.id, type: eventType, viewerId: context.viewerId || null, source },
    select: { id: true },
  });
  return { status: 'recorded' };
};

module.exports = {
  EVENT_TYPES,
  SOURCES,
  DEFAULT_RANGE_DAYS,
  MIN_RANGE_DAYS,
  MAX_RANGE_DAYS,
  MAX_PRODUCTS_PER_QUERY,
  safeRate,
  parseRange,
  bucketise,
  toProductRow,
  toTotals,
  sellerOverview,
  productStats,
  recordEvent,
};
