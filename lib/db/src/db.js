/**
 * @title Query runner
 * @notice Executes the statements `sql.js` builds and returns cast rows.
 * @dev Two execution contexts share one implementation: the pool (one
 * @dev short-lived connection per statement) and a transaction (one connection
 * @dev held for the duration). The transactional runner is built from the same
 * @dev factory, so a query cannot behave differently inside or outside a
 * @dev transaction — a class of bug that is invisible until data is half-written.
 * @dev Writes never use `RETURNING`: MariaDB does not support it (MySQL 8 does,
 * @dev MariaDB deliberately did not follow). A write that needs the stored row
 * @dev re-reads it by primary key, which is also what makes the value it returns
 * @dev the one the database actually persisted, rather than the one that was sent.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const { checkout, closePool, getPool, release } = require('./pool');
const { wrap, QueryError, DB_ERROR } = require('./errors');
const { castRow } = require('./cast');
const { describe } = require('./schema');
const { cuid2 } = require('./ids');
const {
  buildAggregate,
  buildCount,
  buildDelete,
  buildIncrement,
  buildInsert,
  buildSelect,
  buildUpdate,
} = require('./sql');

/**
 * @notice Create the statement set for one execution context.
 * @dev Every driver call is wrapped in `wrap()`, so a raw `ER_*` number never
 * @dev escapes this module: callers only ever see a classified `QueryError`.
 * @param {object} conn A mysql2 connection or pool.
 * @return {object} Statement helpers bound to that connection.
 */
