/**
 * @title Product reads that need the seller attached
 * @notice The product list/detail shapes used by the catalog, the chat room and
 * @dev the internal AI proxy.
 * @dev Everything else about `products` is a plain single-table read and belongs
 * @dev in the service, via `db.selectOne('products', …)`. Only the joins Prisma
 * @dev used to express with a nested `select` live here.
 */
const db = require('../db');
const { attachMany } = require('./relations');
const { PUBLIC_SELLER_COLUMNS } = require('../selects');

/** @dev Relation description reused by every read in this file. */
const SELLER = {
  key: 'sellerId',
  targetTable: 'users',
  columns: PUBLIC_SELLER_COLUMNS,
  on: 'seller',
};

/**
 * @notice Attach each product's seller under the `seller` key.
 * @dev One extra query for the whole page, not one per product.
 * @dev `sellerId` is added to the projection because the join needs it, then
 * @dev removed again unless the caller selected it — `sellerId` is owner-only
 * @dev information and must not ride along in a public response.
 * @param {Array<object>} rows Products, already filtered and ordered.
 * @param {Array<string>} requested The columns the caller asked for.
 * @return {Promise<Array<object>>} Rows with a `seller` object (or null).
 */
const withSellers = async (rows, requested) => {
  const keepSellerId = requested ? requested.includes('sellerId') : true;
  const hydrated = await attachMany(rows, SELLER);
  if (keepSellerId) return hydrated;
  return hydrated.map(({ sellerId, ...rest }) => rest);
};

/**
 * @notice Read a list of products with their sellers attached.
 * @param {object} opts See `db.selectMany`.
 * @return {Promise<Array<object>>} Products with `seller`.
 */
const listWithSeller = async (opts) =>
  withSellers(
    await db.selectMany('products', {
      ...opts,
      columns: ['sellerId', ...(opts.columns || [])],
    }),
    opts.columns
  );

/**
 * @notice Read one product with its seller attached.
 * @param {object} opts See `db.selectOne`.
 * @return {Promise<object|null>} Product with `seller`, or null.
 */
const oneWithSeller = async (opts) => {
  const row = await db.selectOne('products', {
    ...opts,
    columns: ['sellerId', ...(opts.columns || [])],
  });
  return row ? (await withSellers([row], opts.columns))[0] : null;
};

module.exports = { SELLER, listWithSeller, oneWithSeller, withSellers };