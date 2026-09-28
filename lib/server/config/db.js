/**
 * @title Lazy Prisma access
 * @notice Single gateway from `lib/server` to the `lib/db` Prisma client.
 * @dev Never crashes boot: missing client or `DATABASE_URL` resolves to
 * @dev `null`, and `requireDb()` converts that into a catalog `DB_UNAVAILABLE`
 * @dev error so CI smoke tests (no DB) and degraded deploys keep serving.
 */
let cached = null;
let tried = false;

/**
 * @notice Get the Prisma client, or `null` when the DB layer is unavailable.
 * @return {import('@prisma/client').PrismaClient|null} Cached client or null.
 */
const getPrisma = () => {
  if (tried) return cached;
  tried = true;
  try {
    const env = require('./env');
    if (!env.databaseUrl) {
      cached = null;
      return cached;
    }
    cached = require('../../db/src/client');
  } catch {
    cached = null;
  }
  return cached;
};

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

module.exports = { getPrisma, requireDb };
