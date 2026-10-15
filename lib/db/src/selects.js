/**
 * @title Public column allow-lists (leak prevention)
 * @notice Whitelisted column sets for machine/public responses.
 * @dev Import these in services instead of listing columns by hand, so a
 * @dev sensitive column (`email`, `passwordHash`, `nim`, `ktmImageUrl`) can
 * @dev never leak through a new endpoint by accident.
 * @dev These are plain arrays of column names. They replaced Prisma `select`
 * @dev objects, which could also nest a relation (`seller: { select }`); a
 * @dev relation is now attached explicitly by `repo/relations.js`, so the
 * @dev allow-list stays a flat list of columns on one table — which is what
 * @dev makes "does this leak?" a question with a simple answer.
 * @dev `selects.test.js` asserts every list here against the forbidden set.
 */

/** @dev Seller columns safe to show on a product card. */
const PUBLIC_SELLER_COLUMNS = ['username', 'name', 'role', 'universitas'];

/** @dev Product columns safe in a list response. */
const PUBLIC_PRODUCT_LIST_COLUMNS = [
  'id',
  'title',
  'price',
  'stock',
  'imageUrls',
  'category',
  'latitude',
  'longitude',
  'locationLabel',
];

/** @dev The list columns plus everything a detail view may show. */
const PUBLIC_PRODUCT_DETAIL_COLUMNS = [
  ...PUBLIC_PRODUCT_LIST_COLUMNS,
  'description',
  'status',
];

/** @dev User columns safe in a public profile response. */
const PUBLIC_USER_COLUMNS = ['id', 'username', 'name', 'role', 'universitas'];

/**
 * Seller-private analytics read set. `sellerId` is added by the service after
 * the ownership check, never returned to the client.
 */
const SELLER_ANALYTICS_PRODUCT_COLUMNS = [
  'id',
  'title',
  'status',
  'price',
  'stock',
  'createdAt',
  'soldAt',
];

module.exports = {
  PUBLIC_SELLER_COLUMNS,
  PUBLIC_PRODUCT_LIST_COLUMNS,
  PUBLIC_PRODUCT_DETAIL_COLUMNS,
  PUBLIC_USER_COLUMNS,
  SELLER_ANALYTICS_PRODUCT_COLUMNS,
};