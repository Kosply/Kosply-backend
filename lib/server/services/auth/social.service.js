/**
 * @title Social service (direct Google + Apple auth, no vendor)
 * @notice Verifies provider ID tokens, then finds/links/creates the user.
 * @dev After success Flutter must complete campus data when
 * @dev `onboardingRequired` is true (universitas/programStudi empty).
 */
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');

const googleClient = () => new OAuth2Client();

const googleAudiences = () => {
  const env = require('../../config/env');
  return String(env.googleClientIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const appleConfig = () => {
  const env = require('../../config/env');
  return {
    audiences: String(env.appleClientIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwksUri: env.appleJwksUrl,
  };
};

/**
 * @notice Verify a Google ID token (signature, expiry, audience).
 * @param {string} idToken Token from `google_sign_in` (Flutter).
 * @return {Promise<object>} `{ providerId, email, emailVerified, name }`.
 */
const verifyGoogleToken = async (idToken) => {
  if (!idToken) throwError('VALIDATION', { details: 'idToken is required' });
  try {
    const ticket = await googleClient().verifyIdToken({ idToken, audience: googleAudiences() });
    const p = ticket.getPayload();
    return {
      providerId: p.sub,
      email: (p.email || '').toLowerCase(),
      emailVerified: p.email_verified === true,
      name: p.name || '',
    };
  } catch {
    throwError('SOCIAL_AUTH_FAILED');
  }
};

/**
 * @notice Verify an Apple identityToken via Apple's JWKS.
 * @param {string} identityToken Token from `sign_in_with_apple` (Flutter).
 * @return {Promise<object>} `{ providerId, email, emailVerified, name }`.
 */
const verifyAppleToken = async (identityToken) => {
  if (!identityToken) throwError('VALIDATION', { details: 'identityToken is required' });
  const { audiences, jwksUri } = appleConfig();
  try {
    const client = jwksRsa({ jwksUri, cache: true, rateLimit: true });
    const getKey = (header, callback) => {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
      });
    };
    const payload = await new Promise((resolve, reject) => {
      jwt.verify(
        identityToken,
        getKey,
        { issuer: 'https://appleid.apple.com', audience: audiences, algorithms: ['RS256'] },
        (err, decoded) => (err ? reject(err) : resolve(decoded))
      );
    });
    return {
      providerId: payload.sub,
      email: String(payload.email || '').toLowerCase(),
      emailVerified: Boolean(payload.email),
      name: '',
    };
  } catch {
    throwError('SOCIAL_AUTH_FAILED');
  }
};

/**
 * @notice Find by provider id, link by verified email, or create a shell user.
 * @dev Shell users get empty campus fields; Flutter completes them via
 * @dev PATCH /api/users/me when `onboardingRequired` is true.
 * @param {object} profile `{ provider: 'google'|'apple', providerId, email, emailVerified, name }`.
 * @return {Promise<object>} `{ user, isNew, onboardingRequired }`.
 */
const findOrLinkSocial = async (profile) => {
  const prisma = requireDb();
  if (!profile || !profile.providerId) throwError('VALIDATION', { details: 'provider account missing' });
  if (!profile.email) {
    throwError('VALIDATION', { details: 'provider did not share an email (re-login and allow email sharing)' });
  }
  if (!profile.emailVerified) {
    throwError('VALIDATION', { details: 'provider email is not verified' });
  }
  const idField = profile.provider === 'apple' ? 'appleId' : 'googleId';
  const linked = await prisma.user.findUnique({ where: { [idField]: profile.providerId } });
  if (linked) {
    if (!linked.isActive) throwError('INVALID_CREDENTIALS');
    return { user: linked, isNew: false, onboardingRequired: !linked.universitas || !linked.programStudi };
  }
  const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
  if (byEmail) {
    if (!byEmail.isActive) throwError('INVALID_CREDENTIALS');
    try {
      const user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { [idField]: profile.providerId },
      });
      return { user, isNew: false, onboardingRequired: !user.universitas || !user.programStudi };
    } catch (err) {
      if (err?.code === 'P2002') throwError('VALIDATION', { details: 'provider account linked elsewhere' });
      throw err;
    }
  }
  const base = profile.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
  let username = base;
  for (let i = 0; i < 5; i += 1) {
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!taken) break;
    username = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const user = await prisma.user.create({
    data: {
      email: profile.email,
      username,
      name: profile.name || base,
      passwordHash: `social:${profile.provider}:${profile.providerId}`,
      universitas: '',
      programStudi: '',
      [idField]: profile.providerId,
    },
  });
  return { user, isNew: true, onboardingRequired: true };
};

module.exports = { verifyGoogleToken, verifyAppleToken, findOrLinkSocial };
