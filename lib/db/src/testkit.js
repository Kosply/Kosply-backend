/**
 * @title Test fixtures for database-backed tests
 * @notice Creates and removes the rows a live API test needs.
 * @dev This module existed implicitly before: 24 test files each required the
 * @dev Prisma client directly and hand-rolled the same rows, and the
 * @dev "promote this user to an approved seller" sequence was copy-pasted into
 * @dev five files that had to stay in step with each other.
 * @dev Teardown order matters and is the part that is easy to get wrong:
 * @dev MariaDB has no `ON DELETE CASCADE` on these tables, so a row cannot be
 * @dev removed before its children. `cleanup()` walks the order.
 */
const db = require('./db');

let counter = 0;

/**
 * @notice Build a tag unique to this process and call.
 * @dev Tests run in one process against one shared database, so a tag based
 * @dev only on the clock can collide between two files created in the same
 * @dev millisecond.
 * @param {string} [prefix] Short label, usually the test subject.
 * @return {string} Unique tag, e.g. `chat1ab9z`.
 */
const uniqueTag = (prefix = 't') => {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
};

/**
 * @notice Create a user row.
 * @param {object} [overrides] Column overrides; sensible test defaults fill the rest.
 * @return {Promise<object>} The created user.
 */
const createUser = async (overrides = {}) => {
  const tag = overrides.username || uniqueTag('u');
  return db.insert('users', {
    email: `${tag}@kosply.test`,
    username: tag,
    name: `Test ${tag}`,
    // Not a bcrypt hash: fixtures never log in through this path.
    passwordHash: 'test-only-not-a-bcrypt-hash',
    universitas: 'Univ Test',
    programStudi: 'Prodi Test',
    role: 'BUYER',
    ...overrides,
  });
};

/**
 * @notice Promote a user to an approved, active seller.
 * @dev Both halves are required: `users.role` satisfies the auth middleware and
 * @dev `seller_verifications` is what `assertActiveSeller` reads. Setting one
 * @dev without the other is exactly the state the product service refuses, so a
 * @dev test that did that would be testing a path nobody can reach.
 * @param {object} user The user to promote.
 * @param {object} [overrides] Verification-column overrides.
 * @return {Promise<object>} The verification row.
 */
const approveAsSeller = async (user, overrides = {}) => {
  await db.update('users', { role: 'SELLER' }, { where: { id: user.id } });
  return db.upsert(
    'seller_verifications',
    {
      userId: user.id,
      namaLengkap: user.name,
      nim: `NIM-${user.id}`,
      universitas: user.universitas,
      programStudi: user.programStudi,
      ktmImageUrl: 'https://cdn.test/ktm.png',
      status: 'APPROVED',
      isActive: true,
      ...overrides,
    },
    { where: { userId: user.id }, update: overrides }
  );
};

/**
 * @notice Create a user who is already an approved seller.
 * @param {object} [overrides] Column overrides for the user row.
 * @return {Promise<object>} The created seller.
 */
const createApprovedSeller = async (overrides = {}) => {
  const user = await createUser({ role: 'SELLER', ...overrides });
  await approveAsSeller(user);
  return user;
};

/**
 * @notice Create a product owned by `seller`.
 * @param {string} sellerId Owning user id.
 * @param {object} [overrides] Column overrides.
 * @return {Promise<object>} The created product.
 */
const createProduct = async (sellerId, overrides = {}) => db.insert('products', {
  sellerId,
  title: 'Kursi test',
  description: 'Kokoh.',
  price: 50_000,
  stock: 1,
  imageUrls: [],
  ...overrides,
});

/**
 * @notice Delete users and everything that references them.
 * @dev Children first, in foreign-key order. A missing table is skipped rather
 * @dev than failing the suite, so a test that never created a chat does not have
 * @dev to know whether messages exist.
 * @param {Array<string>} userIds Users to remove.
 * @return {Promise<void>} Resolves once every row is gone.
 */
const cleanup = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  const conversations = await db.selectMany('conversations', {
    where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] },
    columns: ['id'],
  });
  const conversationIds = conversations.map((c) => c.id);
  const products = await db.selectMany('products', {
    where: { sellerId: { in: ids } },
    columns: ['id'],
  });
  const productIds = products.map((p) => p.id);

  await db.remove('tool_invocations', { where: { userId: { in: ids } } });
  await db.remove('ai_messages', { where: { conversationId: { in: (await db.selectMany('ai_conversations', { where: { userId: { in: ids } }, columns: ['id'] })).map((c) => c.id) } } });
  await db.remove('ai_conversations', { where: { userId: { in: ids } } });
  await db.remove('notifications', { where: { userId: { in: ids } } });
  await db.remove('notification_preferences', { where: { userId: { in: ids } } });
  await db.remove('password_resets', { where: { userId: { in: ids } } });
  if (conversationIds.length) {
    await db.remove('messages', { where: { conversationId: { in: conversationIds } } });
    await db.remove('conversations', { where: { id: { in: conversationIds } } });
  }
  await db.remove('support_messages', { where: { ticketId: { in: (await db.selectMany('support_tickets', { where: { userId: { in: ids } }, columns: ['id'] })).map((t) => t.id) } } });
  await db.remove('support_tickets', { where: { userId: { in: ids } } });
  await db.remove('reports', { where: { OR: [{ reporterId: { in: ids } }, { reportedUserId: { in: ids } }] } });
  if (productIds.length) await db.remove('product_events', { where: { productId: { in: productIds } } });
  await db.remove('products', { where: { sellerId: { in: ids } } });
  await db.remove('seller_verifications', { where: { userId: { in: ids } } });
  await db.remove('users', { where: { id: { in: ids } } });
};

module.exports = {
  approveAsSeller,
  cleanup,
  createApprovedSeller,
  createProduct,
  createUser,
  uniqueTag,
};