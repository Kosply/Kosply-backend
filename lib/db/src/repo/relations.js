/**
 * @title Relation hydration
 * @notice Attaches related rows to already-fetched rows, in one extra query.
 * @dev Prisma's `include` and nested `select` did this automatically, issuing
 * @dev a second statement per relation. The app uses relations in a handful of
 * @dev places — a product's seller, a conversation's product, a verification's
 * @dev user, a room's message count — and each of them is needed on a route
 * @dev that returns a list, so a per-row lookup would turn one query into N.
 * @dev Every helper here batches: one query for the whole result set, with the
 * @dev rows matched back in memory.
 * @dev The joined value is always placed under the same key Prisma used, so the
 * @dev JSON the client receives does not change shape.
 */
const db = require('../db');

/**
 * @notice Attach a to-one relation to every row in a list.
 * @dev Rows whose foreign key is null get `null`, and rows pointing at a target
 * @dev that no longer exists also get `null` — the same shape Prisma returned
 * @dev for an optional relation whose row had been deleted.
 * @dev **The join column must be present on `rows`.** A nested `select` under an
 * @dev ORM did not need it — the join was built from the query, not the
 * @dev projection — so a caller could legitimately list only public columns and
 * @dev still get the relation. Here a projection that omits the foreign key
 * @dev makes the relation silently `null` for every row, which reads as "no
 * @dev seller" rather than as a bug. `attachRequired` therefore throws instead,
 * @dev and the repo helpers add the column themselves.
 * @param {Array<object>} rows Rows to hydrate.
 * @param {object} spec Relation description.
 * @param {string} spec.key Column on `rows` holding the foreign key.
 * @param {string} spec.targetTable Table to read from.
 * @param {Array<string>} spec.columns Columns to read from the target.
 * @param {string} spec.on Property name to set on each row.
 * @param {string} [spec.match] Target column matched against `rows[spec.key]`.
 *   Defaults to `id`. Set it for a *reverse* one-to-one relation — a user and
 *   its single verification row — where the target carries the foreign key
 *   (`seller_verifications.userId`) instead of pointing at the parent.
 * @return {Promise<Array<object>>} Hydrated rows.
 * @throws {TypeError} When the join column is absent from every row.
 */
const attachMany = async (rows, spec) => {
  if (!rows || rows.length === 0) return rows;
  const parentKey = spec.parentKey || 'id';
  if (!Object.prototype.hasOwnProperty.call(rows[0], spec.key)) {
    throw new TypeError(
      `Cannot attach "${spec.on}": the rows do not carry "${spec.key}", so nothing can be joined. ` +
      `Add it to the columns you selected.`
    );
  }
  const ids = [...new Set(rows.map((row) => row[spec.key]).filter((id) => id !== null && id !== undefined))];
  if (ids.length === 0) {
    return rows.map((row) => ({ ...row, [spec.on]: null }));
  }
  const match = spec.match || 'id';
  // The match column has to come back even when the caller did not ask for it:
  // it is how each target is matched back to its parent. Reading it back off
  // the projection would mean adding it to `columns` unconditionally, so it is
  // projected and then removed, leaving the caller's shape exactly as asked.
  const columns = spec.columns.includes(match) ? spec.columns : [...spec.columns, match];
  const targets = await db.selectMany(spec.targetTable, {
    where: { [match]: { in: ids } },
    columns,
  });
  const byParent = new Map(targets.map((target) => [target[match], target]));
  return rows.map((row) => {
    const target = byParent.get(row[spec.key]) ?? null;
    const related = target && !spec.columns.includes(match)
      ? Object.fromEntries(Object.entries(target).filter(([column]) => column !== match))
      : target;
    return { ...row, [spec.on]: related };
  });
};

/**
 * @notice Attach a to-one relation to a single row.
 * @param {object|null} row Row to hydrate.
 * @param {object} spec See `attachMany`.
 * @return {Promise<object|null>} Hydrated row, or null.
 */
const attachOne = async (row, spec) => {
  if (!row) return null;
  const [hydrated] = await attachMany([row], spec);
  return hydrated;
};

