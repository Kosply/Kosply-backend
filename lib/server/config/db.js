/**
 * @title Lazy database access
 * @notice Single gateway from `lib/server` to the `lib/db` data layer.
 * @dev Never crashes boot: a missing driver or `DATABASE_URL` resolves to
 * @dev `null`, and `requireDb()` converts that into a catalog
 * @dev `DB_UNAVAILABLE` error so CI smoke tests (no DB) keep serving.
 */
let cached = null;
let disabledReason = null;
let lastAttempt = 0;
let attempts = 0;

/** @dev Retry a failed load after this long instead of latching forever. */
const RETRY_AFTER_MS = 5000;

/**
 * @notice Get the data layer, or `null` when it is unavailable.
 * @dev A *missing configuration* (`DATABASE_URL` unset) latches permanently.
 * @dev A *load failure* is retried, because a write-once `tried` flag meant one
 * @dev transient error (an `npm ci` replacing `lib/db/node_modules` under a live
 * @dev process, or EAGAIN under memory pressure) turned every DB route into a
 * @dev silent 503 for the process lifetime. Failures are logged, not discarded.
 * @return {object|null} Cached data layer, or null.
 */
const getDb = () => {
  if (cached) return cached;
  if (disabledReason) return null;
  if (attempts > 0 && Date.now() - lastAttempt < RETRY_AFTER_MS) return null;

  lastAttempt = Date.now();
  attempts += 1;
  try {
    const env = require('./env');
    if (!env.databaseUrl) {
      disabledReason = 'DATABASE_URL is not set';
      return null;
    }
    // The driver is required inside the data layer, not here, so a missing
    // `mysql2` surfaces as a load failure this function already handles.
    cached = require('../../db/src/db');
    attempts = 0;
    return cached;
  } catch (err) {
    const missing = err?.code === 'MODULE_NOT_FOUND';
    console.error(`[db] data layer unavailable (${err?.message || err}). Run "npm install" in lib/db.`);
    // A genuinely absent module will not fix itself, so stop retrying it.
    if (missing) disabledReason = 'Database driver is not installed';
    return null;
  }
};

/**
 * @notice Is the data layer currently unusable?
 * @return {boolean} True when `requireDb()` would throw.
 */
const isUnavailable = () => getDb() === null;

/**
 * @notice Get the data layer or throw a catalog error.
 * @return {object} Ready data layer.
 * @throws {import('../middlewares/errorCatalog').ApiError} `DB_UNAVAILABLE` when down.
 */
const requireDb = () => {
  const { throwError } = require('../middlewares/errorCatalog');
  const db = getDb();
  if (!db) throwError('DB_UNAVAILABLE');
  return db;
};

module.exports = { getDb, requireDb, isUnavailable };