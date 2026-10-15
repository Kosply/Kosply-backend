/**
 * @title Chat room reads
 * @notice Hydrates a conversation with its message thread and product context.
 * @dev Every chat read Prisma expressed as a nested `include` lives here. Each
 * @dev is two batched statements rather than one per row, so a 100-room inbox
 * @dev costs 3 queries instead of 201.
 */
const { attachChildren, attachMany, attachOne, countChildren } = require('./relations');

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
 * @notice Hydrate one room fully: thread plus product.
 * @dev The thread is capped *per room* inside one grouped query. A plain
 * @dev `LIMIT` would cap the whole result set, so the second room in an inbox
 * @dev would come back empty — the history each room shows must not depend on
 * @dev which other rooms happen to be in the same response.
 * @param {object|null} room Conversation row.
 * @param {object} [opts] Options.
 * @param {number} [opts.limit] Max messages to load.
 * @return {Promise<object|null>} Hydrated room, or null.
 */
const hydrateRoom = async (room, opts = {}) => {
  if (!room) return null;
  const [withProduct] = await withProducts([room]);
  const [withMessages] = await attachChildren([withProduct], MESSAGES, {
    limit: opts.limit,
    orderBy: 'createdAt',
  });
  return withMessages;
};

/**
 * @notice Hydrate an inbox listing: product context plus message counts.
 * @dev Counts are grouped, so the badge costs one statement for the whole page.
 * @param {Array<object>} rows Rooms.
 * @return {Promise<Array<object>>} Rooms with `product` and `_count.messages`.
 */
const hydrateInbox = async (rows) => {
  const withProduct = await withProducts(rows);
  const counted = await countChildren(withProduct, {
    key: 'id',
    targetTable: 'messages',
    on: '_count',
    match: 'conversationId',
  });
  // Prisma's `_count` was an object keyed by relation (`_count.messages`), and
  // the Flutter client reads that shape. Keep it, rather than flattening the
  // count to a bare number and breaking every client that reads `_count.messages`.
  return counted.map((room) => ({ ...room, _count: { messages: room._count } }));
};

module.exports = { MESSAGES, PRODUCT, attachOne, hydrateInbox, hydrateRoom, withProducts };