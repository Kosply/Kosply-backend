/**
 * @title Auth service (buyer register + login)
 * @notice Business logic for credentials: validation, hashing, JWT minting.
 * @dev Pure validation helpers stay DB-free so unit tests run without a database.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const refreshService = require('./refresh.service');

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @notice Validate registration fields, throwing VALIDATION with details.
 * @param {object} input Raw body fields.
 * @return {object} Normalized `{ email, username, name, password, universitas, programStudi }`.
 */
const validateRegister = (input = {}) => {
  const email = String(input.email || '').trim().toLowerCase();
  const username = String(input.username || '').trim();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  const universitas = String(input.universitas || '').trim();
  const programStudi = String(input.programStudi || '').trim();
  const problems = [];
  if (!EMAIL_RE.test(email)) problems.push('email must be valid');
  if (username.length < 3) problems.push('username needs 3+ characters');
  if (!name) problems.push('name is required');
  if (password.length < 6) problems.push('password needs 6+ characters');
  if (!universitas) problems.push('universitas is required');
  if (!programStudi) problems.push('programStudi is required');
  if (problems.length) throwError('VALIDATION', { details: problems });
  return { email, username, name, password, universitas, programStudi };
};

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  name: user.name,
  role: user.role,
  universitas: user.universitas,
  programStudi: user.programStudi,
  onboardingRequired: !user.universitas || !user.programStudi,
});

/**
 * @notice Mint an access token.
 * @dev Single place a JWT is signed, so `refresh` cannot drift from `login`
 * @dev and hand out a token shaped differently from the one clients already
 * @dev hold. `kind` is included only for the `admins` namespace, exactly as
 * @dev before: the marketplace token has no `kind`, and adding one would change
 * @dev what every installed Flutter client sends.
 * @dev @param {object} subject `{ id, role, kind? }`.
 * @dev @return {string} Signed JWT.
 */
const mintAccessToken = ({ id, role, kind }) => {
  const env = require('../../config/env');
  const payload = kind ? { sub: id, role, kind } : { sub: id, role };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
};

/**
 * @notice Mint an access token for a marketplace user row.
 * @dev @param {object} user A `users` row.
 * @dev @return {string} Signed JWT.
 */
const signToken = (user) => mintAccessToken({ id: user.id, role: user.role });

/**
 * @notice Register a buyer (role BUYER, no KTM needed).
 * @dev A refresh token is issued here as well as an access token, so a client
 * @dev that registers is already able to renew without typing a password again.
 * @param {object} input Raw body fields.
 * @param {object} [ctx] Request context, for the refresh token's audit columns.
 * @return {Promise<object>} `{ user, token, refreshToken, expiresAt }`.
 */
const register = async (input, ctx = {}) => {
  const db = requireDb();
  const data = validateRegister(input);
  const [emailTaken, usernameTaken] = await Promise.all([
    db.selectOne('users', { where: { email: data.email }, columns: ['id'] }),
    db.selectOne('users', { where: { username: data.username }, columns: ['id'] }),
  ]);
  if (emailTaken) throwError('EMAIL_TAKEN');
  if (usernameTaken) throwError('USERNAME_TAKEN');
  const { password: rawPassword, ...rest } = data;
  const user = await db.insert('users', {
    ...rest,
    passwordHash: await bcrypt.hash(rawPassword, BCRYPT_ROUNDS),
  });
  const session = await refreshService.issue(db, refreshService.SUBJECT_USER, user.id, ctx);
  return {
    user: publicUser(user),
    token: signToken(user),
    refreshToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
  };
};

/**
 * @notice Login with email + password (login uses email only, never username).
 * @dev Every login starts a NEW token family. Signing in again is a new session,
 * @dev and keeping the old family alive would mean "log in" no longer isolates
 * @dev you from a session an attacker may still be holding.
 * @param {object} input Raw body `{ email, password }`.
 * @param {object} [ctx] Request context, for the refresh token's audit columns.
 * @return {Promise<object>} `{ user, token, refreshToken, expiresAt }`.
 */
const login = async (input = {}, ctx = {}) => {
  const db = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) throwError('VALIDATION', { details: 'email and password are required' });
  // Reads the whole row: the bcrypt hash is needed for the comparison, and
  // `isActive` decides whether a frozen account may log in at all.
  const user = await db.selectOne('users', { where: { email } });
  if (!user || !user.isActive) throwError('INVALID_CREDENTIALS');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throwError('INVALID_CREDENTIALS');
  const session = await refreshService.issue(db, refreshService.SUBJECT_USER, user.id, ctx);
  return {
    user: publicUser(user),
    token: signToken(user),
    refreshToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
  };
};

module.exports = { validateRegister, register, login, mintAccessToken, signToken, publicUser };
