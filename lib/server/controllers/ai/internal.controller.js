/**
 * @title Internal machine API (agent -> server)
 * @notice Read-only catalog/user lookups plus contact-request intake for the AI agent.
 * @dev Every route requires the shared `INTERNAL_API_KEY` (routes/ai/internal.route.js).
 * @dev Never returns emails, hashes, or KTM data.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { toId, toText, toQueryInt, MAX_MESSAGE_LENGTH } = require('../../services/shared/validators');
const {
  PUBLIC_PRODUCT_DETAIL_COLUMNS,
  PUBLIC_PRODUCT_LIST_COLUMNS,
  PUBLIC_USER_COLUMNS,
} = require('../../../db/src/selects');
const {
  listWithSeller,
  oneWithSeller,
} = require('../../../db/src/repo/products');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const parseLimit = (raw) => {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  try {
    return toQueryInt(raw, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  } catch {
    return DEFAULT_LIMIT;
  }
};

/** @dev Escape LIKE wildcards so `q=%` cannot match the whole catalog. */
const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * @notice Search active products by keyword (title/description).
 * @dev Empty `q` lists recent active products. Case-insensitive.
 * @param {import('express').Request} req Query: `q?`, `limit?`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'ok', items }` with status 200.
 */
const searchProducts = async (req, res) => {
  const db = requireDb();
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
  const needle = escapeLike(q);
  const items = await listWithSeller({
    where: {
      status: 'ACTIVE',
      ...(needle && {
        OR: [
          { title: { contains: needle } },
          { description: { contains: needle } },
        ],
      }),
    },
    columns: PUBLIC_PRODUCT_LIST_COLUMNS,
    orderBy: { createdAt: 'desc' },
    limit: parseLimit(req.query.limit),
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
  const db = requireDb();
  // Validate before it reaches the database. The agent chooses this id (it comes
  // from a tool argument the model filled in), and an unvalidated id reached
  // MariaDB directly: a percent-encoded NUL produced a 500 with
  // `invalid byte sequence for encoding "UTF8"` instead of a 400. The
  // conversation routes below already did this.
  const id = toId(req.params.id, 'id');
  const item = await oneWithSeller({ where: { id }, columns: PUBLIC_PRODUCT_DETAIL_COLUMNS });
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
  const db = requireDb();
  const id = toId(req.params.id, 'id');
  const item = await db.selectOne('users', { where: { id }, columns: PUBLIC_USER_COLUMNS });
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
  const db = requireDb();
  // Ids arrive from a tool argument the model filled in, so they get the same
  // validation as every other id rather than a bare trim. Trimming alone let a
  // control character through to MariaDB.
  const productId = toId(req.body?.productId, 'productId');
  const buyerId = toId(req.body?.buyerId, 'buyerId');
  const message = toText(req.body?.message, 'message', { min: 1, max: 2000 });
  const [product, buyer] = await Promise.all([
    db.selectOne('products', { where: { id: productId }, columns: ['id'] }),
    db.selectOne('users', { where: { id: buyerId }, columns: ['id'] }),
  ]);
  if (!product) throwError('PRODUCT_NOT_FOUND');
  if (!buyer) throwError('USER_NOT_FOUND');
  res.status(202).json({
    status: 'queued',
    contactRequest: { productId, buyerId, message },
    note: 'Intake only: delivery via chat/notification is TODO.',
  });
};

/**
 * @notice Read COD history for the AI negotiator (machine trust).
 * @dev Requires the internal key, and additionally verifies the requested
 * @dev `userId` is a participant. Without the membership check any reachable
 * @dev caller could dump any buyer's negotiation transcript (pickup point,
 * @dev phone number, agreed price).
 * @param {import('express').Request} req Params: `id`, query: `userId`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', items }` oldest first.
 */
const getConversationMessages = async (req, res) => {
  const db = requireDb();
  const userId = toId(req.query.userId, 'userId');
  const room = await db.selectOne('conversations', {
    where: { id: toId(req.params.id, 'id'), OR: [{ buyerId: userId }, { sellerId: userId }] },
    columns: ['id'],
  });
  if (!room) throwError('CONVERSATION_NOT_FOUND');
  const items = await db.selectMany('messages', {
    where: { conversationId: room.id },
    columns: ['id', 'senderId', 'type', 'text', 'createdAt'],
    orderBy: { createdAt: 'asc' },
    limit: 100,
  });
  res.json({ status: 'ok', items });
};

/**
 * @notice Send a COD message as a user (AI negotiator with approval).
 * @dev Requires the internal key, a `senderId` that is genuinely a member of
 * @dev the room, and that the member is still active. `senderId` remains a
 * @dev body field (the agent has no end-user credential), so the membership +
 * @dev active checks are the entire trust boundary and are enforced here.
 * @param {import('express').Request} req Params `id` + body `{ senderId, message }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', item }` with status 201.
 */
const sendConversationMessage = async (req, res) => {
  const db = requireDb();
  const senderId = toId(req.body?.senderId, 'senderId');
  const message = req.body?.message && typeof req.body.message === 'object' ? req.body.message : {};
  const room = await db.selectOne('conversations', {
    where: { id: toId(req.params.id, 'id'), OR: [{ buyerId: senderId }, { sellerId: senderId }] },
    columns: ['id', 'buyerId', 'sellerId'],
  });
  if (!room) throwError('CONVERSATION_NOT_FOUND');
  const sender = await db.selectOne('users', { where: { id: senderId }, columns: ['isActive'] });
  if (!sender || !sender.isActive) throwError('ACCOUNT_DISABLED');
  const text = toText(message.text, 'message.text', { min: 1, max: MAX_MESSAGE_LENGTH });
  const item = await db.transaction(async () => {
    const created = await db.insert('messages', {
      conversationId: room.id,
      senderId,
      type: 'TEXT',
      text,
    });
    await db.update('conversations', { lastMessageAt: new Date() }, { where: { id: room.id } });
    return created;
  });
  const otherId = room.buyerId === senderId ? room.sellerId : room.buyerId;
  const { notify } = require('../../services/notifications/notification.service');
  await notify(otherId, 'chat', 'Pesan baru', text, { conversationId: room.id });
  res.status(201).json({ status: 'ok', item });
};

module.exports = {
  searchProducts,
  getProduct,
  getUser,
  createContactRequest,
  getConversationMessages,
  sendConversationMessage,
};
