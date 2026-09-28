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

/**
 * @notice Issue a reset code for the email (silent when unknown).
 * @param {object} input Body `{ email }`.
 * @return {Promise<object>} `{ status: 'ok' }`, plus `devCode` outside production.
 */
const forgot = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throwError('VALIDATION', { details: 'email is required' });
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const env = require('../../config/env');
  if (!user) return { status: 'ok' };
  const code = String(crypto.randomInt(1000, 10000));
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      email,
      codeHash: await bcrypt.hash(code, 4),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  if (env.nodeEnv !== 'production') {
    console.log(`[password-reset] code for ${email}: ${code} (dev only, wire email delivery)`);
    return { status: 'ok', devCode: code };
  }
  return { status: 'ok' };
};

/**
 * @notice Reset the password with a valid code.
 * @param {object} input Body `{ email, code, newPassword }`.
 * @return {Promise<object>} `{ status: 'ok' }`.
 */
const reset = async (input = {}) => {
  const prisma = requireDb();
  const email = String(input.email || '').trim().toLowerCase();
  const code = String(input.code || '').trim();
  const newPassword = String(input.newPassword || '');
  if (!email || !code) throwError('RESET_INVALID');
  if (newPassword.length < 6) throwError('VALIDATION', { details: 'newPassword needs 6+ characters' });
  const ticket = await prisma.passwordReset.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!ticket || ticket.attempts >= MAX_ATTEMPTS) throwError('RESET_INVALID');
  const ok = await bcrypt.compare(code, ticket.codeHash);
  if (!ok) {
    await prisma.passwordReset.update({
      where: { id: ticket.id },
      data: { attempts: ticket.attempts + 1 },
    });
    throwError('RESET_INVALID');
  }
  const user = await prisma.user.findUnique({ where: { id: ticket.userId }, select: { id: true } });
  if (!user) throwError('RESET_INVALID');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    }),
    prisma.passwordReset.update({ where: { id: ticket.id }, data: { consumedAt: new Date() } }),
  ]);
  return { status: 'ok' };
};

module.exports = { forgot, reset };
