/**
 * @title Auth middleware (JWT)
 * @notice Verifies `Authorization: Bearer <token>` and attaches `req.user`.
 * @dev Login stays email + password only; tokens carry `{ sub, role }`.
 * @dev The payload is *not* trusted for authorisation. `role` and `isActive`
 * @dev are re-read from the database on every request, because a 7-day token
 * @dev otherwise outlives every moderation action: freezing a user, demoting
 * @dev a seller, or revoking an admin did nothing until they re-logged in.
 * @dev A token whose subject no longer exists, is inactive, or no longer holds
 * @dev the role it was minted with is rejected.
 */
const jwt = require('jsonwebtoken');

const { throwError } = require('../errorCatalog');

/** @dev Pinned so a token's `alg` header can never widen the accepted set. */
const ALGORITHMS = ['HS256'];

/** @dev Shape check: `sub` is the whole identity, `role` drives `requireRole`. */
const USER_ROLES = ['BUYER', 'SELLER', 'ADMIN', 'SUPER_ADMIN'];

/** @dev Roles that may act on another user's data. SUPER_ADMIN >= ADMIN. */
const STAFF_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * @notice Is this role a staff/moderator role?
 * @dev Services used `actor.role === 'ADMIN'` in a dozen places, which made
 * @dev SUPER_ADMIN a functional BUYER: it could not see any support ticket,
 * @dev moderate a product, or read a report, while a plain ADMIN could.
 * @param {string|undefined} role Role to test.
 * @return {boolean} True for ADMIN or SUPER_ADMIN.
 */
const isStaff = (role) => STAFF_ROLES.includes(role);

/**
 * @notice Verify the bearer token's signature and shape.
 * @dev Rejects tokens without a string `sub` so `req.user.id` is never
 * @dev undefined — an undefined id would reach Prisma `where` clauses.
 * @param {string} header Raw `Authorization` header.
 * @return {{sub: string, role: string, kind: string}|null} Claims, or null.
 */
const decode = (header) => {
  const [scheme, token] = String(header || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const payload = jwt.verify(token, require('../../config/env').jwtSecret, {
    algorithms: ALGORITHMS,
  });
  if (typeof payload?.sub !== 'string' || !payload.sub) return null;
  return {
    sub: payload.sub,
    role: USER_ROLES.includes(payload.role) ? payload.role : 'BUYER',
    kind: payload.kind === 'admin' ? 'admin' : 'user',
  };
};

/**
 * @notice Load the current authority for a verified token.
 * @dev `admins` and `users` are separate stores with disjoint id namespaces, so
 * @dev the token's `kind` claim selects which table is authoritative. Returns
 * @dev the live role/active state, never the one baked into the token.
 * @param {{sub: string, role: string, kind: string}} claims Verified claims.
 * @return {Promise<{id: string, role: string, isAdmin: boolean}|null>} Identity or null.
 */
const loadIdentity = async (claims) => {
  const { getPrisma } = require('../../config/db');
  const prisma = getPrisma();
  // No database configured (CI smoke tests): fall back to the token claim.
  if (!prisma) return { id: claims.sub, role: claims.role, isAdmin: isStaff(claims.role) };

  if (claims.kind === 'admin') {
    const admin = await prisma.admin.findUnique({
      where: { id: claims.sub },
      select: { id: true, isActive: true, email: true },
    });
    if (!admin || !admin.isActive) return null;
    // A dashboard operator is staff, but has no `users` row, so it cannot be
    // used for a `users` FK. `isDashboard` tells services to attribute the
    // write by role/name instead.
    return {
      id: admin.id,
      role: 'ADMIN',
      isAdmin: true,
      isDashboard: true,
      email: admin.email,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, role: user.role, isAdmin: isStaff(user.role) };
};

/**
 * @notice Wrap an async middleware so a rejection reaches the error handler.
 * @dev Express 4 catches a *synchronous* throw from a middleware but silently
 * @dev drops a rejected promise, which would turn every auth failure into an
 * @dev unhandled rejection instead of a 401.
 * @param {Function} fn Async middleware.
 * @return {Function} Express middleware.
 */
const guard = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @notice Require a valid, non-revoked JWT; attaches `{ id, role, isAdmin }`.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response (unused).
 * @param {import('express').NextFunction} next Express next function.
 * @return {Promise<void>} Resolves after `next()`, or throws `TOKEN_INVALID`.
 */
const authenticate = guard(async (req, res, next) => {
  let claims;
  try {
    claims = decode(req.headers.authorization);
  } catch {
    throwError('TOKEN_INVALID');
  }
  if (!claims) throwError('TOKEN_INVALID');
  const identity = await loadIdentity(claims);
  if (!identity) throwError('TOKEN_REVOKED');
  req.user = identity;
  next();
});

/**
 * @notice Attach `req.user` when a valid token is present, otherwise continue.
 * @dev For endpoints reachable both anonymously and signed in. Distinguishes
 * @dev "no credential offered" (anonymous is fine) from "credential offered
 * @dev and rejected" (a 401), which previously downgraded an expired token to
 * @dev anonymous and silently mis-attributed the caller's events.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response (unused).
 * @param {import('express').NextFunction} next Express next function.
 * @return {Promise<void>} Always resolves after `next()`.
 */
const optionalAuthenticate = guard(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return next();
  let claims;
  try {
    claims = decode(header);
  } catch {
    throwError('TOKEN_INVALID');
  }
  if (!claims) throwError('TOKEN_INVALID');
  const identity = await loadIdentity(claims);
  if (!identity) throwError('TOKEN_REVOKED');
  req.user = identity;
  return next();
});

/**
 * @notice Require one of the given roles (use after `authenticate`).
 * @param {...string} roles Allowed `UserRole` values.
 * @return {Function} Express middleware throwing `FORBIDDEN` otherwise.
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throwError('FORBIDDEN');
  next();
};

module.exports = { authenticate, optionalAuthenticate, requireRole, isStaff, STAFF_ROLES };
