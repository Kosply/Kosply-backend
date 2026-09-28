/**
 * @title Auth middleware (JWT)
 * @notice Verifies `Authorization: Bearer <token>` and attaches `req.user`.
 * @dev Login stays email + password only; tokens carry `{ sub, role }`.
 */
const jwt = require('jsonwebtoken');

const { throwError } = require('../errorCatalog');

/**
 * @notice Require a valid JWT; attaches `{ id, role }` to the request.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response (unused).
 * @param {import('express').NextFunction} next Express next function.
 * @return {void} Calls `next()` or throws `TOKEN_INVALID`.
 */
const authenticate = (req, res, next) => {
  const env = require('../../config/env');
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throwError('TOKEN_INVALID');
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    throwError('TOKEN_INVALID');
  }
};

/**
 * @notice Require one of the given roles (use after `authenticate`).
 * @param {...string} roles Allowed `UserRole` values.
 * @return {Function} Express middleware throwing `FORBIDDEN` otherwise.
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throwError('FORBIDDEN');
  next();
};

module.exports = { authenticate, requireRole };
