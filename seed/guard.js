/**
 * @title Dev-database guard for the demo seed scripts
 * @notice Refuses to write fixtures into anything that is not an explicit
 * @notice development/test database.
 * @dev Mirrors the guard in `lib/db/schema/seed.js`. That file is a
 * @dev self-running Prisma seed (`run()` executes on import), so its guard
 * @dev cannot be required without also firing the whole seed — this module
 * @dev keeps the same contract as a standalone, importable check.
 */

/** @dev Only these database names may be seeded. */
const ALLOWED_DATABASES = ['kosply_dev', 'kosply_test', 'test'];

/**
 * @notice Refuse to seed anything that is not obviously a dev database.
 * @dev `NODE_ENV=production` is the hard gate: no override flag bypasses it,
 * @dev so a stray env var in a deploy script cannot publish fixtures into
 * @dev production. Staging is a real deploy holding real data and is refused by
 * @dev the allow-list (it is not in ALLOWED_DATABASES).
 * @return {string} The database name that will be seeded.
 * @throws {Error} When DATABASE_URL is unusable or the target looks production-like.
 */
const assertDevDatabase = () => {
  const url = process.env.DATABASE_URL || '';
  let name = '';
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is missing or unparseable; refusing to seed');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed with NODE_ENV=production');
  }
  if (process.env.ALLOW_PRODUCTION_SEED === '1') {
    console.warn(`[seed] ALLOW_PRODUCTION_SEED=1 set, seeding ${name} anyway`);
    return name;
  }
  if (!ALLOWED_DATABASES.includes(name)) {
    throw new Error(
      `refusing to seed database "${name}" (allowed: ${ALLOWED_DATABASES.join(', ')}). ` +
        'Set ALLOW_PRODUCTION_SEED=1 if this really is a throwaway database.'
    );
  }
  return name;
};

module.exports = { assertDevDatabase, ALLOWED_DATABASES };
