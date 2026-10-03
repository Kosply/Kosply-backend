/**
 * @title Internal API key middleware
 * @notice Guards `/api/internal/*`, the machine API the AI agent calls.
 * @dev These routes were mounted with no authentication of any kind while the
 * @dev agent was published on `0.0.0.0:8000`, and
 * @dev `POST /conversations/:id/messages` took `senderId` from the *body*. Any
 * @dev reachable caller could read any COD transcript and post messages as
 * @dev either party — a fraud primitive in a marketplace where the deal is
 * @dev agreed off-platform in chat.
 * @dev Comparison is constant-time and the key must be configured: an unset
 * @dev `INTERNAL_API_KEY` fails closed rather than opening the surface.
 */
const crypto = require('node:crypto');

const { throwError } = require('./errorCatalog');

const HEADER = 'x-internal-key';

/**
 * @notice Compare two strings without leaking their contents through timing.
 * @param {string} a First value.
 * @param {string} b Second value.
 * @return {boolean} True when equal.
 */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length is the only observable difference.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * @notice Require the shared internal key on every `/api/internal/*` request.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response (unused).
 * @param {import('express').NextFunction} next Express next function.
 * @return {void} Calls `next()` or throws `INTERNAL_KEY_REQUIRED`.
 */
const requireInternalKey = (req, res, next) => {
  const { internalApiKey } = require('../config/env');
  if (!internalApiKey) {
    // Fail closed: an unconfigured key must not mean "no key required".
    throwError('INTERNAL_KEY_REQUIRED', { details: 'INTERNAL_API_KEY is not configured' });
  }
  const provided = req.headers[HEADER];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || !safeEqual(value, internalApiKey)) throwError('INTERNAL_KEY_REQUIRED');
  next();
};

module.exports = { requireInternalKey, safeEqual, INTERNAL_KEY_HEADER: HEADER };
