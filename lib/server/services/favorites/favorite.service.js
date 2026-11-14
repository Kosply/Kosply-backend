/**
 * @title Favorite service (saved listings)
 * @notice The product-detail heart, persisted per user.
 * @dev A save is the (`userId`, `productId`) pair: adding twice is idempotent
 * @dev (the original save, and its position in the list, is kept) and removing
 * @dev something that was never saved is not an error — the heart is a toggle
 * @dev on the client, so both calls must be safe to repeat.
 * @dev The list hydrates products with their sellers and keeps the save order.
 * @dev A product that has since been ARCHIVED is dropped, exactly as the public
 * @dev catalog and product detail drop it; SOLD ones stay, because a student may
 * @dev still want to see what happened to a listing they saved.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { listWithSeller } = require('../../../db/src/repo/products');
const { PUBLIC_PRODUCT_LIST_COLUMNS } = require('../../../db/src/selects');

/** @dev Bound the read: the saved list renders one page, like the catalog. */
const MAX_FAVORITES_PER_QUERY = 100;

/**
 * @notice List the caller's saved products, newest save first.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<Array>} Products with `seller`; archived ones omitted.
 */
const list = async (actor) => {
  const db = requireDb();
  const saved = await db.selectMany('favorites', {
    where: { userId: actor.id },
    orderBy: { createdAt: 'desc' },
    limit: MAX_FAVORITES_PER_QUERY,
  });
  if (saved.length === 0) return [];

  // One query for the whole page, then the save order is restored in memory:
  // `favorites.createdAt` is the ordering key the client sees, and it is not a
  // column on `products`, so SQL cannot order by it in the same read.
  const products = await listWithSeller({
    where: {
      id: { in: saved.map((row) => row.productId) },
      status: { in: ['ACTIVE', 'SOLD'] },
    },
    columns: [...PUBLIC_PRODUCT_LIST_COLUMNS, 'status'],
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return saved
    .map((row) => byId.get(row.productId))
    .filter((product) => product !== undefined);
};

/**
 * @notice Save a product for the caller (idempotent).
 * @param {string} productId Product id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} `{ productId }` or throws `PRODUCT_NOT_FOUND`.
 */
const add = async (productId, actor) => {
  const db = requireDb();
  // Saving a listing the catalog would not show is a client bug worth a 404,
  // not a row: an ARCHIVED product is invisible everywhere else too.
  const product = await db.selectOne('products', {
    where: { id: productId },
    columns: ['id', 'status'],
  });
  if (!product || product.status === 'ARCHIVED') throwError('PRODUCT_NOT_FOUND');
  // `update: {}` keeps the original `createdAt` when the row already exists, so
  // re-tapping the heart does not move the item to the top of the saved list.
  await db.upsert(
    'favorites',
    { userId: actor.id, productId },
    { where: { userId: actor.id, productId } }
  );
  return { productId };
};

/**
 * @notice Remove a save (idempotent).
 * @param {string} productId Product id.
 * @param {object} actor Authenticated user `{ id }`.
 * @return {Promise<object>} `{ productId, removed }`; `removed` false and no
 * @return error when nothing was saved, so a toggle can repeat safely.
 */
const remove = async (productId, actor) => {
  const db = requireDb();
  const count = await db.remove('favorites', { where: { userId: actor.id, productId } });
  return { productId, removed: count > 0 };
};

module.exports = { list, add, remove, MAX_FAVORITES_PER_QUERY };
