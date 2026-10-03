/**
 * @title Lazy Prisma access
 * @notice Single gateway from `lib/server` to the `lib/db` Prisma client.
 * @dev Never crashes boot: a missing client or `DATABASE_URL` resolves to
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
 * @notice Get the Prisma client, or `null` when the DB layer is unavailable.
 * @dev A *missing configuration* (`DATABASE_URL` unset) latches permanently.
 * @dev A *load failure* is retried, because the previous write-once `tried`
 * @dev flag meant one transient error (an `npm ci` replacing
 * @dev `lib/db/node_modules` under a live process, or EAGAIN under memory
 * @dev pressure) turned every DB route into a silent 503 for the process
 * @dev lifetime. Failures are now logged instead of discarded.
 * @return {import('@prisma/client').PrismaClient|null} Cached client or null.
 */
const getPrisma = () => {
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
    cached = require('../../db/src/client');
    attempts = 0;
    return cached;
  } catch (err) {
    const missing = err?.code === 'MODULE_NOT_FOUND';
    console.error(`[db] client unavailable (${err?.message || err}). Run "npm install" in lib/db.`);
    // A genuinely absent module will not fix itself, so stop retrying it.
    if (missing) disabledReason = 'Prisma client is not installed';
    return null;
  }
};

/**
 * @notice Is the Prisma client currently unusable, and why?
 * @return {boolean} True when `requireDb()` would throw.
 */
const isUnavailable = () => getPrisma() === null;

/**
 * @notice Get the Prisma client or throw a catalog error.
 * @return {import('@prisma/client').PrismaClient} Ready client.
 * @throws {import('../middlewares/errorCatalog').ApiError} `DB_UNAVAILABLE` when down.
 */
const requireDb = () => {
  const { throwError } = require('../middlewares/errorCatalog');
  const prisma = getPrisma();
  if (!prisma) throwError('DB_UNAVAILABLE');
  return prisma;
};

module.exports = { getPrisma, requireDb, isUnavailable };
