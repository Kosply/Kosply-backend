/**
 * @title Auth service (buyer register + login)
 * @notice Business logic for credentials: validation, hashing, JWT minting.
 * @dev Pure validation helpers stay DB-free so unit tests run without Postgres.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

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
});

const signToken = (user) => {
  const env = require('../../config/env');
  return jwt.sign(
    { sub: user.id, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
};

/**
 * @notice Register a buyer (role BUYER, no KTM needed).
 * @param {object} input Raw body fields.
 * @return {Promise<object>} `{ user, token }` with the public user shape.
 */
const register = async (input) => {
  const prisma = requireDb();
  const data = validateRegister(input);
  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email: data.email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username: data.username }, select: { id: true } }),
  ]);
  if (emailTaken) throwError('EMAIL_TAKEN');
  if (usernameTaken) throwError('USERNAME_TAKEN');
  const { password: rawPassword, ...rest } = data;
  const user = await prisma.user.create({
    data: { ...rest, passwordHash: await bcrypt.hash(rawPassword, BCRYPT_ROUNDS) },
  });
  return { user: publicUser(user), token: signToken(user) };
};

/**
 * @notice Login with email + password (login uses email only, never username).
 * @param {object} input Raw body `{ email, password }`.
 * @return {Promise<object>} `{ user, token }` with the public user shape.
 */
const login = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) throwError('VALIDATION', { details: 'email and password are required' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throwError('INVALID_CREDENTIALS');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throwError('INVALID_CREDENTIALS');
  return { user: publicUser(user), token: signToken(user) };
};

module.exports = { validateRegister, register, login, signToken };
