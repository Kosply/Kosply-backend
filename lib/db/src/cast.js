/**
 * @title Row value coercion
 * @notice Converts between MariaDB storage types and the JS types the API promises.
 * @dev This file exists because MariaDB has no BOOLEAN type and no JSON type.
 * @dev `BOOLEAN` is `tinyint(1)`, so the driver hands back `0`/`1`; Prisma used to
 * @dev hand back `true`/`false`. Left unconverted, the API serialised
 * @dev `"isActive": 1` and the Flutter client — which types the field as a bool —
 * @dev broke on every response carrying a user, product or admin.
 * @dev The JSON columns (`products.imageUrls`, `reports.evidenceUrls`,
 * @dev `notifications.data`) are `longtext`; MariaDB's `JSON` is only an alias for
 * @dev `longtext` plus a `json_valid()` CHECK, so the driver also returns raw text.
 * @dev Dates are `datetime(3)` with no zone. The pool pins `timezone: 'Z'`, and
 * @dev this module re-parses defensively should a string ever arrive instead.
 */
const { describe } = require('./schema');

/**
 * @notice Parse a `datetime` value into a UTC `Date`.
 * @dev A `datetime` string has no zone designator, so `new Date(str)` would read
 * @dev it as *local* time. Appending `Z` pins it to UTC, which is what the column
 * @dev actually holds.
 * @param {Date|string|number} value Driver value.
 * @return {Date} UTC instant.
 */
const toDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text);
  return new Date(hasZone ? text : `${text.replace(' ', 'T')}Z`);
};

/**
 * @notice Convert one value read from the database.
 * @param {string} table Physical table name.
 * @param {string} column Column name.
 * @param {*} value Raw driver value.
 * @return {*} Value in the type the caller expects.
 */
const fromDatabase = (table, column, value) => {
  if (value === null || value === undefined) return null;
  const model = describe(table);
  const type = model?.typeOf(column);
  switch (type) {
    case 'bool':
      return Boolean(value);
    case 'date':
      return toDate(value);
    case 'int':
    case 'float':
      return Number(value);
    case 'json':
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        // `checks.sql` installs a json_valid() CHECK on every JSON column, so
        // this is unreachable in practice. Returning the raw string beats
        // throwing inside a read: one bad row must not take down a list route.
        return value;
      }
    default:
      return value;
  }
};

/**
 * @notice Convert one value on its way to the database.
 * @dev `undefined` is passed through untouched: the builders skip those keys
 * @dev entirely, which is how a caller says "leave this column alone". That is
 * @dev not the same as `null`, which writes `NULL`.
 * @param {string} table Physical table name.
 * @param {string} column Column name.
 * @param {*} value Value the caller supplied.
 * @return {*} Value the driver can send.
 */
const toDatabase = (table, column, value) => {
  if (value === undefined || value === null) return value;
  const model = describe(table);
  const type = model?.typeOf(column);
  switch (type) {
    case 'bool':
      return value ? 1 : 0;
    case 'int':
    case 'float':
      return Number(value);
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    default:
      return value;
  }
};

/**
 * @notice Convert a whole row.
 * @param {string} table Physical table name.
 * @param {object} row Raw driver row.
 * @return {object} Row with every known column coerced.
 */
const castRow = (table, row) => {
  if (!row) return row;
  const model = describe(table);
  if (!model) return row;
  const out = {};
  for (const column of model.names) {
    if (Object.prototype.hasOwnProperty.call(row, column)) {
      out[column] = fromDatabase(table, column, row[column]);
    }
  }
  return out;
};

/**
 * @notice Prepare a write payload for the database.
 * @dev Validates every column against the registry and coerces each value.
 * @dev The validation is the reason a mistyped column name fails at the call
 * @dev site with a clear message instead of `ER_BAD_FIELD_ERROR` from the server
 * @dev — `sql.js` calls this before building any statement.
 * @param {string} table Physical table name.
 * @param {object} data Column/value pairs. `undefined` values are dropped.
 * @return {Array<object>} One `{ column, value }` per column to write.
 * @throws {TypeError} On an unknown table or column.
 */
const prepareWrite = (table, data) => {
  const model = describe(table);
  if (!model) throw new TypeError(`Unknown table "${table}"`);
  const entries = [];
  for (const [column, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(model.columns, column)) {
      throw new TypeError(`Unknown column "${column}" on "${table}"`);
    }
    entries.push({ column, value: toDatabase(table, column, value) });
  }
  return entries;
};

module.exports = { castRow, fromDatabase, prepareWrite, toDatabase, toDate };