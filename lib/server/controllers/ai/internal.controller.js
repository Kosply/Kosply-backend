/**
 * @title Internal machine API (agent -> server)
 * @notice Read-only catalog/user lookups plus contact-request intake for the AI agent.
 * @dev No auth yet (same-network trust); add an internal key before exposing
 * @dev beyond localhost. Never returns emails, hashes, or KTM data.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
  PUBLIC_USER_SELECT,
} = require('../../../db/src/selects');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const parseLimit = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

/**
 * @notice Search active products by keyword (title/description).
 * @dev Empty `q` lists recent active products. Case-insensitive.
 * @param {import('express').Request} req Query: `q?`, `limit?`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'ok', items }` with status 200.
 */
const searchProducts = async (req, res) => {
  const prisma = requireDb();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const items = await prisma.product.findMany({
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
    take: parseLimit(req.query.limit),
  });
  res.json({ status: 'ok', items });
};

/**
 * @notice Get one product with public seller info.
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'ok', item }` or throws `PRODUCT_NOT_FOUND`.
 */
const getProduct = async (req, res) => {
  const prisma = requireDb();
  const item = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });
  if (!item) throwError('PRODUCT_NOT_FOUND');
  res.json({ status: 'ok', item });
};

/**
 * @notice Get public user info (role lookup for the agent persona).
 * @dev Exposes no email, hash, or verification data.
 * @param {import('express').Request} req Params: `id`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'ok', item: { id, username, name, role, universitas } }`.
 */
const getUser = async (req, res) => {
  const prisma = requireDb();
  const item = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: PUBLIC_USER_SELECT,
  });
  if (!item) throwError('USER_NOT_FOUND');
  res.json({ status: 'ok', item });
};

/**
 * @notice Queue a buyer -> seller contact request (intake only for now).
 * @dev Validates both sides exist, then returns a queued stub. Delivery
 * @dev (chat room / notification) is TODO once the flow is decided.
 * @param {import('express').Request} req Body: `productId`, `buyerId`, `message`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'queued', contactRequest }` with status 202.
 */
const createContactRequest = async (req, res) => {
  const prisma = requireDb();
  const productId = typeof req.body?.productId === 'string' ? req.body.productId.trim() : '';
  const buyerId = typeof req.body?.buyerId === 'string' ? req.body.buyerId.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!productId || !buyerId || !message) {
    throwError('VALIDATION', { details: 'productId, buyerId, and message are required' });
  }
  if (message.length > 2000) {
    throwError('VALIDATION', { details: 'message must be at most 2000 characters' });
  }
  const [product, buyer] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: buyerId }, select: { id: true } }),
  ]);
  if (!product) throwError('PRODUCT_NOT_FOUND');
  if (!buyer) throwError('USER_NOT_FOUND');
  res.status(202).json({
    status: 'queued',
    contactRequest: { productId, buyerId, message },
    note: 'Intake only: delivery via chat/notification is TODO.',
  });
};

module.exports = { searchProducts, getProduct, getUser, createContactRequest };
