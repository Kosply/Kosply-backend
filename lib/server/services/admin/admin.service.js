/**
 * @title Admin service (dashboard login + user segmentation)
 * @notice Separate credentials from marketplace users (`admins` table).
 * @dev Tokens carry role ADMIN so the shared `authenticate` middleware works.
 * @dev Segmentation: only SUPER_ADMIN registers admins; admins self-manage
 * @dev photo/name/username while their password stays locked.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MANAGED_ROLES = ['ADMIN', 'SUPER_ADMIN'];

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

/**
 * @notice Register an admin (SUPER_ADMIN only). Password is set once here.
 * @param {object} input Body `{ email, username, name, password, photo?, role? }`.
 * @return {Promise<object>} Public admin-user shape (never the hash).
 */
const createAdmin = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const username = String(input.username || '').trim();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  const role = String(input.role || 'ADMIN').toUpperCase();
  const problems = [];
  if (!EMAIL_RE.test(email)) problems.push('email must be valid');
  if (username.length < 3) problems.push('username needs 3+ characters');
  if (!name) problems.push('name is required');
  if (password.length < 8) problems.push('admin password needs 8+ characters');
  if (!MANAGED_ROLES.includes(role)) problems.push('role must be ADMIN or SUPER_ADMIN');
  if (problems.length) throwError('VALIDATION', { details: problems });
  const [emailTaken, usernameTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (emailTaken) throwError('EMAIL_TAKEN');
  if (usernameTaken) throwError('USERNAME_TAKEN');
  const created = await prisma.user.create({
    data: {
      email,
      username,
      name,
      passwordHash: await bcrypt.hash(password, 10),
      universitas: String(input.universitas || 'Kosply').trim(),
      programStudi: String(input.programStudi || 'Ops').trim(),
      photo: input.photo === undefined || input.photo === null ? null : String(input.photo),
      role,
    },
    select: { id: true, email: true, username: true, name: true, role: true, photo: true },
  });
  return created;
};

/**
 * @notice Update an admin user (SUPER_ADMIN only): profile fields + active flag.
 * @dev Password is locked even here (rotated only by re-creating or a future flow).
 * @param {string} id Target user id.
 * @param {object} input Body `{ name?, username?, photo?, isActive? }`.
 * @return {Promise<object>} Updated public shape.
 */
const updateAdmin = async (id, input = {}) => {
  const prisma = requireDb();
  if (input.password !== undefined || input.email !== undefined) {
    throwError('VALIDATION', { details: 'password and email are locked' });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target || !MANAGED_ROLES.includes(target.role)) throwError('USER_NOT_FOUND');
  const data = {};
  if (input.name !== undefined) {
    if (!String(input.name).trim()) throwError('VALIDATION', { details: 'name cannot be empty' });
    data.name = String(input.name).trim();
  }
  if (input.username !== undefined) {
    const username = String(input.username).trim();
    if (username.length < 3) throwError('VALIDATION', { details: 'username needs 3+ characters' });
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (taken && taken.id !== id) throwError('USERNAME_TAKEN');
    data.username = username;
  }
  if (input.photo !== undefined) data.photo = input.photo === null ? null : String(input.photo);
  if (input.isActive !== undefined) data.isActive = input.isActive === true;
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, username: true, name: true, role: true, photo: true, isActive: true },
  });
};

/**
 * @notice Self-service admin profile: photo, name, username (password locked).
 * @param {object} input Body `{ name?, username?, photo? }`.
 * @param {object} actor Authenticated admin `{ id }`.
 * @return {Promise<object>} Updated public shape.
 */
const updateMe = async (input = {}, actor) => {
  if (input.password !== undefined || input.email !== undefined) {
    throwError('VALIDATION', { details: 'password and email are locked (ask a super admin)' });
  }
  const allowed = {};
  if (input.name !== undefined) allowed.name = input.name;
  if (input.username !== undefined) allowed.username = input.username;
  if (input.photo !== undefined) allowed.photo = input.photo;
  const prisma = requireDb();
  if (allowed.username !== undefined) {
    const username = String(allowed.username).trim();
    if (username.length < 3) throwError('VALIDATION', { details: 'username needs 3+ characters' });
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (taken && taken.id !== actor.id) throwError('USERNAME_TAKEN');
    allowed.username = username;
  }
  if (allowed.name !== undefined) {
    if (!String(allowed.name).trim()) throwError('VALIDATION', { details: 'name cannot be empty' });
    allowed.name = String(allowed.name).trim();
  }
  if (allowed.photo !== undefined && allowed.photo !== null) allowed.photo = String(allowed.photo);
  return prisma.user.update({
    where: { id: actor.id },
    data: allowed,
    select: { id: true, email: true, username: true, name: true, role: true, photo: true },
  });
};

module.exports = { login, createAdmin, updateAdmin, updateMe };