const runner = (conn) => {
  /**
   * @notice Run a statement and return its rows.
   * @param {string} sql Parameterised SQL.
   * @param {Array} params Bound parameters.
   * @return {Promise<Array<object>>} Result rows.
   */
  const rows = async (sql, params) => {
    try {
      const [result] = await conn.query(sql, params);
      return Array.isArray(result) ? result : [];
    } catch (err) {
      throw wrap(err);
    }
  };

  /**
   * @notice Run a write and return the driver result object.
   * @param {string} sql Parameterised SQL.
   * @param {Array} params Bound parameters.
   * @return {Promise<object>} `OkPacket` with `affectedRows`.
   */
  const write = async (sql, params) => {
    try {
      const [result] = await conn.query(sql, params);
      return result || {};
    } catch (err) {
      throw wrap(err);
    }
  };

  return {
    /**
     * @notice Run a hand-written SELECT and return raw, uncast rows.
     * @dev Reserved for the few shapes the builder does not express, such as the
     * @dev per-parent window function in `repo/relations.js`. It runs on the
     * @dev ambient connection, so it participates in an open transaction exactly
     * @dev like every other statement here.
     * @dev Rows are *not* cast — the caller owns the shape and must coerce any
     * @dev JSON or boolean column it selected.
     * @param {string} sql Parameterised SQL.
     * @param {Array} [params] Bound parameters.
     * @return {Promise<Array<object>>} Raw rows.
     */
    async selectRaw(sql, params = []) {
      return rows(sql, params);
    },

    /**
     * @notice Read many rows.
     * @param {string} table Physical table name.
     * @param {object} [opts] See `sql.buildSelect`.
     * @return {Promise<Array<object>>} Cast rows.
     */
    async selectMany(table, opts = {}) {
      const { sql, params } = buildSelect(table, opts);
      return (await rows(sql, params)).map((row) => castRow(table, row));
    },

    /**
     * @notice Read at most one row.
     * @dev Prisma's `findUnique`/`findFirst` behaved identically — both returned
     * @dev `null` when nothing matched — so one method covers both.
     * @param {string} table Physical table name.
     * @param {object} [opts] See `sql.buildSelect`.
     * @return {Promise<object|null>} Cast row, or null.
     */
    async selectOne(table, opts = {}) {
      const { sql, params } = buildSelect(table, { ...opts, limit: opts.limit ?? 1 });
      const found = await rows(sql, params);
      return found.length ? castRow(table, found[0]) : null;
    },

    /**
     * @notice Count rows matching a condition.
     * @param {string} table Physical table name.
     * @param {object} [opts] Query options.
     * @return {Promise<number>} Row count.
     */
    async count(table, opts = {}) {
      const { sql, params } = buildCount(table, opts);
      const found = await rows(sql, params);
      return found.length ? Number(found[0].count) : 0;
    },

    /**
     * @notice Run a grouped or ungrouped aggregate.
     * @param {string} table Physical table name.
     * @param {object} opts See `sql.buildAggregate`.
     * @return {Promise<Array<object>>} Rows of `{ group, alias }` pairs.
     */
    async aggregate(table, opts) {
      const { sql, params } = buildAggregate(table, opts);
      return rows(sql, params);
    },

    /**
     * @notice Insert one row and return it as stored.
     * @dev The row is re-read by its primary key, which is how the caller gets
     * @dev back the values the database actually applied — the `createdAt` and
     * @dev `updatedAt` defaults, and any coercion the column type imposed —
     * @dev rather than the ones that were sent.
     * @dev Most tables key on `id`; `notification_preferences` has a composite
     * @dev `(userId, key)` primary key and no surrogate id, so the registry
     * @dev declares it rather than this guessing from the first column.
     * @param {string} table Physical table name.
     * @param {object} data Column/value pairs.
     * @return {Promise<object>} The inserted row.
     */
    async insert(table, data) {
      const built = buildInsert(table, data);
      await write(built.sql, built.params);
      const { primaryKey } = describe(table);
      const written = new Map(built.columns.map((column, i) => [column, built.params[i]]));
      const where = {};
      for (const column of primaryKey) {
        // A generated key was added by the builder, so it is present in `written`.
        where[column] = data[column] !== undefined ? data[column] : written.get(column);
      }
      return this.selectOne(table, { where });
    },

    /**
     * @notice Insert only when the row is absent, then return the stored row.
     * @dev Replaces Prisma's `upsert` for the shapes this app uses. The
     * @dev no-op `ON DUPLICATE KEY UPDATE` makes a concurrent second inserter
     * @dev succeed rather than raise a duplicate-key error, which is what
     * @dev Prisma's upsert guaranteed too.
     * @dev `update` is applied when the row already exists; pass `{}` for the
     * @dev "create if missing, otherwise leave alone" behaviour.
     * @param {string} table Physical table name.
     * @param {object} data Values used when inserting.
     * @param {object} [opts] Upsert options.
     * @param {object} [opts.where] Natural key to match on.
     * @param {object} [opts.update] Values to apply when the row already exists.
     * @param {Array<string>} [opts.columns] Columns to return, instead of the
     *   whole row. `chat.open` needs only the id and would otherwise hydrate the
     *   room twice over on every call.
     * @return {Promise<object>} The stored row.
     */
    async upsert(table, data, opts = {}) {
      const { where, update: patch, columns } = opts;
      const patchRow = patch && Object.keys(patch).length > 0 ? patch : null;
      const reapply = async () => {
        if (patchRow) await this.updateMany(table, patchRow, { where });
        return this.selectOne(table, { where, ...(columns && { columns }) });
      };
      const existing = await this.selectOne(table, { where });
      if (existing) return patchRow ? reapply() : this.selectOne(table, { where, ...(columns && { columns }) });
      try {
        return await this.insert(table, data);
      } catch (err) {
        // Lost the race against a concurrent insert: the row now exists, so
        // re-read it and apply the update instead of failing the request.
        if (err instanceof QueryError && err.code === DB_ERROR.DUPLICATE) return reapply();
        throw err;
      }
    },

    /**
     * @notice Update one row and return it as stored.
     * @param {string} table Physical table name.
     * @param {object} data Column/value pairs to set.
     * @param {object} opts Options.
     * @param {object} opts.where Condition identifying the row.
     * @return {Promise<object|null>} The stored row, or null when nothing matched.
     */
    async update(table, data, opts = {}) {
      const built = buildUpdate(table, data, opts);
      await write(built.sql, built.params);
      return this.selectOne(table, opts);
    },

    /**
     * @notice Update every matching row.
     * @dev Returns the number of rows *matched*, not the number whose values
     * @dev actually changed — the connection sets `FOUND_ROWS`, because MariaDB
     * @dev otherwise reports zero for an update that writes identical values.
     * @dev That distinction is load-bearing: `product.service.js` and
     * @dev `password.service.js` use this count as a compare-and-set lock, and a
     * @dev "changed nothing" update there must still count as a win.
     * @param {string} table Physical table name.
     * @param {object} data Column/value pairs to set.
     * @param {object} [opts] Query options.
     * @param {object} [opts.where] Condition.
     * @return {Promise<number>} Rows matched.
     */
    async updateMany(table, data, opts = {}) {
      const built = buildUpdate(table, data, opts);
      const result = await write(built.sql, built.params);
      return result.affectedRows ?? 0;
    },

    /**
     * @notice Increment a numeric column atomically.
     * @dev An explicit `SET col = col + ?` rather than a read-modify-write, so two
     * @dev concurrent calls cannot lose a count. Replaces Prisma's
     * @dev `{ increment: n }` data operator.
     * @dev `opts.where` narrows the match, which is how a counter stays under a
     * @dev cap: the reset ticket increments only while `attempts < MAX_ATTEMPTS`.
     * @param {string} table Physical table name.
     * @param {object} data `{ id, column: delta, ... }`.
     * @param {object} [opts] Options.
     * @param {object} [opts.where] Extra conditions.
     * @return {Promise<number>} Rows matched.
     */
    async increment(table, data, opts = {}) {
      const built = buildIncrement(table, data, opts);
      const result = await write(built.sql, built.params);
      return result.affectedRows ?? 0;
    },

    /**
     * @notice Delete every matching row.
     * @param {string} table Physical table name.
     * @param {object} [opts] Query options.
     * @param {object} [opts.where] Condition.
     * @return {Promise<number>} Rows deleted.
     */
    async remove(table, opts = {}) {
      const built = buildDelete(table, opts);
      const result = await write(built.sql, built.params);
      return result.affectedRows ?? 0;
    },
  };
};

