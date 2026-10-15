/**
 * @title Admin service (dashboard login + user segmentation)
 * @notice Dashboard operators are rows in `admins`; marketplace users in `users`.
 * @dev `login` used to sign `{ sub: admins.id }` and every service that writes
 * @dev `reviewedBy` / `senderId` stores an FK to `users(id)`. The id namespaces
 * @dev are disjoint, so the whole moderation path 500'd on a foreign-key error *after*
 * @dev already archiving the product. The token now carries `kind: 'admin'`
 * @dev and `requireAdmin` resolves the real `admins` row, so an operator is
 * @dev never mistaken for a marketplace user.
 * @dev `createAdmin` previously wrote `users`, so a "created admin" could
 * @dev never use `/api/admin/login` while the same credentials worked on
 * @dev `/api/auth/login` and unlocked `requireRole('SUPER_ADMIN')`. Both admin
 * @dev stores are now kept in sync.
 */
const bcrypt = require('bcryptjs');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
// One minter, shared with `refresh`, so a renewed token is byte-identical in
// shape to the one `login` handed out.
const { mintAccessToken } = require('../auth/auth.service');
const refreshService = require('../auth/refresh.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @notice Issue a refresh token for an admin session and shape it for the wire.
 * @dev Returns an empty object on a database failure rather than failing the
 * @dev sign-in: the access token has already been minted and the user has
 * @dev proved who they are. Losing the ability to renew is recoverable; losing
 * @dev the login is not.
 * @param {string} subjectType `admin` or `staff`.
 * @param {string} subjectId Id in that namespace.
 * @param {object} [ctx] Request context.
 * @return {Promise<{refreshToken: string, expiresAt: string}|{}>} Session fields, or `{}`.
 */
const sessionFor = async (subjectType, subjectId, ctx) => {
  try {
    const session = await refreshService.issueFor(subjectType, subjectId, ctx);
    return { refreshToken: session.token, expiresAt: session.expiresAt.toISOString() };
  } catch (err) {
    console.error('[admin] could not issue a refresh token:', err.message);
    return {};
  }
};
const MANAGED_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * @notice Dashboard login with email + password (active admins only).
 * @dev Accepts a dashboard row (`admins`) or a marketplace staff row
 * @dev (`users` with role ADMIN/SUPER_ADMIN), so both provisioning paths work.
 * @param {object} input Raw body `{ email, password }`.
 * @return {Promise<object>} `{ admin, token }` with the public admin shape.
 */
const login = async (input = {}, ctx = {}) => {
  const db = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) throwError('VALIDATION', { details: 'email and password are required' });

  const dashboard = await db.selectOne('admins', { where: { email } });
  if (dashboard) {
    if (!dashboard.isActive) throwError('INVALID_CREDENTIALS');
    const ok = await bcrypt.compare(password, dashboard.passwordHash);
    if (!ok) throwError('INVALID_CREDENTIALS');
    return {
      admin: { id: dashboard.id, email: dashboard.email, name: dashboard.name },
      // A dashboard row has no marketplace role to carry, so it is always ADMIN
      // and always tagged `kind: 'admin'` to keep the id namespaces apart.
      token: mintAccessToken({ id: dashboard.id, role: 'ADMIN', kind: 'admin' }),
      ...(await sessionFor(refreshService.SUBJECT_ADMIN, dashboard.id, ctx)),
    };
  }

  const staff = await db.selectOne('users', {
    where: { email },
    columns: ['id', 'email', 'name', 'role', 'isActive', 'passwordHash'],
  });
  if (!staff || !MANAGED_ROLES.includes(staff.role) || !staff.isActive) throwError('INVALID_CREDENTIALS');
  const ok = await bcrypt.compare(password, staff.passwordHash);
  if (!ok) throwError('INVALID_CREDENTIALS');
  return {
    admin: { id: staff.id, email: staff.email, name: staff.name },
    token: mintAccessToken({ id: staff.id, role: staff.role, kind: 'user' }),
    // `staff`, not `user`: this session was minted with `kind: 'user'`, and the
    // refresh has to reproduce that shape or the renewed token would resolve
    // differently from the one it replaces.
    ...(await sessionFor(refreshService.SUBJECT_STAFF, staff.id, ctx)),
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
  const db = requireDb();
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
    db.selectOne('users', { where: { email }, columns: ['id'] }),
    db.selectOne('users', { where: { username }, columns: ['id'] }),
    db.selectOne('admins', { where: { email }, columns: ['id'] }),
  ]);
  if (emailTaken || dashboardTaken) throwError('EMAIL_TAKEN');
  if (usernameTaken) throwError('USERNAME_TAKEN');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await db.transaction(async () => {
      const user = await db.insert('users', {
        email,
        username,
        name,
        passwordHash,
        universitas: String(input.universitas || 'Kosply').trim(),
        programStudi: String(input.programStudi || 'Ops').trim(),
        photo: input.photo === undefined || input.photo === null ? null : String(input.photo),
        role,
      });
      await db.insert('admins', { email, name, passwordHash });
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        photo: user.photo,
      };
    });
  } catch (err) {
    if (err?.code === 'DB_DUPLICATE') throwError('CONFLICT_UNIQUE', { details: 'email or username already used' });
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
  const db = requireDb();
  if (input.password !== undefined || input.email !== undefined) {
    throwError('VALIDATION', { details: 'password and email are locked' });
  }
  const target = await db.selectOne('users', { where: { id }, columns: ['id', 'role', 'email'] });
  if (!target || !MANAGED_ROLES.includes(target.role)) throwError('USER_NOT_FOUND');
  const data = {};
  if (input.name !== undefined) {
    if (!String(input.name).trim()) throwError('VALIDATION', { details: 'name cannot be empty' });
    data.name = String(input.name).trim();
  }
  if (input.username !== undefined) {
    const username = String(input.username).trim();
    if (username.length < 3) throwError('VALIDATION', { details: 'username needs 3+ characters' });
    const taken = await db.selectOne('users', { where: { username }, columns: ['id'] });
    if (taken && taken.id !== id) throwError('USERNAME_TAKEN');
    data.username = username;
  }
  if (input.photo !== undefined) data.photo = input.photo === null ? null : String(input.photo);
  if (input.isActive !== undefined) data.isActive = input.isActive === true;
  const updated = await db.update('users', data, { where: { id } });
  if (data.isActive !== undefined) {
    // The dashboard copy is the one that actually gates `/api/admin/*`, so
    // revoking marketplace access alone was never enough.
    await db.updateMany('admins', { isActive: data.isActive }, { where: { email: target.email } });
    if (!data.isActive) {
      // Turning an account off is only meaningful if the sessions it already
      // has end too. Otherwise the access token dies with its `exp` but the
      // refresh token keeps minting fresh ones, and the account is effectively
      // never off. Both stores are swept: this id may be a `users` row, and a
      // dashboard sign-in stores a `staff` refresh token against it.
      await refreshService.revokeAllFor(db, refreshService.SUBJECT_USER, id);
      await refreshService.revokeAllFor(db, refreshService.SUBJECT_STAFF, id);
      const dashboardRow = await db.selectOne('admins', {
        where: { email: target.email },
        columns: ['id'],
      });
      if (dashboardRow) {
        await refreshService.revokeAllFor(db, refreshService.SUBJECT_ADMIN, dashboardRow.id);
      }
    }
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
  const db = requireDb();
  if (allowed.username !== undefined) {
    const username = String(allowed.username).trim();
    if (username.length < 3) throwError('VALIDATION', { details: 'username needs 3+ characters' });
    const taken = await db.selectOne('users', { where: { username }, columns: ['id'] });
    if (taken && taken.id !== actor.id) throwError('USERNAME_TAKEN');
    allowed.username = username;
  }
  if (allowed.name !== undefined) {
    if (!String(allowed.name).trim()) throwError('VALIDATION', { details: 'name cannot be empty' });
    allowed.name = String(allowed.name).trim();
  }
  if (allowed.photo !== undefined && allowed.photo !== null) allowed.photo = String(allowed.photo);
  const updated = await db.update('users', allowed, { where: { id: actor.id } });
  return {
    id: updated.id,
    email: updated.email,
    username: updated.username,
    name: updated.name,
    role: updated.role,
    photo: updated.photo,
  };
};

module.exports = { login, createAdmin, updateAdmin, updateMe };
