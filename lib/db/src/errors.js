/**
 * @title Database error classification
 * @notice Turns a raw driver error into a stable, app-meaningful `code`.
 * @dev Prisma reported integrity violations as opaque `P2002`/`P2003`/`P2025`
 * @dev codes. The MySQL driver reports MySQL error *numbers* instead, which
 * @dev means two things had to be rebuilt by hand: this classifier, and every
 * @dev `err.code === 'P2002'` branch in the services.
 * @dev The codes here are stable and transport-independent. They must never be
 * @dev surfaced to a client as text — `errorHandler.js` only echoes `ApiError`
 * @dev messages, so the SQL, table and column names carried by the driver error
 * @dev stay in the server log where they belong.
 */

/** @notice Database error codes the app branches on. @dev */
const DB_ERROR = {
  /** @dev UNIQUE constraint violated — the duplicate-username/number races. */
  DUPLICATE: 'DB_DUPLICATE',
  /** @dev FOREIGN KEY violated in either direction. */
  FOREIGN_KEY: 'DB_FOREIGN_KEY',
  /** @dev A `checks.sql` CHECK constraint rejected the row. */
  CHECK: 'DB_CHECK',
  /** @dev NULL / range / length / truncation: the value itself was unacceptable. */
  VALUE: 'DB_VALUE',
  /** @dev A column or table does not exist — a deployment that skipped a migration. */
  SCHEMA: 'DB_SCHEMA',
  /** @dev Cannot reach the server, or the pool is exhausted. */
  UNAVAILABLE: 'DB_UNAVAILABLE',
  /** @dev Anything else. Treated as a server fault. */
  INTERNAL: 'DB_INTERNAL',
};

/**
 * @notice MariaDB/MySQL error numbers, mapped to our codes.
 * @dev Numbers, not messages: the text is localised and version-dependent, the
 * @dev number is not.
 */
const ERRNO = {
  1022: DB_ERROR.DUPLICATE, // ER_DUP_KEY
  1048: DB_ERROR.VALUE, // ER_BAD_NULL_ERROR
  1049: DB_ERROR.SCHEMA, // ER_BAD_DB_ERROR
  1050: DB_ERROR.SCHEMA, // ER_TABLE_EXISTS_ERROR
  1051: DB_ERROR.SCHEMA, // ER_BAD_TABLE_ERROR
  1052: DB_ERROR.VALUE, // ER_NON_UNIQ_ERROR
  1054: DB_ERROR.SCHEMA, // ER_BAD_FIELD_ERROR
  1060: DB_ERROR.VALUE, // ER_DUP_FIELDNAME
  1061: DB_ERROR.VALUE, // ER_DUP_KEYNAME
  1062: DB_ERROR.DUPLICATE, // ER_DUP_ENTRY
  1064: DB_ERROR.INTERNAL, // ER_PARSE_ERROR
  1146: DB_ERROR.SCHEMA, // ER_NO_SUCH_TABLE
  1152: DB_ERROR.VALUE, // ER_WRONG_OUTER_JOIN
  1264: DB_ERROR.VALUE, // ER_WARN_DATA_OUT_OF_RANGE
  1265: DB_ERROR.VALUE, // ER_WARN_DATA_OUT_OF_RANGE (truncated)
  1364: DB_ERROR.VALUE, // ER_NO_DEFAULT_FOR_FIELD
  1366: DB_ERROR.VALUE, // ER_TRUNCATED_WRONG_VALUE
  1406: DB_ERROR.VALUE, // ER_DATA_TOO_LONG
  1451: DB_ERROR.FOREIGN_KEY, // ER_ROW_IS_REFERENCED_2
  1452: DB_ERROR.FOREIGN_KEY, // ER_NO_REFERENCED_ROW_2
  3819: DB_ERROR.CHECK, // ER_CHECK_CONSTRAINT_VIOLATED (MySQL 8)
  4025: DB_ERROR.CHECK, // ER_CONSTRAINT_FAILED (MariaDB 11 — checks.sql constraints)
};

/**
 * @notice Node/socket-level codes that mean "the database is not reachable".
 * @dev Without these an unreachable database surfaced as a 500 and, because the
 * @dev driver does not distinguish them, looked like a bug in the request path.
 */
const UNAVAILABLE_SYSCALL = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EPROTO',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
]);

/**
 * @notice An error raised by the data layer, already classified.
 * @dev `cause` keeps the driver error for the log line. The class exists so the
 * @dev error handler can recognise a database fault without string matching.
 */
class QueryError extends Error {
  /**
   * @param {string} code One of `DB_ERROR`.
   * @param {string} message Operator-facing description (never client-facing).
   * @param {Error} [cause] Original driver error.
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'QueryError';
    this.code = code;
    if (cause) {
      this.cause = cause;
      this.errno = cause.errno;
      this.sqlState = cause.sqlState;
    }
  }
}

/**
 * @notice Classify a driver error into a `DB_ERROR` code.
 * @dev Connection exhaustion (`ER_CON_COUNT_ERROR`) is treated as unavailable:
 * @dev it is transient and self-healing once the pool drains, and reporting it
 * @dev as a 500 would page the on-call for a capacity problem.
 * @param {Error} err Raw error from mysql2 / Node sockets.
 * @return {string} One of `DB_ERROR`.
 */
const classify = (err) => {
  if (!err) return DB_ERROR.INTERNAL;
  if (err.code === 'DB_UNAVAILABLE') return DB_ERROR.UNAVAILABLE;
  if (err.code === 'ER_CON_COUNT_ERROR') return DB_ERROR.UNAVAILABLE;
  if (UNAVAILABLE_SYSCALL.has(err.code)) return DB_ERROR.UNAVAILABLE;
  if (typeof err.errno === 'number' && ERRNO[err.errno]) return ERRNO[err.errno];
  return DB_ERROR.INTERNAL;
};

/**
 * @notice Wrap a driver error as a classified `QueryError`, or pass it through.
 * @dev Anything already carrying one of our codes is returned untouched so a
 * @dev nested wrap cannot downgrade a specific verdict to `INTERNAL`.
 * @param {Error} err Raw driver error.
 * @return {QueryError} Classified error, safe to throw.
 */
const wrap = (err) => {
  if (err instanceof QueryError) return err;
  return new QueryError(classify(err), err?.message || 'Database query failed', err);
};

module.exports = { DB_ERROR, QueryError, classify, wrap };