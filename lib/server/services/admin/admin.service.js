/**
 * @title Admin service (dashboard login)
 * @notice Separate credentials from marketplace users (`admins` table).
 * @dev Tokens carry role ADMIN so the shared `authenticate` middleware works.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

/**
 * @notice Dashboard login with email + password (active admins only).
 * @param {object} input Raw body `{ email, password }`.
 * @return {Promise<object>} `{ admin, token }` with the public admin shape.
 */
const login = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) throwError('VALIDATION', { details: 'email and password are required' });
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !admin.isActive) throwError('INVALID_CREDENTIALS');
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throwError('INVALID_CREDENTIALS');
  const env = require('../../config/env');
  const token = jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
  return {
    admin: { id: admin.id, email: admin.email, name: admin.name },
    token,
  };
};

module.exports = { login };
