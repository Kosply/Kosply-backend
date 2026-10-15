/**
 * @title Refresh controller (renew an access token, or end a session)
 * @notice HTTP over `refresh.service`; identity re-checks live here.
 * @dev These two endpoints exist because the access token is stateless and
 * @dev therefore un-revocable. They are the only way to end a session early and
 * @dev the only way to keep one alive without a password.
 */
const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { mintAccessToken, publicUser } = require('../../services/auth/auth.service');
const refreshService = require('../../services/auth/refresh.service');

/**
 * @notice Pull the refresh token out of the request body.
 * @dev Body only. Reading a cookie was tempting for the dashboard, but
 * @dev `cookie-parser` is not a dependency of this server, so `req.cookies`
 * @dev would always be undefined and the branch would be dead code that reads
 * @dev as if it worked. A browser client that wants the credential out of
 * @dev JavaScript's reach should send it from an httpOnly cookie via its own
 * @dev server-side code, the way `Kosply-dasbord` already does with the access
 * @dev token.
 * @dev @param {import('express').Request} req Incoming request.
 * @dev @return {string|undefined} The token, if the request carried one.
 */
const readToken = (req) => {
  const token = req.body?.refreshToken;
  return typeof token === 'string' && token ? token : undefined;
};

/**
 * @notice Re-resolve the identity a refresh token stands for.
 * @dev The token's existence proves nothing about the account *now*. A user
 * @dev banned after signing in must not be able to keep renewing, so the row is
 * @dev re-read and its `isActive` re-checked on every refresh — the same rule
 * @dev `authenticate` applies to an access token.
 * @dev A revoked or missing row deliberately reports the same thing as a bad
 * @dev token: telling a caller "the account exists but is disabled" is an
 * @dev account-existence oracle.
 * @param {object} db Data layer.
 * @param {object} row The `refresh_tokens` row.
 * @return {Promise<{ id: string, role: string, kind?: string, user: object }>} Live identity.
 */
const resolveSubject = async (db, row) => {
  if (row.subjectType === refreshService.SUBJECT_ADMIN) {
    const admin = await db.selectOne('admins', {
      where: { id: row.subjectId },
      columns: ['id', 'email', 'name', 'isActive'],
    });
    if (!admin || !admin.isActive) throwError('TOKEN_REVOKED');
    return { id: admin.id, role: 'ADMIN', kind: 'admin', user: admin };
  }
  if (!refreshService.USER_SUBJECTS.includes(row.subjectType)) {
    // An unknown value means a hand-edited row. Refuse rather than guess which
    // table it points at.
    throwError('TOKEN_REVOKED');
  }
  // Every column `publicUser` reads, not just the three needed for the auth
  // decision. Selecting the minimum here once produced a refresh response whose
  // `user` was `{ id, role }` with every other key undefined — invisible to the
  // status code and to a token check, and only visible to a client that renders
  // the name.
  const user = await db.selectOne('users', {
    where: { id: row.subjectId },
    columns: ['id', 'email', 'username', 'name', 'role', 'universitas', 'programStudi', 'isActive'],
  });
  if (!user || !user.isActive) throwError('TOKEN_REVOKED');
  // `staff` came from the dashboard sign-in and must keep `kind: 'user'` so the
  // refreshed token resolves to the same authority it was minted with.
  const kind = row.subjectType === refreshService.SUBJECT_STAFF ? 'user' : undefined;
  return { id: user.id, role: user.role, kind, user };
};

/**
 * @notice Exchange a refresh token for a new access token.
 * @dev Issues a new refresh token too. That is the rotation: the presented one
 * @dev is consumed, so presenting it twice is detectable and is treated as theft.
 * @dev @param {import('express').Request} req Body `{ refreshToken }` or the cookie.
 * @dev @param {import('express').Response} res Outgoing HTTP response.
 * @dev @return {Promise<void>} Sends `{ status, user, token, refreshToken, expiresAt }`.
 */
const refresh = async (req, res) => {
  const db = requireDb();
  const token = readToken(req);
  if (!token) throwError('TOKEN_INVALID');

  // Consume first: this is where a replay is caught and the family revoked. If
  // it throws, the request is already answered with a 401 and nothing below runs.
  const row = await refreshService.consume(db, token);

  let identity;
  try {
    identity = await resolveSubject(db, row);
  } catch (err) {
    // The account was deleted, disabled or demoted since sign-in. The token is
    // useless now, so the whole family is closed rather than left to expire —
    // a frozen account should not keep a renewable session lying around.
    await refreshService.revokeFamily(db, row.familyId);
    throw err;
  }

  // `row` is passed through so the token is not consumed a second time.
  const successor = await refreshService.rotate(
    db,
    token,
    { userAgent: req.headers['user-agent'], ip: req.ip },
    row
  );

  res.json({
    status: 'ok',
    user: identity.kind === 'admin' ? identity.user : publicUser(identity.user),
    token: mintAccessToken({ id: identity.id, role: identity.role, kind: identity.kind }),
    refreshToken: successor.token,
    expiresAt: successor.expiresAt.toISOString(),
  });
};

/**
 * @notice End the session behind a refresh token.
 * @dev Deliberately does not require a live access token: a user logging out is
 * @dev often holding an *expired* one, and demanding a valid token would make
 * @dev logout fail exactly when it matters. The refresh token is the credential
 * @dev that outlives the access token, so it is the one that authorises this.
 * @dev With no refresh token, an authenticated caller revokes every session for
 * @dev the account ("sign out everywhere").
 * @dev @param {import('express').Request} req Body `{ refreshToken }`, optional.
 * @dev @param {import('express').Response} res Outgoing HTTP response.
 * @dev @return {Promise<void>} Sends `{ status: 'ok', revoked }`.
 */
const logout = async (req, res) => {
  const db = requireDb();
  const token = readToken(req);
  if (token) {
    const outcome = await refreshService.revoke(db, token);
    res.json({ status: 'ok', revoked: outcome.revoked });
    return;
  }
  if (!req.user) throwError('TOKEN_INVALID');
  // A `users` row that signed in through the dashboard is indistinguishable from
  // one that signed in through the marketplace once all that is left is an
  // identity, so "sign out everywhere" sweeps both of its subject types. Same
  // account, same devices, one sign-out.
  const subjectTypes = req.user.isDashboard
    ? [refreshService.SUBJECT_ADMIN]
    : refreshService.USER_SUBJECTS;
  let revoked = 0;
  for (const subjectType of subjectTypes) {
    revoked += await refreshService.revokeAllFor(db, subjectType, req.user.id);
  }
  res.json({ status: 'ok', revoked });
};

module.exports = { readToken, refresh, logout };