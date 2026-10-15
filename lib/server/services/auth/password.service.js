/**
 * @title Password service (4-digit email OTP reset)
 * @notice Request a code, then reset with it. Always 200 on request (no
 * @dev user enumeration). Codes are bcrypt-hashed, single-use, 10 minutes,
 * @dev locked after 5 wrong tries. Email delivery is TODO — the code is
 * @dev logged server-side outside production for now.
 */
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const refreshService = require('./refresh.service');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BCRYPT_COST = 10;

/**
 * @notice Issue a reset code for the email (silent when unknown).
 * @dev Issues exactly one live code per user: any previously unconsumed ticket
 * @dev is voided first. Previously every call inserted another row, so after
 * @dev using the newest code the *older* one became the newest unconsumed
 * @dev ticket and stayed a valid takeover credential.
 * @param {object} input Body `{ email }`.
 * @return {Promise<object>} `{ status: 'ok' }`, plus `devCode` in development only.
 */
const forgot = async (input = {}) => {
  const db = requireDb();
  const env = require('../../config/env');
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throwError('VALIDATION', { details: 'email is required' });
  const user = await db.selectOne('users', { where: { email }, columns: ['id'] });
  if (!user) {
    // Do the same work as the known path so response timing does not reveal
    // whether the address is registered.
    await bcrypt.compare('timing-equaliser', '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    return { status: 'ok' };
  }
  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  // Both writes in one transaction: voiding the old tickets and issuing the new
  // one is a single fact. If the process died between them, either the user
  // would be left with no valid ticket, or with an extra one still redeemable.
  await db.transaction(async () => {
    await db.updateMany(
      'password_resets',
      { consumedAt: new Date() },
      { where: { userId: user.id, consumedAt: null } }
    );
    await db.insert('password_resets', {
      userId: user.id,
      email,
      codeHash,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  });
  if (env.isDevelopment) {
    console.log(`[password-reset] code for ${email}: ${code} (development only)`);
    return { status: 'ok', devCode: code };
  }
  return { status: 'ok' };
};

/**
 * @notice Reset the password with a valid code.
 * @dev Consumes the ticket with a conditional update so concurrent requests
 * @dev cannot both win: previously `findFirst` + `update({where:{id}})` let N
 * @dev parallel requests all read `consumedAt: null` and all reset, leaving a
 * @dev nondeterministic `passwordHash`. The attempt counter uses `increment`
 * @dev so parallel wrong guesses are counted, not lost to a lost update.
 * @param {object} input Body `{ email, code, newPassword }`.
 * @return {Promise<object>} `{ status: 'ok' }`.
 */
const reset = async (input = {}) => {
  const db = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const code = String(input.code || '').trim();
  const newPassword = String(input.newPassword || '');
  if (!email || !code) throwError('RESET_INVALID');
  if (newPassword.length < 8) throwError('VALIDATION', { details: 'newPassword needs 8+ characters' });
  const ticket = await db.selectOne('password_resets', {
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!ticket || ticket.attempts >= MAX_ATTEMPTS) throwError('RESET_INVALID');
  const ok = await bcrypt.compare(code, ticket.codeHash);
  if (!ok) {
    // Conditional increment: counts every rejected guess and never writes past
    // the cap, even when many requests land at once.
    const bumped = await db.increment(
      'password_resets',
      { id: ticket.id, attempts: 1 },
      { where: { attempts: { lt: MAX_ATTEMPTS } } }
    );
    // A zero count means another request already consumed the last attempt, so
    // the ticket is now locked. Either way the guess is refused.
    if (bumped === 0) throwError('RESET_INVALID');
    throwError('RESET_INVALID');
  }
  const user = await db.selectOne('users', { where: { id: ticket.userId }, columns: ['id'] });
  if (!user) throwError('RESET_INVALID');
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.transaction(async () => {
    // Claim the ticket first; a losing racer matches no row and throws, which
    // rolls the whole transaction back — including the new password.
    const claimed = await db.updateMany(
      'password_resets',
      { consumedAt: new Date() },
      { where: { id: ticket.id, consumedAt: null } }
    );
    if (claimed === 0) throwError('RESET_INVALID');
    await db.update('users', { passwordHash }, { where: { id: user.id } });
    // A successful reset invalidates every other outstanding ticket too.
    await db.updateMany(
      'password_resets',
      { consumedAt: new Date() },
      { where: { userId: user.id, consumedAt: null } }
    );
    // …and every live session. A reset is what someone does *because* they
    // think a password leaked, so leaving renewable sessions running would keep
    // the compromised device signed in long after the password itself changed.
    // The refresh tokens are the only thing that can end those sessions.
    await refreshService.revokeAllFor(db, refreshService.SUBJECT_USER, user.id);
    await refreshService.revokeAllFor(db, refreshService.SUBJECT_STAFF, user.id);
  });
  return { status: 'ok' };
};

module.exports = { forgot, reset };
