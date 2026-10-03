/**
 * @title COD chat service (rooms + messages)
 * @notice Buyer <-> seller rooms, one per buyer per product; history marks
 * @dev the other side's messages read on fetch (standard chat behavior).
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { isStaff } = require('../../middlewares/auth/auth');
const {
  toId,
  toText,
  toNumber,
  assertSafeUrl,
  toQueryInt,
  MAX_MESSAGE_LENGTH,
} = require('../shared/validators');

/**
 * @dev `SYSTEM` is reserved for server-authored rows. It used to be in the
 * @dev client-allowed set, so a buyer could post "Seller telah menerima
 * @dev pembayaran" into the transcript that support and analytics read.
 */
const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'LOCATION'];

/** @dev Bounds so one request cannot hydrate an unbounded thread. */
const MAX_HISTORY_MESSAGES = 200;
const MAX_PAGE_MESSAGES = 50;
const MAX_INBOX_ROOMS = 100;

/** @dev Long-poll budget. */
const MAX_WAIT_SECONDS = 50;
const DEFAULT_WAIT_SECONDS = 20;
const POLL_INTERVAL_MS = 500;

/**
 * @notice Per-process cap on concurrent long-polls.
 * @dev Each wait holds a socket for up to 50s and polls the DB twice a second.
 * @dev With nothing bounding it, 300 concurrent waits from one token produced
 * @dev ~1,300 queries/second. In-process only: a shared limiter (Redis) is the
 * @dev production answer, but this stops the single-worker amplification.
 */
const MAX_CONCURRENT_WAITS = 20;
let activeWaits = 0;

/**
 * @notice Open (or reuse) a room, optionally with a first message.
 * @dev Seller is derived from the product when `productId` is given, so
 * @dev buyers cannot spoof who they talk to. Null productId = general chat.
 * @dev The message is validated *before* the room is created and both writes
 * @dev share a transaction. Previously the room was created first, so any
 * @dev invalid message left an empty orphan room and a 400 — 50 bad requests
 * @dev produced 50 unreachable rooms.
 * @param {object} input Body `{ productId?, message? }`.
 * @param {object} actor Authenticated user `{ id }` (the buyer side).
 * @return {Promise<object>} Room with messages.
 */
const open = async (input = {}, actor) => {
  const prisma = requireDb();
  const productId = input.productId ? toId(input.productId, 'productId') : null;
  // Validate up front so a bad message never creates a room.
  const firstMessage = input.message ? validateMessage(input.message) : null;

  let sellerId = null;
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { sellerId: true, status: true },
    });
    if (!product) throwError('PRODUCT_NOT_FOUND');
    // An archived or sold listing must not stay negotiable: a listing pulled
    // for fraud used to keep accepting rooms and accruing seller "demand".
    if (product.status !== 'ACTIVE') throwError('PRODUCT_NOT_FOUND');
    sellerId = product.sellerId;
  } else {
    sellerId = toId(input.sellerId, 'sellerId');
    // The counterparty must be a real, active seller — the id used to be
    // accepted for any user, including a plain BUYER or a frozen account.
    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true, role: true, isActive: true, sellerVerification: { select: { status: true, isActive: true } } },
    });
    if (!seller || !seller.isActive) throwError('USER_NOT_FOUND');
    const isSeller = isStaff(seller.role) || (seller.sellerVerification?.status === 'APPROVED' && seller.sellerVerification?.isActive);
    if (!isSeller) throwError('SELLER_NOT_APPROVED');
  }
  if (sellerId === actor.id) throwError('VALIDATION', { details: 'cannot chat with yourself' });

  return prisma.$transaction(async (tx) => {
    let room = productId
      ? await tx.conversation.findUnique({
          where: { productId_buyerId: { productId, buyerId: actor.id } },
          select: { id: true },
        })
      : null;
    if (!room) {
      // `upsert` removes the findUnique->create race: two tabs (or two PM2
      // workers) opening the same room used to collide on the unique index and
      // surface a 500.
      room = productId
        ? await tx.conversation.upsert({
            where: { productId_buyerId: { productId, buyerId: actor.id } },
            update: {},
            create: { productId, buyerId: actor.id, sellerId },
            select: { id: true },
          })
        : await tx.conversation.create({
            data: { productId, buyerId: actor.id, sellerId },
            select: { id: true },
          });
    }
    if (firstMessage) {
      await tx.message.create({
        data: { ...firstMessage, conversationId: room.id, senderId: actor.id },
      });
      await tx.conversation.update({
        where: { id: room.id },
        data: { lastMessageAt: new Date() },
      });
    }
    return tx.conversation.findUnique({
      where: { id: room.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: MAX_HISTORY_MESSAGES },
        product: { select: { id: true, title: true, price: true } },
      },
    });
  });
};

