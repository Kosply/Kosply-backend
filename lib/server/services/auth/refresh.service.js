/**
 * @title Refresh token service (session renewal + revocation)
 * @notice Issues, rotates and revokes the long-lived credential that lets a
 * @notice client mint a new access token without the user typing a password.
 * @dev **Why this exists.** The access token is a stateless JWT with its own
 * @dev `exp`, so there was no way to end a session early: "logging out" cleared
 * @dev a cookie on one machine while the bearer token stayed usable everywhere
 * @dev else until it expired. Revocation needs server-side state, and this is
 * @dev that state.
 * @dev **What a refresh token is not.** It is not a second JWT. It is 256 bits of
 * @dev CSPRNG output, and only `HMAC-SHA256(secret, token)` is stored. A stolen
 * @dev database therefore contains no usable credential, and the token cannot be
 * @dev forged without the secret because the lookup is by hash, not by decoding.
 * @dev **Rotation with reuse detection.** Every renewal consumes the presented
 * @dev token and issues a successor in the same `familyId`. Presenting a token
 * @dev that was already consumed is therefore proof of a replay — the token has
 * @dev left the client it was issued to — and the entire family is revoked. That
 * @dev is deliberately punitive: a replay means an attacker and the real client
 * @dev now hold the same token, and there is no way to tell them apart. Ending
 * @dev both costs one re-login; leaving the session alive costs the account.
 * @dev **Consumed and revoked are different columns on purpose.** Collapsing them
 * @dev would make every ordinary logout look like theft and tear down every
 * @dev other session the account has open.
 */
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const { cuid2 } = require('../../../db/src/ids');

/**
 * @dev `subjectType` encodes both *which table* the identity lives in and *which
 * @dev token shape* it was issued with, because those two are not the same
 * @dev question. `admins` rows always authenticate as ADMIN; a `users` row
 * @dev reached through `/api/auth/login` gets a token with no `kind` at all,
 * @dev while the same row reached through `/api/admin/login` gets
 * @dev `kind: 'user'`. Splitting them here means a refreshed token is shaped
 * @dev exactly like the one `login` handed out — otherwise renewing a session
 * @dev would quietly change what the middleware resolves it to.
 */
const SUBJECT_USER = 'user';
const SUBJECT_STAFF = 'staff';
const SUBJECT_ADMIN = 'admin';

/** @dev Subject types that live in the `users` table. */
const USER_SUBJECTS = [SUBJECT_USER, SUBJECT_STAFF];

/** @dev Bytes of entropy in a refresh token. 256 bits is not negotiable down. */
const TOKEN_BYTES = 32;

/** @dev How far back an already-expired row is kept before it is swept. */
const PURGE_GRACE_DAYS = 30;

/**
 * @notice Hash a refresh token for storage and lookup.
 * @dev HMAC rather than a bare SHA-256 so the stored value is useless without
 * @dev the key, which lives in the environment and not next to the rows. The
 * @dev length is fixed at 64 hex chars to match the `char(64)` column.
 * @param {string} token The raw token.
 * @return {string} Lowercase hex HMAC-SHA256.
 */
const hashToken = (token) => {
  const env = require('../../config/env');
  return crypto.createHmac('sha256', env.refreshTokenSecret).update(token).digest('hex');
};

/**
 * @notice Issue a brand-new refresh token and persist its hash.
 * @dev The returned token is the only time the raw value exists; the caller
 * @dev hands it straight to the client and never stores it.
 * @dev Expired rows for the same subject are swept here rather than from a
 * @dev scheduled event: the table would otherwise be the only one in the schema
 * @dev that grows with no cleanup path, and `CREATE EVENT` needs a privilege and
 * @dev a server setting a stock deployment does not have.
 * @param {object} db Data layer.
 * @param {string} subjectType `user` or `admin`.
 * @param {string} subjectId Id in that namespace.
 * @param {object} [ctx] Request context for the audit columns.
 * @param {string} [ctx.userAgent] Client user-agent.
 * @param {string} [ctx.ip] Client address.
 * @param {string} [familyId] Existing family to join; a new one is minted when absent.
 * @return {Promise<{ token: string, expiresAt: Date, familyId: string, id: string }>} The new credential.
 */
const issue = async (db, subjectType, subjectId, ctx = {}, familyId = null) => {
  const env = require('../../config/env');
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const id = cuid2();
  const family = familyId || cuid2();
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await db.insert('refresh_tokens', {
    id,
    subjectType,
    subjectId,
    familyId: family,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: ctx.userAgent ? String(ctx.userAgent).slice(0, 191) : null,
    ip: ctx.ip ? String(ctx.ip).slice(0, 191) : null,
  });

  // Opportunistic housekeeping. Bounded by the subject index, so it cannot turn
  // a sign-in into a table scan on a large account.
  const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await db.remove('refresh_tokens', {
    where: { subjectType, subjectId, expiresAt: { lt: cutoff } },
  });

  return { token, expiresAt, familyId: family, id };
};

/**
 * @notice Issue a refresh token for a subject, opening the data layer yourself.
 * @dev Convenience for the sign-in paths, which have the user in hand but not
 * @dev the data layer. The controller path passes its own `db` so it can reuse
 * @dev the one it already opened.
 * @dev @param {string} subjectType One of the `SUBJECT_*` constants.
 * @dev @param {string} subjectId Id in that namespace.
 * @dev @param {object} [ctx] Request context for the audit columns.
 * @dev @return {Promise<{ token: string, expiresAt: Date }>} The new credential.
 */
const issueFor = async (subjectType, subjectId, ctx = {}) => {
  const { requireDb } = require('../../config/db');
  return issue(requireDb(), subjectType, subjectId, ctx);
};

