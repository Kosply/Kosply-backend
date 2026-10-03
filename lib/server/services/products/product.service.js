/**
 * @title Product service (public catalog + seller writes)
 * @notice Reads are public; writes require an authenticated, approved seller.
 * @dev Deletes are soft (`ARCHIVED`) so chat/report history stays intact.
 * @dev `ARCHIVED` and `SOLD` are terminal: there is no un-archive and no
 * @dev un-sell, so an accidental archive forces a duplicate listing.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { isStaff } = require('../../middlewares/auth/auth');
const {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
} = require('../../../db/src/selects');
const {
  toInt,
  toNumber,
  toText,
  toUrlList,
  toQueryInt,
  INT4_MAX,
  MAX_PRICE_RP,
} = require('../shared/validators');

/** @dev Max images per listing; Postgres scalar lists are unindexable. */
const MAX_IMAGES = 8;

/**
 * @notice Assert the actor may act as a seller right now.
 * @dev `report.review` with `BAN_USER` sets `sellerVerification.isActive =
 * @dev false` and `users.role = BUYER`, but `isActive` was written and read by
 * @dev nothing: a banned seller kept creating, editing and mark-selling
 * @dev listings. Capability is therefore resolved from the verification row,
 * @dev never from the role claim alone.
 * @param {object} prisma Prisma client.
 * @param {object} actor Authenticated user `{ id, role }`.
 * @return {Promise<void>} Resolves, or throws `SELLER_NOT_APPROVED`.
 */
const assertActiveSeller = async (prisma, actor) => {
  const verification = await prisma.sellerVerification.findUnique({
    where: { userId: actor.id },
    select: { status: true, isActive: true },
  });
  if (!verification || verification.status !== 'APPROVED' || !verification.isActive) {
    throwError('SELLER_NOT_APPROVED');
  }
};

/**
 * @notice Validate product fields, throwing VALIDATION with details.
 * @dev Every field is type-checked before coercion. `Number(null)`, `Number('')`
 * @dev and `Number(true)` all yield a *valid* number, so `price: null` used to
 * @dev publish a free listing and `price: 1e21` passed `Number.isInteger` and
 * @dev then 500'd at the driver (int4 overflow).
 * @param {object} input Raw body fields.
 * @param {boolean} partial True for PATCH (all fields optional).
 * @return {object} Normalized writable fields.
 */
const validateProduct = (input = {}, partial = false) => {
  const has = (key) => input[key] !== undefined;
  const out = {};
  const problems = [];

  if (has('title')) out.title = toText(input.title, 'title', { min: 1, max: 200 });
  if (has('description')) out.description = toText(input.description, 'description', { min: 1, max: 20000 });
  if (has('price')) {
    out.price = toInt(input.price, 'price', { min: 0, max: MAX_PRICE_RP });
  }
  if (has('stock')) out.stock = toInt(input.stock, 'stock', { min: 0, max: INT4_MAX });
  if (has('latitude')) out.latitude = toNumber(input.latitude, 'latitude', { min: -90, max: 90, allowNull: true });
  if (has('longitude')) out.longitude = toNumber(input.longitude, 'longitude', { min: -180, max: 180, allowNull: true });
  if (has('locationLabel')) {
    out.locationLabel = toText(input.locationLabel, 'locationLabel', { min: 0, max: 200, allowNull: true });
  }
  if (has('category')) {
    out.category = toText(input.category, 'category', { min: 0, max: 100, allowNull: true });
  }
  if (has('imageUrls')) out.imageUrls = toUrlList(input.imageUrls, 'imageUrls', { maxItems: MAX_IMAGES });

  if (!partial) {
    if (!has('title') || !out.title) problems.push('title is required');
    if (!has('description') || !out.description) problems.push('description is required');
    if (!has('price')) problems.push('price is required');
  }
  if (problems.length) throwError('VALIDATION', { details: problems });
  return out;
};

/**
 * @notice List active products (public catalog).
 * @dev Only in-stock ACTIVE listings: a `stock: 0` row used to stay in the
 * @dev public catalog and remain openable for chat, with no sold-out signal.
 * @param {object} query Query `{ q?, limit? }`.
 * @return {Promise<Array>} Newest active products first.
 */
const list = async (query = {}) => {
  const prisma = requireDb();
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 64) : '';
  const limit = toQueryInt(query.limit, 'limit', { min: 1, max: 50, fallback: 20 });
  // Escape LIKE wildcards so `q=%` cannot degenerate into "match everything".
  const needle = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      stock: { gt: 0 },
      ...(needle && {
        OR: [
          { title: { contains: needle, mode: 'insensitive' } },
          { description: { contains: needle, mode: 'insensitive' } },
        ],
      }),
    },
    select: PUBLIC_PRODUCT_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
};

