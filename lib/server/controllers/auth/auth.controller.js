/**
 * @title Auth controller (thin HTTP over auth.service)
 */
const service = require('../../services/auth/auth.service');
const social = require('../../services/auth/social.service');
const { requireDb } = require('../../config/db');
const { signToken } = require('../../services/auth/auth.service');
const refreshService = require('../../services/auth/refresh.service');
const { throwError } = require('../../middlewares/errorCatalog');

/**
 * @notice Request context for the refresh token's audit columns.
 * @dev `ip` is `req.ip`, which behind `trust proxy` is the right-most
 * @dev `X-Forwarded-For` entry — attacker-chosen. It is recorded as a hint for a
 * @dev human reading the audit trail, never used to make an auth decision.
 * @param {import('express').Request} req Incoming request.
 * @return {{userAgent: string|undefined, ip: string|undefined}} Context.
 */
const ctxOf = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

/**
 * @notice Register a buyer.
 * @param {import('express').Request} req Body: register fields.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status, user, token, refreshToken, expiresAt }` with status 201.
 */
const register = async (req, res) => {
  const { user, token, refreshToken, expiresAt } = await service.register(req.body, ctxOf(req));
  res.status(201).json({ status: 'ok', user, token, refreshToken, expiresAt });
};

/**
 * @notice Login with email + password.
 * @param {import('express').Request} req Body: `{ email, password }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status, user, token, refreshToken, expiresAt }` with status 200.
 */
const login = async (req, res) => {
  const { user, token, refreshToken, expiresAt } = await service.login(req.body, ctxOf(req));
  res.json({ status: 'ok', user, token, refreshToken, expiresAt });
};

/**
 * @notice Login with Google (direct, no vendor).
 * @dev Flutter sends the `idToken` from `google_sign_in`; campus data is
 * @dev completed afterwards when `onboardingRequired` is true.
 * @param {import('express').Request} req Body: `{ idToken }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', user, token, onboardingRequired, isNew }`.
 */
const google = async (req, res) => {
  const env = require('../../config/env');
  if (!env.googleLoginEnabled) throwError('SOCIAL_DISABLED');
  const profile = await social.verifyGoogleToken(req.body?.idToken);
  const { user, isNew, onboardingRequired } = await social.findOrLinkSocial({ ...profile, provider: 'google' });
  const session = await refreshService.issueFor(refreshService.SUBJECT_USER, user.id, ctxOf(req));
  res.json({
    status: 'ok',
    user: { ...service.publicUser(user), onboardingRequired },
    token: signToken(user),
    refreshToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
    onboardingRequired,
    isNew,
  });
};

/**
 * @notice Login with Apple (direct, no vendor).
 * @dev Flutter sends `identityToken` (+ names on first login only).
 * @param {import('express').Request} req Body: `{ identityToken, givenName?, familyName? }`.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {Promise<void>} Sends `{ status: 'ok', user, token, onboardingRequired, isNew }`.
 */
const apple = async (req, res) => {
  const env = require('../../config/env');
  if (!env.appleLoginEnabled) throwError('SOCIAL_DISABLED');
  const profile = await social.verifyAppleToken(req.body?.identityToken);
  const given = [req.body?.givenName, req.body?.familyName].filter(Boolean).join(' ').trim();
  const { user, isNew, onboardingRequired } = await social.findOrLinkSocial({
    ...profile,
    provider: 'apple',
    name: profile.name || given,
  });
  const session = await refreshService.issueFor(refreshService.SUBJECT_USER, user.id, ctxOf(req));
  res.json({
    status: 'ok',
    user: { ...service.publicUser(user), onboardingRequired },
    token: signToken(user),
    refreshToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
    onboardingRequired,
    isNew,
  });
};

module.exports = { register, login, google, apple };
