/**
 * @title Admin service (dashboard login + user segmentation)
 * @notice Dashboard operators are rows in `admins`; marketplace users in `users`.
 * @dev `login` used to sign `{ sub: admins.id }` and every service that writes
 * @dev `reviewedBy` / `senderId` stores an FK to `users(id)`. The id namespaces
 * @dev are disjoint, so the whole moderation path 500'd with P2003 *after*
 * @dev already archiving the product. The token now carries `kind: 'admin'`
 * @dev and `requireAdmin` resolves the real `admins` row, so an operator is
 * @dev never mistaken for a marketplace user.
 * @dev `createAdmin` previously wrote `users`, so a "created admin" could
 * @dev never use `/api/admin/login` while the same credentials worked on
 * @dev `/api/auth/login` and unlocked `requireRole('SUPER_ADMIN')`. Both admin
 * @dev stores are now kept in sync.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MANAGED_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * @notice Dashboard login with email + password (active admins only).
 * @dev Accepts a dashboard row (`admins`) or a marketplace staff row
 * @dev (`users` with role ADMIN/SUPER_ADMIN), so both provisioning paths work.
 * @param {object} input Raw body `{ email, password }`.
 * @return {Promise<object>} `{ admin, token }` with the public admin shape.
 */
const login = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) throwError('VALIDATION', { details: 'email and password are required' });

  const dashboard = await prisma.admin.findUnique({ where: { email } });
  if (dashboard) {
    if (!dashboard.isActive) throwError('INVALID_CREDENTIALS');
    const ok = await bcrypt.compare(password, dashboard.passwordHash);
    if (!ok) throwError('INVALID_CREDENTIALS');
    const env = require('../../config/env');
    return {
      admin: { id: dashboard.id, email: dashboard.email, name: dashboard.name },
      token: jwt.sign(
        { sub: dashboard.id, role: 'ADMIN', kind: 'admin' },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn }
      ),
    };
  }

  const staff = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true } });
  if (!staff || !MANAGED_ROLES.includes(staff.role) || !staff.isActive) throwError('INVALID_CREDENTIALS');
  const ok = await bcrypt.compare(password, staff.passwordHash);
  if (!ok) throwError('INVALID_CREDENTIALS');
  const env = require('../../config/env');
  return {
    admin: { id: staff.id, email: staff.email, name: staff.name },
    token: jwt.sign({ sub: staff.id, role: staff.role, kind: 'user' }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn,
    }),
  };
};

/**
 * @notice Register an admin (SUPER_ADMIN only). Password is set once here.
 * @dev Writes BOTH stores inside one transaction: a `users` row so the
 * @dev marketplace-side `requireRole` checks see a staff role, and an `admins`
 * @dev row so `/api/admin/login` accepts the same credentials. Previously only
 * @dev `users` was written, so a created admin could never use the dashboard.
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
  if (password.length < 12) problems.push('admin password needs 12+ characters');
  if (!MANAGED_ROLES.includes(role)) problems.push('role must be ADMIN or SUPER_ADMIN');
  if (problems.length) throwError('VALIDATION', { details: problems });
  const [emailTaken, usernameTaken, dashboardTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.admin.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (emailTaken || dashboardTaken) throwError('EMAIL_TAKEN');
  if (usernameTaken) throwError('USERNAME_TAKEN');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          username,
          name,
          passwordHash,
          universitas: String(input.universitas || 'Kosply').trim(),
          programStudi: String(input.programStudi || 'Ops').trim(),
          photo: input.photo === undefined || input.photo === null ? null : String(input.photo),
          role,
        },
        select: { id: true, email: true, username: true, name: true, role: true, photo: true },
      });
      await tx.admin.create({ data: { email, name, passwordHash } });
      return user;
    });
    return created;
  } catch (err) {
    if (err?.code === 'P2002') throwError('CONFLICT_UNIQUE', { details: 'email or username already used' });
    throw err;
  }
};

/**
 * @notice Update an admin user (SUPER_ADMIN only): profile fields + active flag.
 * @dev `isActive` is applied to BOTH stores. It previously only flipped
 * @dev `users.isActive`, which revoked the marketplace session while leaving
 * @dev `/api/admin/login` working — the exact opposite of "dashboard access
 * @dev revoked" for the one field that actually gates the dashboard.
 * @param {string} id Target user id.
 * @param {object} input Body `{ name?, username?, photo?, isActive? }`.
 * @return {Promise<object>} Updated public shape.
 */
const updateAdmin = async (id, input = {}) => {
  const prisma = requireDb();
  if (input.password !== undefined || input.email !== undefined) {
    throwError('VALIDATION', { details: 'password and email are locked' });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, email: true } });
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
  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, username: true, name: true, role: true, photo: true, isActive: true },
  });
  if (data.isActive !== undefined) {
    await prisma.admin.updateMany({ where: { email: target.email }, data: { isActive: data.isActive } });
  }
  return updated;
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
