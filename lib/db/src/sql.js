/**
 * @title SQL statement builder
 * @notice Compiles validated query descriptors into parameterised SQL.
 * @dev Every value the application controls travels as a bound parameter, never
 * @dev as text spliced into the statement. Identifiers — table and column names —
 * @dev are checked against `schema.js` before they are backtick-quoted, so the
 * @dev only strings that reach the server are ones that exist in the registry.
 * @dev This is deliberately not an ORM. It compiles exactly the shapes the app
 * @dev uses and refuses everything else, which keeps the generated SQL
 * @dev predictable enough to review and fast enough for the analytics routes.
 */
const { describe, quote, RELATIONS } = require('./schema');
const { prepareWrite } = require('./cast');
const { cuid2 } = require('./ids');

/**
 * @notice SQL fragment used for `LIKE ... ESCAPE`.
 * @dev Written as `\\` because MySQL treats backslash as an escape character
 * @dev inside string literals; the driver then sends a single backslash.
 */
const LIKE_ESCAPE = '\\\\';

/**
 * @notice Neutralise LIKE metacharacters in user input.
 * @dev Without this, a search for `50%` matched every row and `_` matched any
 * @dev character — a product title could be used to widen someone else's search.
 * @param {*} value Raw user input.
 * @return {string} Value safe to embed between `%` wildcards.
 */
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * @notice Compile the correlated part of a relation subquery.
 * @dev Pure SQL on identifiers — both columns were validated against the
 * @dev registry above, and no value ever passes through here.
 * @param {object} edge Relation edge from `schema.js`.
 * @param {string} table The table being filtered.
 * @return {string} `related.fk = table.key`.
 */
const correlation = (edge, table) =>
  `${quote(edge.table)}.${quote(edge.to)} = ${quote(table)}.${quote(edge.from)}`;

/**
 * @notice Compile a filter that traverses a relation.
 * @dev Produces a correlated `EXISTS` / `NOT EXISTS` subquery. Chosen over a
 * @dev JOIN because a join would duplicate the parent row once per matching
 * @dev child, which would corrupt `LIMIT` on a list route — "20 products with
 * @dev traffic" would come back as fewer distinct products.
 * @param {string} table Physical table name.
 * @param {string} relation Relation name.
 * @param {*} spec `{ some: cond }`, `{ none: cond }`, or a bare condition.
 * @param {Array} params Accumulator for bound parameters.
 * @return {string} SQL fragment.
 */
const compileRelation = (table, relation, spec, params) => {
  const edge = RELATIONS[table]?.[relation];
  if (!edge) throw new TypeError(`Unknown relation "${table}.${relation}"`);

  let negate = false;
  let inner = spec;
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && !(spec instanceof Date)) {
    const keys = Object.keys(spec);
    if (keys.length === 1 && (keys[0] === 'some' || keys[0] === 'none')) {
      if (keys[0] === 'none') negate = true;
      inner = spec[keys[0]];
    }
  }
  const condition = compileExpression(edge.table, inner, params);
  const subquery = `EXISTS (SELECT 1 FROM ${quote(edge.table)} WHERE ${correlation(edge, table)}${
    condition ? ` AND ${condition}` : ''})`;
  return negate ? `NOT ${subquery}` : subquery;
};

/**
 * @notice Compile a single column comparison.
 * @param {string} table Physical table name.
 * @param {string} column Column name.
 * @param {*} spec A value, or an object of operators.
 * @param {Array} params Accumulator for bound parameters.
 * @return {string} SQL fragment.
 */
