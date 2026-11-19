/**
 * @title Product category catalog
 * @notice The public list the add-product dropdown reads, and the check a
 * product write uses before it stores `products.category`.
 * @dev Names live in `product_categories` (migration
 * `20261118120000_add_product_categories`). The column on `products` stays a
 * string so a listing written before the list still loads. A new non-empty
 * category must be an active row. An update may keep the listing's current
 * category even when that word is not in the list.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

/** @dev Enough for the seeded dropdown. The table is a short catalog. */
const MAX_CATEGORIES = 50;

/**
 * @notice Active categories in display order.
 * @return {Promise<Array<{id: string, name: string}>>} Rows the phone shows.
 */
const list = async () => {
  const db = requireDb();
  const rows = await db.selectMany('product_categories', {
    where: { isActive: true },
    columns: ['id', 'name'],
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    limit: MAX_CATEGORIES,
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
};

/**
 * @notice Active category names in the same order as {list}.
 * @return {Promise<Array<string>>} Names, or an empty list when the read fails.
 * @dev A photo turn appends this line for the model. A database miss must not
 * turn a valid caption into a 500; the dropdown is what blocks a bad publish.
 */
const activeNames = async () => {
  try {
    const items = await list();
    return items.map((item) => item.name);
  } catch {
    return [];
  }
};

/**
 * @notice Resolve a category the seller sent to the stored seed name.
 * @param {string|null|undefined} name Trimmed category, or empty when omitted.
 * @param {object} [opts] Options.
 * @param {string|null} [opts.allow] Current listing category, kept as-is.
 * @return {Promise<string|null|undefined>} Canonical name, or the input when empty.
 */
const canonicalCategory = async (name, opts = {}) => {
  if (name === undefined || name === null || name === '') return name;
  const allow = opts.allow;
  if (typeof allow === 'string' && allow !== '' && allow.toLowerCase() === name.toLowerCase()) {
    return allow;
  }
  const db = requireDb();
  const row = await db.selectOne('product_categories', {
    where: { name, isActive: true },
    columns: ['name'],
  });
  if (!row) throwError('VALIDATION', { details: 'unknown category' });
  return row.name;
};

module.exports = { list, activeNames, canonicalCategory };