/**
 * @notice Assert the caller is a room member, without hydrating messages.
 * @dev `waitForMessages` and the SSE handler authorise through `get`, which
 * @dev `include`d the *entire* message history and then discarded it: one
 * @dev wait on a 2001-message room hydrated 2001 rows, and 100 concurrent
 * @dev waits hydrated 200,100 rows (169MB -> 408MB RSS in ~1.2s).
 * @param {object} prisma Prisma client.
 * @param {string} id Conversation id.
 * @param {object} actor Authenticated member `{ id }`.
 * @return {Promise<{id: string, buyerId: string, sellerId: string}>} The room.
 */
const assertMember = async (prisma, id, actor) => {
  const room = await prisma.conversation.findFirst({
    where: { id, OR: [{ buyerId: actor.id }, { sellerId: actor.id }] },
    select: { id: true, buyerId: true, sellerId: true },
  });
  if (!room) throwError('CONVERSATION_NOT_FOUND');
  return room;
};

/**
 * @notice Load one room for a member (buyer or seller side).
 * @param {string} id Conversation id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Room or throws `CONVERSATION_NOT_FOUND`.
 */
const get = async (id, actor) => {
  const prisma = requireDb();
  const room = await prisma.conversation.findFirst({
    where: { id, OR: [{ buyerId: actor.id }, { sellerId: actor.id }] },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: MAX_HISTORY_MESSAGES },
      product: { select: { id: true, title: true, price: true } },
    },
  });
  if (!room) throwError('CONVERSATION_NOT_FOUND');
  return room;
};

/**
 * @notice List the caller's inbox (both sides), newest activity first.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} Rooms with product context and message counts.
 */
const inbox = async (actor) => {
  const prisma = requireDb();
  return prisma.conversation.findMany({
    where: { OR: [{ buyerId: actor.id }, { sellerId: actor.id }] },
    include: {
      product: { select: { id: true, title: true, price: true } },
      _count: { select: { messages: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: MAX_INBOX_ROOMS,
  });
};

/**
 * @notice Validate a chat message payload.
 * @dev Coordinates are range-checked *after* coercion. The old check only
 * @dev tested `input.latitude === undefined`, so `latitude: 'abc'` passed and
 * @dev `Number('abc')` silently became NULL, and `99999` was stored verbatim.
 * @dev `imageUrl` is scheme-checked so `javascript:` cannot be stored and
 * @dev rendered by the other party's client.
 * @param {object} input Raw body fields.
 * @return {object} Normalized message columns.
 */
const validateMessage = (input = {}) => {
  const type = String(input.type || 'TEXT').toUpperCase();
  if (!MESSAGE_TYPES.includes(type)) throwError('VALIDATION', { details: 'unknown message type' });
  const text =
    input.text === undefined || input.text === null
      ? null
      : toText(input.text, 'text', { min: 0, max: MAX_MESSAGE_LENGTH });
  const imageUrl =
    input.imageUrl === undefined || input.imageUrl === null
      ? null
      : assertSafeUrl(input.imageUrl, 'imageUrl');
  if (type === 'TEXT' && !text?.trim()) throwError('VALIDATION', { details: 'text is required' });
  if (type === 'IMAGE' && !imageUrl) throwError('VALIDATION', { details: 'imageUrl is required' });
  if (type === 'LOCATION') {
    if (input.latitude === undefined || input.longitude === undefined) {
      throwError('VALIDATION', { details: 'latitude and longitude are required' });
    }
  }
  return {
    type,
    text,
    imageUrl,
    latitude:
      input.latitude === undefined ? null : toNumber(input.latitude, 'latitude', { min: -90, max: 90 }),
    longitude:
      input.longitude === undefined
        ? null
        : toNumber(input.longitude, 'longitude', { min: -180, max: 180 }),
    locationLabel:
      input.locationLabel === undefined || input.locationLabel === null
        ? null
        : toText(input.locationLabel, 'locationLabel', { min: 0, max: 200 }),
  };
};

/**
 * @notice Send a message as a room member; bumps `lastMessageAt`.
 * @dev The notification is emitted *after* the transaction and can never fail
 * @dev the request: `notify` previously ran outside the transaction, so a
 * @dev notification insert error returned a 500 for a message that was already
 * @dev committed — the client's retry then produced a duplicate bubble.
 * @param {string} id Conversation id.
 * @param {object} input Raw message body.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Created message.
 */
const send = async (id, input, actor) => {
  const prisma = requireDb();
  const room = await assertMember(prisma, id, actor);
  const data = validateMessage(input);
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { ...data, conversationId: id, senderId: actor.id } }),
    prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    }),
  ]);
  const otherId = room.buyerId === actor.id ? room.sellerId : room.buyerId;
  const { notify } = require('../notifications/notification.service');
  // Best-effort: a side effect must never mask a committed write.
  await notify(
    otherId,
    'chat',
    'Pesan baru',
    (data.text || 'Lampiran baru').slice(0, 200),
    { conversationId: id }
  ).catch((err) => {
    console.error('[chat] notification failed after message commit:', err.message);
  });
  return message;
};

