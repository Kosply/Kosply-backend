/**
 * @title Product service (public catalog + seller writes)
 * @notice Reads are public; writes require an authenticated SELLER.
 * @dev Deletes are soft (`ARCHIVED`) so chat/report history stays intact.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
} = require('../../../db/src/selects');

/**
 * @notice Validate product fields, throwing VALIDATION with details.
 * @param {object} input Raw body fields.
 * @param {boolean} partial True for PATCH (all fields optional).
 * @return {object} Normalized writable fields.
 */
const validateProduct = (input = {}, partial = false) => {
  const pick = (key, fn) => (input[key] === undefined ? undefined : fn(input[key]));
  const title = pick('title', (v) => String(v).trim());
  const description = pick('description', (v) => String(v));
  const price = pick('price', (v) => Number(v));
  const stock = pick('stock', (v) => Number(v));
  const latitude = pick('latitude', (v) => Number(v));
  const longitude = pick('longitude', (v) => Number(v));
  const problems = [];
  if (!partial || title !== undefined) {
    if (!title) problems.push('title is required');
  }
  if (!partial || description !== undefined) {
    if (!description) problems.push('description is required');
  }
  if (price !== undefined && (!Number.isInteger(price) || price < 0)) {
    problems.push('price must be an integer >= 0');
  }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    problems.push('stock must be an integer >= 0');
  }
  if (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    problems.push('latitude must be between -90 and 90');
  }
  if (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    problems.push('longitude must be between -180 and 180');
  }
  if (!partial && price === undefined) problems.push('price is required');
  if (problems.length) throwError('VALIDATION', { details: problems });
  const out = {};
  if (title !== undefined) out.title = title;
  if (description !== undefined) out.description = description;
  if (price !== undefined) out.price = price;
  if (stock !== undefined) out.stock = stock;
  if (latitude !== undefined) out.latitude = latitude;
  if (longitude !== undefined) out.longitude = longitude;
  if (input.locationLabel !== undefined) {
    out.locationLabel = input.locationLabel === null ? null : String(input.locationLabel);
  }
  if (input.category !== undefined) {
    out.category = input.category === null ? null : String(input.category);
  }
  if (input.imageUrls !== undefined) {
    if (!Array.isArray(input.imageUrls)) throwError('VALIDATION', { details: 'imageUrls must be an array' });
    out.imageUrls = input.imageUrls.map(String);
  }
  return out;
};

/**
 * @notice List active products (public catalog).
 * @param {object} query Query `{ q?, limit? }`.
 * @return {Promise<Array>} Newest active products first.
 */
const list = async (query = {}) => {
  const prisma = requireDb();
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 50);
  return prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      ...(q && {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
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
 * @param {string} id Product id.
 * @return {Promise<object>} Product detail or throws `PRODUCT_NOT_FOUND`.
 */
const detail = async (id) => {
  const prisma = requireDb();
  const item = await prisma.product.findUnique({
    where: { id },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
  if (!item) throwError('PRODUCT_NOT_FOUND');
  return item;
};

/**
 * @notice Create a product for the authenticated seller.
 * @param {object} input Raw body fields.
 * @param {object} seller Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Created product (public shape).
 */
const create = async (input, seller) => {
  const prisma = requireDb();
  const data = validateProduct(input);
  return prisma.product.create({
    data: { ...data, sellerId: seller.id },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

/**
 * @notice Update an owned product (owner or ADMIN only).
 * @param {string} id Product id.
 * @param {object} input Partial body fields.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Updated product or throws not-found/forbidden.
 */
const update = async (id, input, actor) => {
  const prisma = requireDb();
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true },
  });
  if (!existing) throwError('PRODUCT_NOT_FOUND');
  if (existing.sellerId !== actor.id && actor.role !== 'ADMIN') throwError('FORBIDDEN');
  return prisma.product.update({
    where: { id },
    data: validateProduct(input, true),
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

/**
 * @notice Archive an owned product (soft delete, owner or ADMIN only).
 * @param {string} id Product id.
 * @param {object} actor Authenticated user (`{ id, role }`).
 * @return {Promise<object>} Archived product.
 */
const archive = async (id, actor) => {
  const prisma = requireDb();
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { sellerId: true },
  });
  if (!existing) throwError('PRODUCT_NOT_FOUND');
  if (existing.sellerId !== actor.id && actor.role !== 'ADMIN') throwError('FORBIDDEN');
  return prisma.product.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
};

module.exports = { validateProduct, list, detail, create, update, archive };
