/**
 * @title MariaDB connection pool
 * @notice The one place the process opens a database connection.
 * @dev Replaces the Prisma client singleton. Two properties of that singleton
 * @dev are preserved deliberately, because losing either one breaks a real
 * @dev failure mode rather than a hypothetical one:
 * @dev  1. The pool is memoised on `globalThis`, so `node --watch` reload does
 * @dev     not stack a new pool on every file save until MariaDB refuses new
 * @dev     connections with "too many clients".
 * @dev  2. Nothing connects at require time. Requiring this module must stay
 * @dev free of I/O, because `config/db.js` loads it eagerly on first use and
 * @dev the degraded-mode CI checks boot the server with no database at all.
 */
const { DB_ERROR, QueryError, wrap } = require('./errors');

/** @notice Defaults, overridable per environment. @dev */
const DEFAULTS = {
  connectionLimit: 10,
  connectTimeoutMs: 10_000,
  queueTimeoutMs: 20_000,
};

/**
 * @notice Read a URL query parameter as a positive integer.
 * @dev The connection string carries `connection_limit`, `pool_timeout` and
 * @dev `connect_timeout` because `ecosystem.config.js` sized Prisma's pool
 * @dev through them. Honouring them keeps that budget in force during the
 * @dev rollout instead of silently widening the pool to the driver default.
 * @param {URL} url Parsed connection string.
 * @param {string} name Parameter name.
 * @param {number} fallback Used when absent or unparseable.
 * @return {number} Resolved value.
 */
const numericParam = (url, name, fallback) => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/**
 * @notice Translate `DATABASE_URL` into mysql2 pool options.
 * @dev `timezone: 'Z'` is load-bearing. The columns are `datetime(3)` with no
 * @dev zone, Prisma always wrote UTC, and the driver defaults to the server's
 * @dev local zone — which would silently shift every timestamp, and with it the
 * @dev analytics day buckets, by the container's UTC offset.
 * @dev `multipleStatements` stays off: runtime queries are single statements
 * @dev and stacking them would turn any injection point into a data leak. Only
 * @dev the migration runner opens a connection with it enabled.
 * @param {string} url `mysql://user:password@host:port/database`.
 * @param {object} env Environment to read overrides from.
 * @return {object} Options for `mysql2.createPool`.
 * @throws {TypeError} When the URL cannot be parsed.
 */
const poolOptions = (url, env = process.env) => {
  const parsed = new URL(url);
  if (!parsed.hostname) throw new TypeError('DATABASE_URL has no host');

  /**
   * @dev Resolve one millisecond-valued timeout: an explicit environment
   * @dev override wins, then a query-string parameter (which the previous ORM
   * @dev read and the driver ignored), then the default.
   * @param {string} name Environment variable, in milliseconds.
   * @param {string} param Query-string parameter, in *seconds*.
   * @param {number} fallbackMs Default, in milliseconds.
   * @return {number} Milliseconds.
   */
  const timeoutMs = (name, param, fallbackMs) => {
    const explicit = Number.parseInt(env[name] || '', 10);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return numericParam(parsed, param, Math.round(fallbackMs / 1000)) * 1000;
  };

  const connectionLimit = Number.parseInt(env.DB_POOL_SIZE || '', 10)
    || numericParam(parsed, 'connection_limit', DEFAULTS.connectionLimit);
  const connectTimeout = timeoutMs('DB_CONNECT_TIMEOUT_MS', 'connect_timeout', DEFAULTS.connectTimeoutMs);
  const queueTimeout = timeoutMs('DB_POOL_QUEUE_TIMEOUT_MS', 'pool_timeout', DEFAULTS.queueTimeoutMs);

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : undefined,
    waitForConnections: true,
    connectionLimit,
    connectTimeout,
    queueLimit: 0,
    // Applied per acquisition in `connection()`; recorded here so `server.js`
    // can log the effective budget alongside the instance count.
    kosplyQueueTimeoutMs: queueTimeout,
    timezone: 'Z',
    dateStrings: false,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: 'utf8mb4',
    namedPlaceholders: false,
    multipleStatements: false,
    enableKeepAlive: true,
    // Report rows *matched*, not rows *changed*. MariaDB counts an UPDATE that
    // writes identical values as zero affected rows, which would make the
    // compare-and-set locks in product.service.js and password.service.js report
    // a lost race for a write that actually succeeded.
    flags: '+FOUND_ROWS',
  };
};

/**
 * @notice Memoisation slot on `globalThis`.
 * @dev Named for the pool, not the driver, so an old `globalThis.__kosplyPrisma`
 * @dev left behind by a running process is never picked up.
 */