/**
 * @notice Read history and mark the other side's messages as read.
 * @param {string} id Conversation id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} Messages oldest first.
 */
const history = async (id, actor) => {
  await assertMember(requireDb(), id, actor);
  const prisma = requireDb();
  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: actor.id }, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return prisma.message.findMany({
    where: { conversationId: id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_HISTORY_MESSAGES,
  });
};

/**
 * @notice Fetch the most recent page of a room, oldest first.
 * @dev Used for the *initial* history render. This used to be folded into
 * @dev `fetchAfter(null)`, which cannot serve both needs: "give me the recent
 * @dev page" and "give me what is newer than X" are different questions, and
 * @dev the first version answered the second, so a client connecting with no
 * @dev cursor saw an empty chat and a long-poll returned immediately.
 * @param {string} id Conversation id.
 * @param {number} take Max rows.
 * @return {Promise<Array>} Messages, oldest first.
 */
const fetchLatest = async (id, take = MAX_PAGE_MESSAGES) => {
  const prisma = requireDb();
  const newestFirst = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: { id: true },
  });
  if (!newestFirst.length) return [];
  const oldest = newestFirst[newestFirst.length - 1];
  // Re-query ascending from the oldest id of the page so the tiebreak on `id`
  // keeps messages written in the same millisecond.
  return prisma.message.findMany({
    where: {
      conversationId: id,
      OR: [
        { createdAt: { gt: oldest.createdAt } },
        { createdAt: oldest.createdAt, id: { gte: oldest.id } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  });
};

/**
 * @notice Fetch messages strictly after a cursor, oldest first.
 * @dev Cursor (createdAt, id) avoids missing same-millisecond rows. With no
 * @dev cursor this returns nothing, because nothing has been "seen yet" — that
 * @dev is what makes a long-poll actually wait instead of immediately echoing
 * @dev the room's existing history.
 * @param {string} id Conversation id.
 * @param {string|null} afterId Message id cursor, or null for "nothing yet".
 * @param {number} take Max rows.
 * @return {Promise<Array>} Messages oldest first.
 */
const fetchAfter = async (id, afterId, take = MAX_PAGE_MESSAGES) => {
  const prisma = requireDb();
  if (!afterId) return [];
  const cursor = await prisma.message.findUnique({
    where: { id: afterId },
    select: { conversationId: true, createdAt: true },
  });
  if (!cursor || cursor.conversationId !== id) {
    throwError('VALIDATION', { details: 'unknown after cursor' });
  }
  return prisma.message.findMany({
    where: {
      conversationId: id,
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: afterId } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @notice Long-poll: wait until a reply arrives or the timeout elapses.
 * @dev The cursor is type-checked before use. Express 4's query parser turns
 * @dev `?after=a&after=b` into an array and `?after[a]=b` into an object, and
 * @dev both used to reach `message.findUnique({ where: { id: <object> } })`,
 * @dev producing a 500 with the driver message and absolute source paths.
 * @param {string} id Conversation id.
 * @param {object} actor Authenticated member `{ id }`.
 * @param {object} opts `{ after?, timeoutS? }`.
 * @return {Promise<object>} `{ outcome: 'new'|'waiting', messages }`.
 */
const waitForMessages = async (id, actor, opts = {}) => {
  const prisma = requireDb();
  await assertMember(prisma, id, actor);
  const after = opts.after ? toId(opts.after, 'after') : null;
  const timeoutS = toQueryInt(opts.timeoutS, 'timeout', {
    min: 1,
    max: MAX_WAIT_SECONDS,
    fallback: DEFAULT_WAIT_SECONDS,
  });
  if (activeWaits >= MAX_CONCURRENT_WAITS) {
    throwError('AGENT_ERROR', { details: 'too many concurrent waits, retry shortly' });
  }
  activeWaits += 1;
  const deadline = Date.now() + timeoutS * 1000;
  try {
    for (;;) {
      const messages = await fetchAfter(id, after);
      if (messages.length) return { outcome: 'new', messages };
      if (Date.now() >= deadline) return { outcome: 'waiting', messages: [] };
      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    activeWaits -= 1;
  }
};

module.exports = {
  open,
  get,
  assertMember,
  inbox,
  send,
  history,
  validateMessage,
  fetchAfter,
  fetchLatest,
  waitForMessages,
  MAX_HISTORY_MESSAGES,
  MAX_PAGE_MESSAGES,
};