/**
 * @notice Attach a to-many relation to every row, capped per parent.
 * @dev The cap is applied per parent inside the single grouped query rather than
 * @dev with `LIMIT` on the whole result, which would starve every parent but the
 * @dev first. Prisma's `include: { messages: { take: 200 } }` had the same
 * @dev per-parent meaning, and the chat history endpoint depends on it.
 * @dev Implemented by ranking rows within each group and keeping the lowest rank,
 * @dev so the "most recent 200" reads the same rows it did before.
 * @param {Array<object>} rows Rows to hydrate.
 * @param {object} spec Relation description.
 * @param {string} spec.key Foreign-key column on the *target* table.
 * @param {string} [spec.parentKey] Column on `rows` holding the id, default `id`.
 * @param {string} spec.targetTable Table to read from.
 * @param {Array<string>} spec.columns Columns to read.
 * @param {string} spec.on Property name to set.
 * @param {object} [opts] Options.
 * @param {number} [opts.limit] Maximum children per parent.
 * @param {string} [opts.orderBy] Child column to order by.
 * @param {string} [opts.direction] `asc` or `desc`.
 * @return {Promise<Array<object>>} Hydrated rows.
 */
const attachChildren = async (rows, spec, opts = {}) => {
  if (!rows || rows.length === 0) return rows;
  const { quote } = require('../schema');
  const { castRow } = require('../cast');
  const parentKey = spec.parentKey || 'id';
  const groups = [...new Set(rows.map((row) => row[parentKey]).filter(Boolean))];
  if (groups.length === 0) {
    return rows.map((row) => ({ ...row, [spec.on]: [] }));
  }

  const orderBy = opts.orderBy || 'createdAt';
  const direction = opts.direction === 'desc' ? 'DESC' : 'ASC';
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : null;
  const placeholders = groups.map(() => '?').join(', ');

  // The window function ranks each group's rows in the requested order, then the
  // outer filter keeps only the first `limit` of each group. One statement, no
  // N+1, and the per-parent cap is genuine — a plain `LIMIT` would have capped
  // the whole result set and starved every room but the first.
  const inner = `SELECT *, ROW_NUMBER() OVER (
      PARTITION BY ${quote(spec.key)}
      ORDER BY ${quote(orderBy)} ${direction}, \`id\` ${direction}
    ) AS _kosply_rank
    FROM ${quote(spec.targetTable)}
    WHERE ${quote(spec.key)} IN (${placeholders})`;
  const sql = limit
    ? `SELECT * FROM (${inner}) AS ranked WHERE _kosply_rank <= ? ORDER BY ${quote(orderBy)} ${direction}, \`id\` ${direction}`
    : `SELECT * FROM (${inner}) AS ranked ORDER BY ${quote(orderBy)} ${direction}, \`id\` ${direction}`;
  // Bound parameters are positional in the order their placeholders appear in
  // the *text*, which here means the group ids first (they sit in the inner
  // subquery) and the limit last (outer WHERE). Reversing these returns zero
  // rows rather than an error, so it fails silently.
  const params = limit ? [...groups, limit] : groups;

  const children = await db.selectRaw(sql, params);
  const byParent = new Map();
  for (const child of children) {
    const parent = child[spec.key];
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(castRow(spec.targetTable, child));
  }
  return rows.map((row) => ({ ...row, [spec.on]: byParent.get(row[parentKey]) || [] }));
};

/**
 * @notice Count related rows per parent.
 * @dev Replaces Prisma's `_count: { select: { messages: true } }`, which the
 * @dev chat inbox used to show an unread badge. Grouped in one statement.
 * @param {Array<object>} rows Rows to annotate.
 * @param {object} spec Relation description.
 * @param {string} spec.key Column on `rows` holding the relation's value.
 * @param {string} spec.targetTable Table to count in.
 * @param {string} spec.on Property name holding the count.
 * @param {string} [spec.match] Column on `targetTable` that `rows[spec.key]`
 *   refers to, default `id`.
 * @return {Promise<Array<object>>} Rows with the count attached.
 */
const countChildren = async (rows, spec) => {
  if (!rows || rows.length === 0) return rows;
  const values = [...new Set(rows.map((row) => row[spec.key]).filter(Boolean))];
  if (values.length === 0) {
    return rows.map((row) => ({ ...row, [spec.on]: 0 }));
  }
  const match = spec.match || 'id';
  const grouped = await db.aggregate(spec.targetTable, {
    where: { [match]: { in: values } },
    groupBy: [match],
    aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
  });
  const byParent = new Map(grouped.map((row) => [row[match], Number(row.total)]));
  return rows.map((row) => ({ ...row, [spec.on]: byParent.get(row[spec.key]) ?? 0 }));
};

module.exports = { attachChildren, attachMany, attachOne, countChildren };