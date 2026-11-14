/**
 * @title Email verification codes
 * @notice Mails a 4-digit code before an account exists, then consumes it
 * @notice when registration succeeds.
 * @dev The ticket has no userId: the row is the proof that the inbox was
 * @dev reached. Codes are bcrypt-hashed, single-use, valid 10 minutes, and
 * @dev locked after 5 wrong tries. `@kosply.test` never receives mail, and
 * @dev outside production those addresses may register without a code so the
 * @dev existing suite can keep creating accounts. A code that is presented is
 * @dev always checked.
 */
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const { requireDb } = require('../../config/db');
const { throwError } = require('../../middlewares/errorCatalog');
const gmail = require('./gmail');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BCRYPT_COST = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUITE_DOMAIN = '@kosply.test';

const normalise = (email) => String(email || '').trim().toLowerCase();
const suiteAddress = (email) => email.endsWith(SUITE_DOMAIN);

/**
 * @notice Whether registration must present a live code for this address.
 * @param {string} email Normalised email.
 * @param {string} code Code from the body, possibly empty.
 * @return {boolean} True when the code has to be consumed.
 */
const proofRequired = (email, code) => {
  const env = require('../../config/env');
  if (code) return true;
  return !(suiteAddress(email) && env.nodeEnv !== 'production');
};

/**
 * @notice Mail a fresh code, voiding any older live code for the address.
 * @param {object} input Body `{ email }`.
 * @return {Promise<object>} `{ status: 'ok' }`, plus `devCode` in development.
 */
const request = async (input = {}) => {
  const db = requireDb();
  const env = require('../../config/env');
  const email = normalise(input.email);
  if (!EMAIL_RE.test(email)) throwError('VALIDATION', { details: 'email must be valid' });
  const taken = await db.selectOne('users', { where: { email }, columns: ['id'] });
  if (taken) throwError('EMAIL_TAKEN');
  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  await db.transaction(async () => {
    await db.updateMany(
      'email_verifications',
      { consumedAt: new Date() },
      { where: { email, consumedAt: null } }
    );
    await db.insert('email_verifications', {
      email,
      codeHash,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  });
  if (!suiteAddress(email)) {
    let sent = false;
    try {
      sent = await gmail.deliver({
        to: email,
        subject: 'Kode Kosply',
        text: `Kode verifikasi Kosply kamu: ${code}\n\nKode ini berlaku 10 menit. Kalau kamu tidak mendaftar, abaikan email ini.`,
      });
    } catch (err) {
      console.error('[email-code] email was not sent:', err.message);
    }
    if (!sent) throwError('EMAIL_NOT_SENT');
  }
  if (env.isDevelopment) {
    console.log(`[email-code] code for ${email}: ${code} (development only)`);
    return { status: 'ok', devCode: code };
  }
  return { status: 'ok' };
};

/**
 * @notice Load the newest unconsumed, unexpired ticket.
 * @param {object} db Database handle.
 * @param {string} email Normalised email.
 * @return {Promise<object|null>} The ticket, or null.
 */
const liveTicket = (db, email) => db.selectOne('email_verifications', {
  where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
  orderBy: { createdAt: 'desc' },
});

/**
 * @notice Accept a code or count the miss.
 * @dev A correct code is left live so registration can consume it afterwards.
 * @param {object} db Database handle.
 * @param {string} email Normalised email.
 * @param {string} code Four digits.
 * @return {Promise<object>} The matching ticket.
 */
const assertCode = async (db, email, code) => {
  if (!email || !/^\d{4}$/.test(code)) throwError('EMAIL_CODE_INVALID');
  const ticket = await liveTicket(db, email);
  if (!ticket || ticket.attempts >= MAX_ATTEMPTS) throwError('EMAIL_CODE_INVALID');
  const ok = await bcrypt.compare(code, ticket.codeHash);
  if (!ok) {
    await db.increment(
      'email_verifications',
      { id: ticket.id, attempts: 1 },
      { where: { attempts: { lt: MAX_ATTEMPTS } } }
    );
    throwError('EMAIL_CODE_INVALID');
  }
  return ticket;
};

/**
 * @notice Check a code without consuming it.
 * @param {object} input Body `{ email, code }`.
 * @return {Promise<object>} `{ status: 'ok' }`.
 */
const verify = async (input = {}) => {
  const db = requireDb();
  await assertCode(db, normalise(input.email), String(input.code || '').trim());
  return { status: 'ok' };
};

/**
 * @notice Claim a live code so it cannot register a second account.
 * @dev Call inside the registration transaction. A losing claim throws, and
 * @dev the surrounding transaction rolls the new user back with it.
 * @param {object} db Database handle.
 * @param {string} email Normalised email.
 * @param {string} code Four digits.
 * @return {Promise<void>} Resolves when this caller owns the ticket.
 */
const consume = async (db, email, code) => {
  const ticket = await assertCode(db, email, code);
  const claimed = await db.updateMany(
    'email_verifications',
    { consumedAt: new Date() },
    { where: { id: ticket.id, consumedAt: null } }
  );
  if (claimed === 0) throwError('EMAIL_CODE_INVALID');
};

module.exports = { request, verify, consume, proofRequired };