const GLOBAL_KEY = '__kosplyPool';

/**
 * @notice Create the pool. Does not connect.
 * @dev Required lazily so importing this module never opens a socket; see the
 * @dev file header.
 * @param {string} url Connection string.
 * @param {object} [env] Environment for overrides.
 * @return {object} A mysql2 pool.
 */
const createPool = (url, env) => {
  const mysql = require('mysql2/promise');
  const { kosplyQueueTimeoutMs, ...options } = poolOptions(url, env);
  const pool = mysql.createPool(options);
  // Kept on the pool, not in the driver options: the driver validates every key
  // it is handed and rejects unknown ones in future versions.
  pool.kosplyQueueTimeoutMs = kosplyQueueTimeoutMs;
  return pool;
};

/**
 * @notice The underlying socket of a checked-out connection, when there is one.
 * @dev Reached through the promise wrapper (`connection.connection`) to the core
 * @dev connection's socket. Returns null for anything that is not a live socket,
 * @dev so the ref/unref pair below can be applied unconditionally.
 * @param {object} connection A mysql2 promise connection.
 * @return {object|null} The socket.
 */
const socketOf = (connection) => {
  const stream = connection?.connection?.stream;
  return stream && typeof stream.ref === 'function' ? stream : null;
};

/**
 * @notice Mark a connection as in use, so the socket keeps the process alive.
 * @dev An idle pooled connection is `unref`ed, which means it does not stop the
 * @dev event loop from draining. Without this the test suite and one-shot
 * @dev scripts hung forever after finishing, because a pool socket is a live
 * @dev handle; `server.js` could still have shut down, but a script with no
 * @dev HTTP listener had nothing left to drain and simply never exited.
 * @dev The socket is re-referenced for the whole time a caller holds the
 * @dev connection, so a query is never abandoned mid-flight.
 * @param {object} connection A mysql2 promise connection.
 * @return {object} The same connection, for chaining.
 */
const hold = (connection) => {
  socketOf(connection)?.ref();
  return connection;
};

/**
 * @notice Return a connection to the pool and stop holding the process open.
 * @dev Unref before releasing: from this moment the socket is idle, and the
 * @dev pool may hand it to the next request.
 * @param {object} connection A mysql2 promise connection.
 * @return {void}
 */
const release = (connection) => {
  socketOf(connection)?.unref();
  connection.release();
};

/**
 * @notice Borrow a connection, failing fast instead of queueing forever.
 * @dev `waitForConnections` alone would let a request block indefinitely behind
 * @dev a saturated pool, turning a capacity problem into hung sockets. When the
 * @dev deadline passes we report `DB_UNAVAILABLE` (a 503 the client can retry)
 * @dev and destroy the connection if it lands late — without that cleanup the
 * @dev abandoned callback would receive a connection nobody returns, and the
 * @dev leak would starve the pool permanently.
 * @param {object} pool A mysql2 pool.
 * @return {Promise<object>} A checked-out connection; release it when done.
 * @throws {QueryError} `DB_UNAVAILABLE` when the pool stays saturated.
 */
const checkout = (pool) => {
  const pending = pool.getConnection();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new QueryError(DB_ERROR.UNAVAILABLE, 'No database connection available within the pool deadline')),
      pool.kosplyQueueTimeoutMs || DEFAULTS.queueTimeoutMs
    );
  });
  return Promise.race([pending, deadline]).then(
    (connection) => {
      clearTimeout(timer);
      return hold(connection);
    },
    (err) => {
      clearTimeout(timer);
      pending.then((late) => late.destroy(), () => {});
      throw wrap(err);
    }
  );
};

/**
 * @notice Get the process-wide pool, creating it on first use.
 * @param {string} url Connection string. Required on the first call.
 * @return {object} The shared pool.
 */
const getPool = (url) => {
  if (!globalThis[GLOBAL_KEY]) {
    if (!url) throw new TypeError('DATABASE_URL is required to create the pool');
    globalThis[GLOBAL_KEY] = createPool(url);
  }
  return globalThis[GLOBAL_KEY];
};

/**
 * @notice Close the pool.
 * @dev Safe to call when no pool was ever created, because `server.js` runs it
 * @dev from the shutdown path even on a boot that never touched the database.
 * @return {Promise<void>} Resolves once every connection is closed.
 */
const closePool = async () => {
  const pool = globalThis[GLOBAL_KEY];
  if (!pool) return;
  delete globalThis[GLOBAL_KEY];
  await pool.end();
};

module.exports = {
  DEFAULTS,
  checkout,
  closePool,
  createPool,
  getPool,
  hold,
  poolOptions,
  release,
  GLOBAL_KEY,
};