/**
 * @notice Get one product by id (public).
 * @dev Archived and sold listings are hidden from the public. `detail` had no
 * @dev status filter while `list` did, so a listing a moderator pulled with
 * @dev `DELETE_PRODUCT` stayed fully readable by direct id — including its
 * @dev description and exact pickup coordinates — and was still openable for
 * @dev chat. Staff may still read any listing.
 * @param {string} id Product id.
 * @param {object} [actor] Optional actor; staff bypass the status filter.
 * @return {Promise<object>} Product detail or throws `PRODUCT_NOT_FOUND`.
 */
const detail = async (id, actor = null) => {
  const prisma = requireDb();
  const item = await prisma.product.findUnique({
    where: { id },
    select: { ...PUBLIC_PRODUCT_DETAIL_SELECT, sellerId: true },
  });
  if (!item) throwError('PRODUCT_NOT_FOUND');
  const { sellerId, ...publicItem } = item;
  const isOwner = actor?.id === sellerId;
  if (item.status !== 'ACTIVE' && !isOwner && !isStaff(actor?.role)) {
    throwError('PRODUCT_NOT_FOUND');
  }
  return publicItem;
};

/**
 * @notice Create a product for the authenticated seller.
 * @param {object} input Raw body fields.
 * @param {object} seller Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Created product (public shape).
 */
const create = async (input, seller) => {
  const prisma = requireDb();
  if (!isStaff(seller.role)) await assertActiveSeller(prisma, seller);
  const data = validateProduct(input);
  return prisma.product.create({
    data: { ...data, sellerId: seller.id },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

/**
 * @notice Update an owned product (owner or staff only).
 * @dev Content edits are refused once the listing is no longer ACTIVE. `update`
 * @dev previously had no state gate, so a seller could rename a sold listing
 * @dev and — because the analytics `salesValue` reads the *current* price —
 * @dev retroactively rewrite the revenue the dashboard reports for a sale that
 * @dev already happened.
 * @param {string} id Product id.
 * @param {object} input Partial body fields.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Updated product or throws not-found/forbidden/validation.
 */
const update = async (id, input, actor) => {
  const prisma = requireDb();
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true, status: true },
  });
  if (!existing) throwError('PRODUCT_NOT_FOUND');
  if (existing.sellerId !== actor.id && !isStaff(actor.role)) throwError('FORBIDDEN');
  if (existing.status !== 'ACTIVE') {
    throwError('VALIDATION', {
      details: `a ${existing.status.toLowerCase()} listing can no longer be edited`,
    });
  }
  return prisma.product.update({
    where: { id },
    data: validateProduct(input, true),
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

/**
 * @notice Archive an owned product (soft delete, owner or staff only).
 * @dev Refused for a SOLD listing: `SOLD` is terminal, and archiving a sold
 * @dev product silently erased it from the seller's sales figures (the
 * @dev analytics row keys sales off `status === 'SOLD'`) with no way back.
 * @param {string} id Product id.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Archived product.
 */
const archive = async (id, actor) => {
  const prisma = requireDb();
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true, status: true },
  });
  if (!existing) throwError('PRODUCT_NOT_FOUND');
  if (existing.sellerId !== actor.id && !isStaff(actor.role)) throwError('FORBIDDEN');
  if (existing.status === 'SOLD') {
    throwError('VALIDATION', { details: 'a sold listing cannot be archived' });
  }
  return prisma.product.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

/**
 * @notice Mark an owned product as SOLD (owner or staff only).
 * @dev `SOLD` existed in the schema with no way to reach it, so a seller had
 * @dev no sales number to show at all. `soldAt` is what the analytics window
 * @dev filters on, so it must move with the status.
 * @dev Idempotent: re-marking keeps the original `soldAt` instead of resetting
 * @dev the sale to "today". The write is conditional on the current status so
 * @dev a concurrent `archive` cannot be silently undone.
 * @param {string} id Product id.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Sold product or throws not-found/forbidden/validation.
 */
const markSold = async (id, actor) => {
  const prisma = requireDb();
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true, status: true, soldAt: true },
  });
  if (!existing) throwError('PRODUCT_NOT_FOUND');
  if (existing.sellerId !== actor.id && !isStaff(actor.role)) throwError('FORBIDDEN');
  if (!isStaff(actor.role)) await assertActiveSeller(prisma, actor);
  if (existing.status === 'ARCHIVED') {
    throwError('VALIDATION', { details: 'archived products cannot be marked sold' });
  }
  // Conditional update: a losing racer (concurrent archive) sees count === 0.
  const claimed = await prisma.product.updateMany({
    where: { id, status: { in: ['ACTIVE', 'SOLD'] } },
    data: { status: 'SOLD', soldAt: existing.soldAt || new Date(), stock: 0 },
  });
  if (claimed.count === 0) throwError('VALIDATION', { details: 'listing state changed, retry' });
  return prisma.product.findUnique({
    where: { id },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

module.exports = {
  validateProduct,
  assertActiveSeller,
  list,
  detail,
  create,
  update,
  archive,
  markSold,
};
