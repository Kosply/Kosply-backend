/**
 * @title Test fixture helpers
 * @notice Shared builders so test fixtures match how the app really grants a
 * @notice capability, instead of poking a column that nothing enforces.
 * @dev Selling rights require BOTH `users.role = 'SELLER'` AND an APPROVED,
 * @dev `isActive` `sellerVerification` row (see
 * @dev services/products/product.service.assertActiveSeller). Promoting the
 * @dev role alone used to be enough in tests, which is precisely why a banned
 * @dev seller could keep listing in production.
 * @dev These are now a thin adapter over `lib/db/src/testkit.js`, which owns the
 * @dev row-building and the FK-ordered teardown. The same "promote to an
 * @dev approved seller" sequence had been copy-pasted into five test files that
 * @dev had to stay in step; there is now one implementation.
 */
const testkit = require('../../../db/src/testkit');

/**
 * @notice A unique, collision-free test tag.
 * @return {string} Tag safe for an email local part and a username.
 */
const uniqueTag = (prefix) => testkit.uniqueTag(prefix);

/**
 * @notice Create a user, optionally with a role.
 * @param {object} [opts] `{ role, passwordHash, isActive }`.
 * @return {Promise<object>} The created user row.
 */
const createUser = (opts = {}) => testkit.createUser(opts);

/**
 * @notice Create a user who may actually sell: role SELLER + approved
 * @notice verification with `isActive: true`.
 * @return {Promise<object>} The created seller row.
 */
const createApprovedSeller = () => testkit.createApprovedSeller();

/**
 * @notice Create a user with a *rejected/frozen* verification.
 * @dev Use to prove a banned seller is actually blocked from selling.
 * @return {Promise<object>} The created seller row.
 */
const createBannedSeller = async () => {
  const user = await testkit.createUser({ role: 'SELLER' });
  await testkit.approveAsSeller(user, { status: 'REJECTED', isActive: false });
  return user;
};

/**
 * @notice Create a product owned by the given seller.
 * @param {string} sellerId Owner id.
 * @param {object} [overrides] Extra product fields.
 * @return {Promise<object>} The created product.
 */
const createProduct = (sellerId, overrides = {}) =>
  testkit.createProduct(sellerId, {
    description: 'Untuk pengujian.',
    price: 50_000,
    stock: 2,
    ...overrides,
  });

/**
 * @notice Remove every row a test created, in FK-safe order.
 * @dev Takes user ids only. Products, conversations, reports and support rows
 * @dev are found by walking the foreign keys from those users, so a caller can
 * @dev no longer forget a table and leave orphans behind for the next run.
 * @param {object} ids `{ users: [] }`.
 * @return {Promise<void>} Resolves once cleaned.
 */
const cleanup = (ids = {}) => testkit.cleanup(ids.users);

module.exports = { uniqueTag, createUser, createApprovedSeller, createBannedSeller, createProduct, cleanup };