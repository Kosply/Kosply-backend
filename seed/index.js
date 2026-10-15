/**
 * @title Demo seed runner
 * @notice Writes the dashboard demo fixtures into the target database:
 * @notice the login-able operator account (`accounts.js`) and varied rows for
 * @notice every dashboard surface (`dashboard.js`).
 * @dev Entry point: `./seed.sh [all|accounts|dashboard]` from the repository
 * @dev root. Running `node seed/index.js` directly also works — dotenv is
 * @dev loaded below BEFORE the data layer is required, because the pool
 * @dev reads DATABASE_URL when it is first used.
 * @dev The production guard lives in `seed/guard.js`.
 */
const path = require('node:path');

// dotenv must run before anything that opens the pool.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../lib/db/src/db');
const { assertDevDatabase } = require('./guard');
const { seedAccounts, resolveSeedAdminEmail } = require('./accounts');
const { seedDashboard } = require('./dashboard');

/** @notice Accepted CLI modes. */
const MODES = ['all', 'accounts', 'dashboard'];

/**
 * @notice Resolve the seeded operator's users-row id for audit fields.
 * @dev Returns null when the account was never seeded — the dashboard-only
 * @dev mode then writes `reviewedBy: null`, which is exactly what a
 * @dev dashboard-session decision stores in production.
 * @returns {Promise<string|null>} User id, or null when the account is absent.
 */
const resolveAdminUserId = async () => {
  const email = resolveSeedAdminEmail();
  const admin = await db.selectOne('users', { where: { email } });
  return admin?.id ?? null;
};

/**
 * @notice Run the selected seed mode and print a summary.
 * @returns {Promise<void>} Resolves after the run report is printed.
 */
const main = async () => {
  const mode = process.argv[2] || 'all';
  if (!MODES.includes(mode)) {
    console.error(`[seed] unknown mode "${mode}" (expected: ${MODES.join(' | ')})`);
    process.exitCode = 1;
    return;
  }

  const database = assertDevDatabase();
  console.log(`[seed] target database = ${database} (mode: ${mode})`);

  /** @type {Record<string, number>} */
  const summary = {};

  let adminUserId = null;
  if (mode === 'all' || mode === 'accounts') {
    const account = await seedAccounts(db);
    adminUserId = account.userId;
    summary.accounts = 1;
    console.log(`[seed] operator account = ${account.email}`);
    if (account.generated) {
      console.log(`[seed] generated password (copy it now, shown once) = ${account.password}`);
    }
  } else {
    adminUserId = await resolveAdminUserId();
    if (!adminUserId) {
      console.warn(
        '[seed] operator account not found — run `./seed.sh accounts` first. ' +
          'Audit fields (reviewedBy) will be written as null.'
      );
    }
  }

  if (mode === 'all' || mode === 'dashboard') {
    Object.assign(summary, await seedDashboard(db, { adminUserId }));
  }

  console.log('[seed] done:', JSON.stringify(summary));
};

main()
  .catch((error) => {
    console.error('[seed] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