/**
 * @notice Load a token row by its raw value.
 * @dev A miss and a wrong hash are indistinguishable here, which is the point:
 * @dev the lookup is on a 64-char indexed hash of a 256-bit secret, so there is
 * @dev no equality comparison on guessable material to time against.
 * @param {object} db Data layer.
 * @param {string} token Raw token from the client.
 * @return {Promise<object|null>} The row, or null.
 */
const findByToken = async (db, token) => {
  if (typeof token !== 'string' || token.length < 16 || token.length > 512) return null;
  return db.selectOne('refresh_tokens', { where: { tokenHash: hashToken(token) } });
};

/**
 * @notice Revoke every live token in a rotation family.
 * @dev Used both by logout-with-token and by reuse detection, which is why it
 * @dev keys on `familyId` and not on a single row.
 * @param {object} db Data layer.
 * @param {string} familyId The family to close.
 * @param {Date} [now] Timestamp to stamp; injectable for tests.
 * @return {Promise<number>} Rows closed.
 */
const revokeFamily = async (db, familyId, now = new Date()) =>
  db.updateMany('refresh_tokens', { revokedAt: now }, { where: { familyId, revokedAt: null } });

/**
 * @notice Revoke every live token for a subject (sign out everywhere).
 * @param {object} db Data layer.
 * @param {string} subjectType `user` or `admin`.
 * @param {string} subjectId Id in that namespace.
 * @param {Date} [now] Timestamp to stamp.
 * @return {Promise<number>} Rows closed.
 */
const revokeAllFor = async (db, subjectType, subjectId, now = new Date()) =>
  db.updateMany(
    'refresh_tokens',
    { revokedAt: now },
    { where: { subjectType, subjectId, revokedAt: null } }
  );

/**
 * @notice Consume a token, judging whether the presentation is legitimate.
 * @dev Separated from the caller so the decision order is stated once and in one
 * @dev place. In order:
 * @dev  1. unknown token          -> `TOKEN_INVALID`   (never existed / guessed)
 * @dev  2. already revoked        -> `TOKEN_REVOKED`   (session already ended)
 * @dev  3. already consumed       -> REPLAY            (family is revoked)
 * @dev  4. expired                -> `TOKEN_REVOKED`   (also sweeps the family)
 * @dev Replay is checked before expiry on purpose: a token that was rotated and
 * @dev has since aged out is still a replay, and letting it expire quietly would
 * @dev give an attacker a silent window instead of a loud revocation.
 * @dev @returns {Promise<{row: object, replay: boolean}>} The accepted row.
 */
const consume = async (db, token) => {
  const row = await findByToken(db, token);
  if (!row) throwError('TOKEN_INVALID');
  if (row.revokedAt) throwError('TOKEN_REVOKED');
  if (row.consumedAt) {
    // Replay: this token already produced a successor, so two parties hold it.
    await revokeFamily(db, row.familyId);
    throwError('TOKEN_REVOKED', { details: 'refresh token reuse detected' });
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await revokeFamily(db, row.familyId);
    throwError('TOKEN_REVOKED', { details: 'refresh token expired' });
  }
  return row;
};

/**
 * @notice End the session behind a refresh token.
 * @dev Works without an access token on purpose. The whole reason this endpoint
 * @dev exists is that by the time a user logs out their access token may already
 * @dev be expired — requiring a live access token would make logout impossible
 * @dev exactly when it is most needed.
 * @dev An unknown token still succeeds (200). Reporting "that token was never
 * @dev valid" would let a caller probe which tokens exist.
 * @param {object} [db] Data layer.
 * @param {string} token Raw refresh token.
 * @return {Promise<{ status: string, revoked: boolean }>} Outcome summary.
 */
const revoke = async (db, token) => {
  const row = await findByToken(db, token);
  if (!row) return { status: 'ok', revoked: false };
  await revokeFamily(db, row.familyId);
  return { status: 'ok', revoked: true };
};

/**
 * @notice Rotate a refresh token into a fresh pair for the same session.
 * @dev The caller's access token must already be minted by
 * @dev `auth.service.mintAccessToken`; this returns only the new refresh token,
 * @dev so the identity checks live in one place (`refresh.controller`).
 * @dev `row` lets the caller pass a token it has *already* consumed — the
 * @dev controller does, because it has to re-check the account between the two
 * @dev steps. Consuming a second time here would see `consumedAt` set, decide it
 * @dev was a replay and revoke the very family it is about to extend.
 * @dev @param {object} db Data layer.
 * @dev @param {string} token Presented refresh token.
 * @dev @param {object} [ctx] Request context for the audit columns.
 * @dev @param {object} [row] Row from a prior `consume`, when already validated.
 * @dev @return {Promise<{ token: string, expiresAt: Date, familyId: string }>} The successor credential.
 */
const rotate = async (db, token, ctx = {}, row = null) => {
  const current = row || (await consume(db, token));
  const successor = await issue(db, current.subjectType, current.subjectId, ctx, current.familyId);
  // Marked after the successor exists so a crash in between leaves a token that
  // still works, rather than a consumed token with nothing to replace it.
  await db.update(
    'refresh_tokens',
    { consumedAt: new Date(), replacedById: successor.id },
    { where: { id: current.id } }
  );
  return successor;
};

module.exports = {
  PURGE_GRACE_DAYS,
  SUBJECT_ADMIN,
  SUBJECT_STAFF,
  SUBJECT_USER,
  USER_SUBJECTS,
  TOKEN_BYTES,
  consume,
  findByToken,
  hashToken,
  issue,
  revoke,
  revokeAllFor,
  revokeFamily,
  rotate,
};