const compileCondition = (table, column, spec, params) => {
  const col = quote(column);
  const type = describe(table).typeOf(column);
  const encode = (value) => require('./cast').toDatabase(table, column, value);

  if (spec === null) return `${col} IS NULL`;
  if (typeof spec !== 'object' || spec instanceof Date || Array.isArray(spec)) {
    params.push(encode(spec));
    return `${col} = ?`;
  }

  const parts = [];
  for (const [op, rawValue] of Object.entries(spec)) {
    switch (op) {
      case 'equals':
        parts.push(`${col} = ?`);
        params.push(encode(rawValue));
        break;
      case 'not':
        if (rawValue === null) parts.push(`${col} IS NOT NULL`);
        else {
          parts.push(`${col} <> ?`);
          params.push(encode(rawValue));
        }
        break;
      case 'in':
      case 'notIn': {
        // An empty list must select nothing (`in`) or everything (`notIn`).
        // `IN ()` is a syntax error, and dropping the clause instead would
        // silently widen the result set — e.g. returning every report instead
        // of none when the status filter resolved to no values.
        if (!rawValue.length) {
          parts.push(rawValue.length === 0 && op === 'in' ? '1 = 0' : '1 = 1');
          break;
        }
        parts.push(`${col} ${op === 'in' ? 'IN' : 'NOT IN'} (${rawValue.map(() => '?').join(', ')})`);
        params.push(...rawValue.map(encode));
        break;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const sqlOp = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
        parts.push(`${col} ${sqlOp} ?`);
        params.push(encode(rawValue));
        break;
      }
      case 'contains':
        parts.push(`${col} LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
        params.push(`%${escapeLike(rawValue)}%`);
        break;
      case 'startsWith':
        parts.push(`${col} LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
        params.push(`${escapeLike(rawValue)}%`);
        break;
      case 'endsWith':
        parts.push(`${col} LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
        params.push(`%${escapeLike(rawValue)}`);
        break;
      default:
        throw new TypeError(`Unsupported operator "${op}" on ${table}.${column}`);
    }
  }
  // Several operators on one column are ANDed, which is what a range
  // (`{ gte, lte }`) means.
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
};

/**
 * @notice Compile a `where` object into a bare condition expression.
 * @dev Keys are ANDed; `OR`/`AND`/`NOT` take arrays of nested conditions.
 * @dev Returns the expression *without* the `WHERE` keyword so nested branches
 * @dev can be combined. Emitting `WHERE` at every level produced statements
 * @dev like `WHERE (WHERE a OR WHERE b)`, which is a syntax error.
 * @param {string} table Physical table name.
 * @param {object} [where] Condition tree.
 * @param {Array} [params] Accumulator for bound parameters.
 * @return {string} Condition expression, or an empty string when unfiltered.
 */
const compileExpression = (table, where, params = []) => {
  if (!where || Object.keys(where).length === 0) return '';
  const model = describe(table);
  if (!model) throw new TypeError(`Unknown table "${table}"`);

  const parts = [];
  for (const [key, spec] of Object.entries(where)) {
    if (spec === undefined) continue;
    if (key === 'OR' || key === 'AND' || key === 'NOT') {
      if (!Array.isArray(spec) || spec.length === 0) continue;
      const nested = spec
        .map((item) => compileExpression(table, item, params))
        .filter(Boolean);
      if (nested.length === 0) continue;
      const joined = nested.join(key === 'OR' ? ' OR ' : ' AND ');
      // Always parenthesise, even for a single branch. Without them,
      // `{ sellerId, OR: [a, b] }` compiled to
      // `sellerId = ? AND a OR b`, which SQL reads as
      // `(sellerId AND a) OR b` — the seller filter silently stops applying
      // and the query starts returning other people's rows.
      parts.push(key === 'NOT' ? `NOT (${joined})` : `(${joined})`);
      continue;
    }
    if (RELATIONS[table]?.[key]) {
      parts.push(compileRelation(table, key, spec, params));
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(model.columns, key)) {
      throw new TypeError(`Unknown column "${key}" on "${table}"`);
    }
    parts.push(compileCondition(table, key, spec, params));
  }
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : parts.join(' AND ');
};

/**
 * @notice Compile a whole `where` object into a `WHERE` clause.
 * @param {string} table Physical table name.
 * @param {object} [where] Condition tree.
 * @param {Array} [params] Accumulator for bound parameters.
 * @return {string} `WHERE ...` clause, or an empty string when unfiltered.
 */
const compileWhere = (table, where, params = []) => {
  const expression = compileExpression(table, where, params);
  return expression ? `WHERE ${expression}` : '';
};

/**
 * @notice Compile `orderBy`.
 * @dev Accepts a single `{ column: 'asc'|'desc' }` or an array of them. Composite
 * @dev ordering is not optional in this app: the chat and notification pages use
 * @dev keyset pagination over `(createdAt, id)`, which is only stable when `id`
 * @dev breaks ties between rows sharing a timestamp.
 * @param {string} table Physical table name.
 * @param {object|Array<object>} orderBy Ordering descriptors.
 * @return {string} `ORDER BY ...` clause, or an empty string.
 */
const compileOrderBy = (table, orderBy) => {
  if (!orderBy) return '';
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const model = describe(table);
  const parts = list.map((entry) => {
    const [column, direction = 'asc'] = Object.entries(entry)[0] || [];
    if (!column) return null;
    if (!Object.prototype.hasOwnProperty.call(model.columns, column)) {
      throw new TypeError(`Cannot order by unknown column "${column}" on "${table}"`);
    }
    const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    return `${quote(column)} ${dir}`;
  }).filter(Boolean);
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
};

/**
 * @notice Build the column list for a SELECT.
 * @param {string} table Physical table name.
 * @param {Array<string>} [columns] Columns to read; all of them when omitted.
 * @return {string} Quoted, comma-separated column list.
 */
const compileColumns = (table, columns) => {
  const model = describe(table);
  if (!model) throw new TypeError(`Unknown table "${table}"`);
  if (!columns || columns.length === 0) return model.names.map(quote).join(', ');
  return columns.map((column) => {
    if (!Object.prototype.hasOwnProperty.call(model.columns, column)) {
      throw new TypeError(`Unknown column "${column}" on "${table}"`);
    }
    return quote(column);
  }).join(', ');
};

/**
 * @notice Build a SELECT.
 * @param {string} table Physical table name.
 * @param {object} [opts] Query options.
 * @param {Array<string>} [opts.columns] Columns to read.
 * @param {object} [opts.where] Condition tree.
 * @param {object|Array} [opts.orderBy] Ordering.
 * @param {number} [opts.limit] Row cap (SQL `LIMIT`).
 * @param {number} [opts.offset] Rows to skip.
 * @param {boolean} [opts.forUpdate] Append `FOR UPDATE` for pessimistic locking.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildSelect = (table, opts = {}) => {
  const params = [];
  const { columns, where, orderBy, limit, offset, forUpdate } = opts;
  const sql = [
    `SELECT ${compileColumns(table, columns)}`,
    `FROM ${quote(table)}`,
    compileWhere(table, where, params),
    compileOrderBy(table, orderBy),
  ].filter(Boolean).join(' ');
  const bounded = Number.isInteger(limit) && limit >= 0 ? ` LIMIT ${limit}` : '';
  const skipped = Number.isInteger(offset) && offset > 0 ? ` OFFSET ${offset}` : '';
  return {
    sql: `${sql}${bounded}${skipped}${forUpdate ? ' FOR UPDATE' : ''}`,
    params,
  };
};

/**
 * @notice Build a row count.
 * @param {string} table Physical table name.
 * @param {object} [opts] Query options.
 * @param {object} [opts.where] Condition tree.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildCount = (table, opts = {}) => {
  const params = [];
  const where = compileWhere(table, opts.where, params);
  return {
    sql: `SELECT COUNT(*) AS count FROM ${quote(table)} ${where}`.trim(),
    params,
  };
};

/**
 * @notice Build an INSERT.
 * @dev `id` columns absent from `data` are filled with a fresh cuid2, which is
 * @dev what `@default(cuid())` used to do. Re-running a seed is still safe
 * @dev because callers upsert on a natural key rather than reusing an id.
 * @dev `updatedAt` is stamped on insert for the same reason it is stamped on
 * @dev update: the column is `NOT NULL` with no database default, so Prisma's
 * @dev `@updatedAt` was the only thing making an insert legal. `createdAt` is
 * @dev left to its `DEFAULT CURRENT_TIMESTAMP(3)` and read back afterwards.
 * @param {string} table Physical table name.
 * @param {object} data Column/value pairs; `undefined` values are skipped.
 * @param {object} [opts] Extra options.
 * @param {boolean} [opts.ignoreDuplicateKey] Append `ON DUPLICATE KEY UPDATE id=id`.
 * @return {{sql: string, params: Array, columns: Array<string>}} Statement, parameters, written columns.
 */
const buildInsert = (table, data, opts = {}) => {
  const model = describe(table);
  const entries = prepareWrite(table, data);
  for (const column of model.names) {
    if (model.typeOf(column) === 'id' && !entries.some((e) => e.column === column)) {
      entries.unshift({ column, value: cuid2() });
    }
  }
  if (entries.length === 0) throw new TypeError(`Refusing to insert an empty row into "${table}"`);
  if (model.hasUpdatedAt && !entries.some((e) => e.column === 'updatedAt')) {
    entries.push({ column: 'updatedAt', raw: 'CURRENT_TIMESTAMP(3)' });
  }
  const columns = entries.map((e) => quote(e.column)).join(', ');
  const holders = entries.map((e) => (e.raw ? e.raw : '?')).join(', ');
  // The no-op upsert clause makes a repeated INSERT succeed instead of raising a
  // duplicate-key error; the caller still has to detect whether anything changed
  // by checking `affectedRows` (2 = updated, 1 = inserted).
  const tail = opts.ignoreDuplicateKey ? ' ON DUPLICATE KEY UPDATE `id` = `id`' : '';
  return {
    sql: `INSERT INTO ${quote(table)} (${columns}) VALUES (${holders})${tail}`,
    params: entries.filter((e) => !e.raw).map((e) => e.value),
    columns: entries.map((e) => e.column),
  };
};

/**
 * @notice Build an UPDATE.
 * @dev Refreshes `updatedAt` when the table has one and the caller did not set
 * @dev it, reproducing Prisma's `@updatedAt`. Without it the write fails: the
 * @dev column is `NOT NULL` with no database default.
 * @dev When every filtered column is already set to its current value, MariaDB
 * @dev reports zero affected rows — the same signal Prisma's `count` gave, which
 * @dev the service layer relies on for its compare-and-set locks.
 * @param {string} table Physical table name.
 * @param {object} data Column/value pairs to set.
 * @param {object} [opts] Query options.
 * @param {object} [opts.where] Condition tree.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildUpdate = (table, data, opts = {}) => {
  const model = describe(table);
  const entries = prepareWrite(table, data);
  if (entries.length === 0) throw new TypeError(`Refusing to update "${table}" with no columns`);

  const assignments = entries.map((e) => `${quote(e.column)} = ?`);
  const params = entries.map((e) => e.value);
  if (model.hasUpdatedAt && !entries.some((e) => e.column === 'updatedAt')) {
    assignments.push(`${quote('updatedAt')} = CURRENT_TIMESTAMP(3)`);
  }

  const whereParams = [];
  const where = compileWhere(table, opts.where, whereParams);
  params.push(...whereParams);
  return {
    sql: `UPDATE ${quote(table)} SET ${assignments.join(', ')} ${where}`.trim(),
    params,
  };
};

/**
 * @notice Build an atomic increment.
 * @dev Used instead of `buildUpdate` for counters, so the new value is computed
 * @dev by the database (`col = col + ?`) and two concurrent callers cannot lose
 * @dev an increment to a read-modify-write race.
 * @param {string} table Physical table name.
 * @param {object} data `{ id, column: delta, ... }`.
 * @param {object} [opts] Options.
 * @param {object} [opts.where] Extra conditions, e.g. a cap to stay under.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildIncrement = (table, data, opts = {}) => {
  const model = describe(table);
  if (!model) throw new TypeError(`Unknown table "${table}"`);
  const { id, ...steps } = data || {};
  const assignments = Object.entries(steps).map(([column, delta]) => {
    if (model.typeOf(column) !== 'int') {
      throw new TypeError(`Cannot increment "${column}" on "${table}": not an integer column`);
    }
    if (delta === undefined) throw new TypeError(`No increment given for "${table}.${column}"`);
    return `${quote(column)} = ${quote(column)} + ?`;
  });
  if (assignments.length === 0) throw new TypeError(`increment on "${table}" needs at least one column`);

  const params = Object.values(steps).map(Number);
  const whereParams = [];
  // The row identity wins over anything in `where`: callers pass it separately so
  // it can never be shadowed by a condition meant to *narrow* the match.
  const where = compileWhere(table, { ...opts.where, id }, whereParams);
  params.push(...whereParams);
  return { sql: `UPDATE ${quote(table)} SET ${assignments.join(', ')} ${where}`.trim(), params };
};

/**
 * @notice Build a DELETE.
 * @param {string} table Physical table name.
 * @param {object} [opts] Query options.
 * @param {object} [opts.where] Condition tree.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildDelete = (table, opts = {}) => {
  const params = [];
  const where = compileWhere(table, opts.where, params);
  return { sql: `DELETE FROM ${quote(table)} ${where}`.trim(), params };
};

/**
 * @notice Aggregate functions available to `buildAggregate`.
 * @dev Deliberately explicit rather than interpolating the caller's string.
 */
const AGGREGATES = {
  count: (column) => (column === '*' ? 'COUNT(*)' : `COUNT(${quote(column)})`),
  avg: (column) => `AVG(${quote(column)})`,
  sum: (column) => `SUM(${quote(column)})`,
  min: (column) => `MIN(${quote(column)})`,
  max: (column) => `MAX(${quote(column)})`,
};

/**
 * @notice Build a grouped aggregate query.
 * @dev Used by the analytics and tool-stats routes, which replaced hardcoded
 * @dev benchmark numbers with real counts. `AVG` over an empty group returns
 * @dev `NULL` and is reported as `null`, never as `0` — a tool that was never
 * @dev called has no latency, which is not the same as being instantaneous.
 * @param {string} table Physical table name.
 * @param {object} opts Query options.
 * @param {Array<string>} [opts.groupBy] Grouping columns.
 * @param {Array<object>} [opts.aggregates] `{ fn, column, alias }` triples.
 * @param {object} [opts.where] Condition tree.
 * @param {Array<object>} [opts.orderBy] Ordering over the output aliases.
 * @param {number} [opts.limit] Row cap.
 * @return {{sql: string, params: Array}} Statement and parameters.
 */
const buildAggregate = (table, opts = {}) => {
  const { groupBy = [], aggregates = [], where, orderBy, limit } = opts;
  const params = [];
  const selects = [];

  for (const column of groupBy) {
    selects.push(quote(column));
  }
  for (const agg of aggregates) {
    const fn = AGGREGATES[agg.fn];
    if (!fn) throw new TypeError(`Unsupported aggregate "${agg.fn}"`);
    selects.push(`${fn(agg.column)} AS ${quote(agg.alias || `${agg.fn}_${agg.column}`)}`);
  }
  if (selects.length === 0) throw new TypeError('buildAggregate needs a groupBy or an aggregate');

  const whereClause = compileWhere(table, where, params);
  const orderClause = compileOrderByOnAliases(orderBy);
  const bounded = Number.isInteger(limit) && limit >= 0 ? ` LIMIT ${limit}` : '';

  const sql = [
    `SELECT ${selects.join(', ')}`,
    `FROM ${quote(table)}`,
    whereClause,
    groupBy.length ? `GROUP BY ${groupBy.map(quote).join(', ')}` : '',
    orderClause,
  ].filter(Boolean).join(' ');
  return { sql: `${sql}${bounded}`, params };
};

/**
 * @notice Compile `orderBy` for an aggregate query.
 * @dev Aggregate output is addressed by its alias, not by a base column, so
 * @dev `tool.service.js` can rank by `COUNT(*) DESC` without a subquery.
 * @dev `nullsLast` keeps uncalled tools below active ones when ranking by
 * @dev average latency.
 * @param {Array<object>} [orderBy] Ordering descriptors.
 * @return {string} `ORDER BY ...` clause, or an empty string.
 */
const compileOrderByOnAliases = (orderBy) => {
  if (!orderBy) return '';
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = list.map((entry) => {
    const [alias, options = {}] = Object.entries(entry)[0] || [];
    if (!alias) return null;
    const dir = String(options.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const nulls = options.nullsLast ? ' NULLS LAST' : '';
    return `${quote(alias)} ${dir}${nulls}`;
  }).filter(Boolean);
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
};

module.exports = {
  buildAggregate,
  buildCount,
  buildDelete,
  buildIncrement,
  buildInsert,
  buildSelect,
  buildUpdate,
  compileExpression,
  compileWhere,
  escapeLike,
};