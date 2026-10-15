/**
 * @title Seed — login-able dashboard account
 * @notice Creates (or refreshes) the operator account that can actually sign in
 * @notice to the admin dashboard.
 * @dev Writes BOTH identity stores in this order: a `users` row with a staff
 * @dev role so the marketplace-side `requireRole` checks accept it, and an
 * @dev `admins` row so `POST /api/admin/login` accepts the same credentials.
 * @dev (This mirrors `admin.service.createAdmin`, minus its 12-character
 * @dev policy minimum — see the note on `seedAccounts`.)
 * @dev Credentials come from the environment (`SEED_ADMIN_EMAIL`,
 * @dev `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`) and are never written into the
 * @dev repository. With no password set, one is generated and printed once,
 * @dev so a fresh clone still gets a usable account.
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

/** @dev bcrypt cost, same as the services (`BCRYPT_ROUNDS = 10` + admin 12). */
const BCRYPT_ROUNDS = 12;

/** @dev Dashboard-admins are normally held to 12+ characters (admin.service). */
const ADMIN_PASSWORD_MIN = 12;

/**
 * @notice Generate a strong random password for the no-env case.
 * @returns {string} 16-character base64url password.
 */
const generatePassword = () => crypto.randomBytes(12).toString('base64url');

/**
 * @notice Derive a unique username from the email local part.
 * @dev A hardcoded username previously aborted a re-seed on a unique violation,
 * @dev so the suffix search exists to keep the script re-runnable.
 * @param {object} db Data layer.
 * @param {string} email Account email.
 * @returns {Promise<string>} A free username.
 */
const uniqueUsername = async (db, email) => {
  const base =
    (email.split('@')[0] || 'admin').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20) || 'admin';
  for (let i = 0; i < 5; i += 1) {
    const candidate = i === 0 ? base : `${base}${i}`;
    const taken = await db.selectOne('users', { where: { username: candidate } });
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
};

/**
 * @notice Resolve the operator email the seed targets.
 * @dev Single source for `accounts.js` and `index.js` (the dashboard-only mode
 * @dev needs the same address to resolve audit ids), so the fallback cannot
 * @dev drift between the two.
 * @returns {string} Lower-cased email, env override or the placeholder default.
 */
const resolveSeedAdminEmail = () =>
  (process.env.SEED_ADMIN_EMAIL || 'admin.seed@kosply.test').trim().toLowerCase();

/**
 * @notice Seed the dashboard operator account.
 * @dev Password policy note: an explicitly provided `SEED_ADMIN_PASSWORD`
 * @dev shorter than 12 characters WARNS instead of failing. This is a local
 * @dev demo fixture, not the provisioning path (`POST /api/admin/users` still
 * @dev enforces the real policy), and refusing here would block short
 * @dev passwords developers deliberately use on throwaway databases.
 * @param {object} db Data layer.
 * @returns {Promise<{ email: string, password: string, generated: boolean, userId: string, adminId: string }>} Account summary for the run report.
 */
const seedAccounts = async (db) => {
  const email = resolveSeedAdminEmail();
  const name = (process.env.SEED_ADMIN_NAME || 'Ops Super Admin').trim();
  const provided = (process.env.SEED_ADMIN_PASSWORD || '').trim();
  const generated = !provided;
  const password = provided || generatePassword();

  if (provided && provided.length < ADMIN_PASSWORD_MIN) {
    console.warn(
      `[seed] SEED_ADMIN_PASSWORD is ${provided.length} chars; the provisioning ` +
        `path requires ${ADMIN_PASSWORD_MIN}+. Proceeding because this is a dev fixture.`
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const existing = await db.selectOne('users', { where: { email } });
  const user = await db.upsert('users', {
      email,
      username: existing ? existing.username : await uniqueUsername(db, email),
      name,
      passwordHash,
      universitas: 'Kosply',
      programStudi: 'Ops',
      role: 'SUPER_ADMIN',
    }, { where: { email }, update: { passwordHash, name, role: 'SUPER_ADMIN', isActive: true } });

  const admin = await db.upsert('admins', { email, name, passwordHash }, { where: { email }, update: { passwordHash, name, isActive: true } });

  return { email, password, generated, userId: user.id, adminId: admin.id };
};

module.exports = { seedAccounts, resolveSeedAdminEmail };