/**
 * @notice Resolve the pool, creating it on first use.
 * @param {string} [url] Connection string.
 * @return {object} The pool.
 */
const pool = (url) => getPool(url || process.env.DATABASE_URL);

/**
 * @notice Run a statement on a pooled connection, releasing it afterwards.
 * @dev Returns the driver's `[rows, fields]` tuple unchanged, so this is a
 * @dev drop-in stand-in for `connection.query` and `runner()` treats a pooled
 * @dev statement and a transactional one identically.
 * @param {string} sql Parameterised SQL.
 * @param {Array} params Bound parameters.
 * @return {Promise<Array>} The driver's result tuple.
 */
const onPooledConnection = async (sql, params) => {
  const connection = await checkout(pool());
  try {
    return await connection.query(sql, params);
  } finally {
    release(connection);
  }
};

/**
 * @dev Holds the runner bound to the in-flight transaction of the *current
 * @dev async context*. An `AsyncLocalStorage` rather than a module-level
 * @dev variable: two requests handled at the same time each open their own
 * @dev transaction, and a shared slot would silently merge them — so one
 * @dev request's rollback would discard the other's committed writes.
 */
const ALS = new AsyncLocalStorage();

/**
 * @notice The runner for the ambient transaction, if this code is inside one.
 * @return {object|null} Transaction-scoped runner, or null.
 */
const ambient = () => ALS.getStore() || null;

/**
 * @notice The runner a statement should use right now.
 * @dev Prefers the ambient transaction. Without this a `db.selectOne()` called
 * @dev from inside a transaction would borrow a *different* pooled connection,
 * @dev read outside the transaction, and never see the writes it just made —
 * @dev the kind of bug that only appears under concurrency.
 * @return {object} Runner for the current context.
 */
const current = () => ambient() || runner({ query: onPooledConnection });

/**
 * @notice Pool-backed statement set, and the default used everywhere outside a
 * @dev transaction.
 * @return {object} Runner whose statements each borrow a connection.
 */
const db = {
  selectRaw: (sql, params) => current().selectRaw(sql, params),
  selectMany: (table, opts) => current().selectMany(table, opts),
  selectOne: (table, opts) => current().selectOne(table, opts),
  count: (table, opts) => current().count(table, opts),
  aggregate: (table, opts) => current().aggregate(table, opts),
  insert: (table, data) => current().insert(table, data),
  upsert: (table, data, opts) => current().upsert(table, data, opts),
  update: (table, data, opts) => current().update(table, data, opts),
  updateMany: (table, data, opts) => current().updateMany(table, data, opts),
  increment: (table, data, opts) => current().increment(table, data, opts),
  remove: (table, opts) => current().remove(table, opts),

  /**
   * @notice Run `fn` inside a transaction, committing or rolling back with it.
   * @dev Replaces Prisma's interactive `$transaction`. Every statement issued
   * @dev through the module-level `db` helpers while `fn` runs is bound to the
   * @dev transaction's connection, so a read observes the writes made before it
   * @dev in the same unit of work.
   * @dev A throw from the callback rolls back and propagates, which is how
   * @dev `password.service.js` abandons a consumed reset: it raises inside the
   * @dev transaction precisely so the claim is undone.
   * @dev Nested calls join the outer transaction rather than opening a second
   * @dev connection, which would deadlock against the row it is waiting on.
   * @param {(tx: object) => Promise<*>} fn Work to run.
   * @return {Promise<*>} Whatever `fn` resolves to.
   */
  async transaction(fn) {
    const active = ambient();
    if (active) return fn(active);

    const connection = await checkout(pool());
    const scoped = runner(connection);
    try {
      await connection.query('START TRANSACTION');
      const result = await ALS.run(scoped, () => fn(scoped));
      await connection.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        // The connection is already broken (server restart, killed socket).
        // Destroying it is the only safe move; reporting the original error is
        // more useful than reporting that the rollback failed.
        connection.destroy();
      }
      throw wrap(err);
    } finally {
      release(connection);
    }
  },

  /** @notice Close the pool. Safe when no pool was ever created. */
  async close() {
    return closePool();
  },
};

module.exports = db;
module.exports.ambient = ambient;
module.exports.runner = runner;