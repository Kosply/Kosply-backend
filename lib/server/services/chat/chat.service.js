/**
 * @title COD chat service (rooms + messages)
 * @notice Buyer <-> seller rooms, one per buyer per product; history marks
 * @dev the other side's messages read on fetch (standard chat behavior).
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'LOCATION', 'SYSTEM'];

/**
 * @notice Open (or reuse) a room, optionally with a first message.
 * @dev Seller is derived from the product when `productId` is given, so
 * @dev buyers cannot spoof who they talk to. Null productId = general chat.
 * @param {object} input Body `{ productId?, message? }` (message = `{ type?, text?, imageUrl?, latitude?, longitude?, locationLabel? }`).
 * @param {object} actor Authenticated user `{ id }` (the buyer side).
 * @return {Promise<object>} Room with messages.
 */
const open = async (input = {}, actor) => {
  const prisma = requireDb();
  const productId =
    typeof input.productId === 'string' && input.productId.trim() ? input.productId.trim() : null;
  let sellerId = null;
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { sellerId: true },
    });
    if (!product) throwError('PRODUCT_NOT_FOUND');
    sellerId = product.sellerId;
  } else {
    sellerId =
      typeof input.sellerId === 'string' && input.sellerId.trim() ? input.sellerId.trim() : null;
    if (!sellerId) throwError('VALIDATION', { details: 'productId or sellerId is required' });
    const seller = await prisma.user.findUnique({ where: { id: sellerId }, select: { id: true } });
    if (!seller) throwError('USER_NOT_FOUND');
  }
  if (sellerId === actor.id) throwError('VALIDATION', { details: 'cannot chat with yourself' });
  let room = productId
    ? await prisma.conversation.findUnique({
        where: { productId_buyerId: { productId, buyerId: actor.id } },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    : null;
  if (!room) {
    room = await prisma.conversation.create({
      data: { productId, buyerId: actor.id, sellerId },
      include: { messages: true },
    });
  }
  if (input.message) {
    await send(room.id, input.message, actor);
    room = await prisma.conversation.findUnique({
      where: { id: room.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }
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
      messages: { orderBy: { createdAt: 'asc' } },
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
  });
};

/**
 * @notice Validate a chat message payload.
 * @param {object} input Raw body fields.
 * @return {object} Normalized message columns.
 */
const validateMessage = (input = {}) => {
  const type = String(input.type || 'TEXT').toUpperCase();
  if (!MESSAGE_TYPES.includes(type)) throwError('VALIDATION', { details: 'unknown message type' });
  const text = input.text === undefined || input.text === null ? null : String(input.text);
  const imageUrl = input.imageUrl === undefined || input.imageUrl === null ? null : String(input.imageUrl);
  if (type === 'TEXT' && !text?.trim()) throwError('VALIDATION', { details: 'text is required' });
  if (type === 'IMAGE' && !imageUrl?.trim()) throwError('VALIDATION', { details: 'imageUrl is required' });
  if (type === 'LOCATION' && (input.latitude === undefined || input.longitude === undefined)) {
    throwError('VALIDATION', { details: 'latitude and longitude are required' });
  }
  return {
    type,
    text,
    imageUrl,
    latitude: input.latitude === undefined ? null : Number(input.latitude),
    longitude: input.longitude === undefined ? null : Number(input.longitude),
    locationLabel: input.locationLabel === undefined || input.locationLabel === null ? null : String(input.locationLabel),
  };
};

/**
 * @notice Send a message as a room member; bumps `lastMessageAt`.
 * @param {string} id Conversation id.
 * @param {object} input Raw message body.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} Created message.
 */
const send = async (id, input, actor) => {
  const prisma = requireDb();
  const room = await prisma.conversation.findFirst({
    where: { id, OR: [{ buyerId: actor.id }, { sellerId: actor.id }] },
    select: { id: true },
  });
  if (!room) throwError('CONVERSATION_NOT_FOUND');
  const data = validateMessage(input);
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { ...data, conversationId: id, senderId: actor.id } }),
    prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    }),
  ]);
  return message;
};

/**
 * @notice Read history and mark the other side's messages as read.
 * @param {string} id Conversation id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} Messages oldest first.
 */
const history = async (id, actor) => {
  const room = await get(id, actor);
  const prisma = requireDb();
  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: actor.id }, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return prisma.message.findMany({
    where: { conversationId: room.id },
    orderBy: { createdAt: 'asc' },
  });
};

module.exports = { open, get, inbox, send, history, validateMessage };
