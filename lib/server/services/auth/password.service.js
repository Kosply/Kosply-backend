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
  const prisma = requireDb();
  const env = require('../../config/env');
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throwError('VALIDATION', { details: 'email is required' });
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    // Do the same work as the known path so response timing does not reveal
    // whether the address is registered.
    await bcrypt.compare('timing-equaliser', '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    return { status: 'ok' };
  }
  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  await prisma.$transaction([
    prisma.passwordReset.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.passwordReset.create({
      data: { userId: user.id, email, codeHash, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    }),
  ]);
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
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const code = String(input.code || '').trim();
  const newPassword = String(input.newPassword || '');
  if (!email || !code) throwError('RESET_INVALID');
  if (newPassword.length < 8) throwError('VALIDATION', { details: 'newPassword needs 8+ characters' });
  const ticket = await prisma.passwordReset.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!ticket || ticket.attempts >= MAX_ATTEMPTS) throwError('RESET_INVALID');
  const ok = await bcrypt.compare(code, ticket.codeHash);
  if (!ok) {
    // Conditional increment: counts every rejected guess and never writes past
    // the cap, even when many requests land at once.
    const bumped = await prisma.passwordReset.updateMany({
      where: { id: ticket.id, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count === 0) throwError('RESET_INVALID');
    throwError('RESET_INVALID');
  }
  const user = await prisma.user.findUnique({ where: { id: ticket.userId }, select: { id: true } });
  if (!user) throwError('RESET_INVALID');
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    // Claim the ticket first; a losing racer sees count === 0 and bails.
    const claimed = await tx.passwordReset.updateMany({
      where: { id: ticket.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) throwError('RESET_INVALID');
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    // A successful reset invalidates every other outstanding ticket too.
    await tx.passwordReset.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  });
  return { status: 'ok' };
};

module.exports = { forgot, reset };
