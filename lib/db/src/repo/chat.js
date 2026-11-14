/**
 * @title Chat room reads
 * @notice Hydrates a conversation with its message thread and product context.
 * @dev Every chat read Prisma expressed as a nested `include` lives here. Each
 * @dev is two batched statements rather than one per row, so a 100-room inbox
 * @dev costs 3 queries instead of 201.
 */
const db = require('../db');
const { attachChildren, attachMany, attachOne, countChildren } = require('./relations');
const { PUBLIC_SELLER_COLUMNS } = require('../selects');

/**
 * @dev Both members, on the same public column set a product card shows its
 * @dev seller with. A room only carried `buyerId`/`sellerId`, so the Flutter
 * @dev inbox could not name or picture the other side without one profile call
 * @dev per row.
 */
const BUYER = {
  key: 'buyerId',
  targetTable: 'users',
  columns: PUBLIC_SELLER_COLUMNS,
  on: 'buyer',
};
const SELLER = {
  key: 'sellerId',
  targetTable: 'users',
  columns: PUBLIC_SELLER_COLUMNS,
  on: 'seller',
};

/** @dev Newest bubble per room, for the inbox preview line. */
const LAST_MESSAGE = {
  key: 'conversationId',
  targetTable: 'messages',
  on: '_lastMessages',
};

/** @dev Message thread, oldest first. */
const MESSAGES = {
  key: 'conversationId',
  targetTable: 'messages',
  on: 'messages',
};

/** @dev The bargained product, when the room has one. */
const PRODUCT = {
  key: 'productId',
  targetTable: 'products',
  columns: ['id', 'title', 'price'],
  on: 'product',
};

/**
 * @notice Attach the product context to a room or a list of rooms.
 * @param {Array<object>} rows Rooms.
 * @return {Promise<Array<object>>} Rooms with `product` (null for general chat).
 */
const withProducts = (rows) => attachMany(rows, PRODUCT);

/**
 * @notice Attach the buyer and the seller to a list of rooms.
 * @param {Array<object>} rows Rooms.
 * @return {Promise<Array<object>>} Rooms with `buyer` and `seller`.
 */
const withMembers = async (rows) => attachMany(await attachMany(rows, BUYER), SELLER);

/**
 * @notice Count, per room, the bubbles the viewer has not read yet.
 * @dev Only the other member's messages count: a viewer never owes themself a
 * @dev read receipt. One grouped statement for the whole inbox page.
 * @param {Array<object>} rows Rooms.
 * @param {string} viewerId The member reading the inbox.
 * @return {Promise<Map<string, number>>} Unread count by room id.
 */
const unreadByRoom = async (rows, viewerId) => {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (ids.length === 0 || !viewerId) return new Map();
  const grouped = await db.aggregate('messages', {
    where: { conversationId: { in: ids }, isRead: false, senderId: { not: viewerId } },
    groupBy: ['conversationId'],
    aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
  });
  return new Map(grouped.map((row) => [row.conversationId, Number(row.total)]));
};

/**
 * @notice Hydrate one room fully: thread plus product.
 * @dev The thread is capped *per room* inside one grouped query. A plain
 * @dev `LIMIT` would cap the whole result set, so the second room in an inbox
 * @dev would come back empty — the history each room shows must not depend on
 * @dev which other rooms happen to be in the same response.
 * @dev Members are attached too, so a chat screen opened from a product can
 * @dev title itself with the other side before the inbox was ever loaded.
 * @param {object|null} room Conversation row.
 * @param {object} [opts] Options.
 * @param {number} [opts.limit] Max messages to load.
 * @return {Promise<object|null>} Hydrated room, or null.
 */
const hydrateRoom = async (room, opts = {}) => {
  if (!room) return null;
  const [withProduct] = await withMembers(await withProducts([room]));
  const [withMessages] = await attachChildren([withProduct], MESSAGES, {
    limit: opts.limit,
    orderBy: 'createdAt',
  });
  return withMessages;
};

/**
 * @notice Hydrate an inbox listing: product, members, last bubble and counts.
 * @dev Counts are grouped, so the badge costs one statement for the whole page.
 * @dev `lastMessage` and `unreadCount` exist so a row renders without loading
 * @dev the thread; `unreadCount` is per viewer and 0 when none is given.
 * @param {Array<object>} rows Rooms.
 * @param {object} [opts] Options.
 * @param {string} [opts.viewerId] Member reading the inbox, for `unreadCount`.
 * @return {Promise<Array<object>>} Rooms with `product`, `buyer`, `seller`,
 *   `lastMessage`, `unreadCount` and `_count.messages`.
 */
const hydrateInbox = async (rows, opts = {}) => {
  const withProduct = await withMembers(await withProducts(rows));
  const withLast = await attachChildren(withProduct, LAST_MESSAGE, {
    limit: 1,
    orderBy: 'createdAt',
    direction: 'desc',
  });
  const counted = await countChildren(withLast, {
    key: 'id',
    targetTable: 'messages',
    on: '_count',
    match: 'conversationId',
  });
  const unread = await unreadByRoom(counted, opts.viewerId);
  // Prisma's `_count` was an object keyed by relation (`_count.messages`), and
  // the Flutter client reads that shape. Keep it, rather than flattening the
  // count to a bare number and breaking every client that reads `_count.messages`.
  return counted.map(({ _lastMessages, ...room }) => ({
    ...room,
    lastMessage: _lastMessages[0] || null,
    unreadCount: unread.get(room.id) ?? 0,
    _count: { messages: room._count },
  }));
};

module.exports = {
  BUYER,
  MESSAGES,
  PRODUCT,
  SELLER,
  attachOne,
  hydrateInbox,
  hydrateRoom,
  withMembers,
  withProducts,
};