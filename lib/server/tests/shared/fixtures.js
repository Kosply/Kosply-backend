/**
 * @title Test fixture helpers
 * @notice Shared builders so test fixtures match how the app really grants a
 * @notice capability, instead of poking a column that nothing enforces.
 * @dev Selling rights require BOTH `users.role = 'SELLER'` AND an APPROVED,
 * @dev `isActive` `sellerVerification` row (see
 * @dev services/products/product.service.assertActiveSeller). Promoting the
 * @dev role alone used to be enough in tests, which is precisely why a banned
 * @dev seller could keep listing in production.
 */
const { requireDb } = require('../../config/db');

let counter = 0;

/**
 * @notice A unique, collision-free test tag.
 * @return {string} Tag safe for an email local part and a username.
 */
const uniqueTag = (prefix) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

/**
 * @notice Create a user, optionally with a role.
 * @param {object} [opts] `{ role, passwordHash, isActive }`.
 * @return {Promise<object>} The created user row.
 */
const createUser = async (opts = {}) => {
  const prisma = requireDb();
  const tag = uniqueTag('u');
  return prisma.user.create({
    data: {
      email: `${tag}@kosply.test`,
      username: tag,
      name: `Test ${tag}`,
      passwordHash: opts.passwordHash || 'x',
      universitas: 'Univ Test',
      programStudi: 'Prodi Test',
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.isActive === undefined ? {} : { isActive: opts.isActive }),
    },
  });
};

/**
 * @notice Create a user who may actually sell: role SELLER + approved
 * @notice verification with `isActive: true`.
 * @return {Promise<object>} The created seller row.
 */
const createApprovedSeller = async () => {
  const prisma = requireDb();
  const seller = await createUser({ role: 'SELLER' });
  await prisma.sellerVerification.create({
    data: {
      userId: seller.id,
      namaLengkap: seller.name,
      nim: `NIM-${seller.id}`,
      universitas: seller.universitas,
      programStudi: seller.programStudi,
      ktmImageUrl: 'https://cdn.test/ktm.png',
      status: 'APPROVED',
      isActive: true,
    },
  });
  return seller;
};

/**
 * @notice Create a user with a *rejected/frozen* verification.
 * @dev Use to prove a banned seller is actually blocked from selling.
 * @return {Promise<object>} The created seller row.
 */
const createBannedSeller = async () => {
  const prisma = requireDb();
  const seller = await createUser({ role: 'SELLER' });
  await prisma.sellerVerification.create({
    data: {
      userId: seller.id,
      namaLengkap: seller.name,
      nim: `NIM-${seller.id}`,
      universitas: seller.universitas,
      programStudi: seller.programStudi,
      ktmImageUrl: 'https://cdn.test/ktm.png',
      status: 'REJECTED',
      isActive: false,
    },
  });
  return seller;
};

/**
 * @notice Create a product owned by the given seller.
 * @param {string} sellerId Owner id.
 * @param {object} [overrides] Extra product fields.
 * @return {Promise<object>} The created product.
 */
const createProduct = async (sellerId, overrides = {}) =>
  requireDb().product.create({
    data: {
      sellerId,
      title: 'Kursi test',
      description: 'Untuk pengujian.',
      price: 50000,
      stock: 2,
      ...overrides,
    },
  });

/**
 * @notice Remove every row a test created, in FK-safe order.
 * @param {object} ids `{ users: [], products: [], conversations: [] }`.
 * @return {Promise<void>} Resolves once cleaned.
 */
const cleanup = async (ids = {}) => {
  const prisma = requireDb();
  const users = ids.users || [];
  const conversations = ids.conversations || [];
  await prisma.message.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  await prisma.productEvent.deleteMany({ where: { productId: { in: ids.products || [] } } });
  await prisma.product.deleteMany({ where: { id: { in: ids.products || [] } } });
  await prisma.sellerVerification.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
};

module.exports = { uniqueTag, createUser, createApprovedSeller, createBannedSeller, createProduct, cleanup };
