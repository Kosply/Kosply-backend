/**
 * @title Gmail sender
 * @notice Sends Kosply mail through the Gmail API as the consented mailbox.
 * @dev Uses the Desktop OAuth client (client id + secret + refresh token).
 * @dev The Android login client cannot send mail: it has no client secret.
 * @dev A missing refresh token means the one-time consent in
 * @dev `scripts/gmail-auth.js` has not been finished yet.
 */
const { OAuth2Client } = require('google-auth-library');

const env = require('../../config/env');

/** @notice Scope that lets the mailbox send, and nothing else. */
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * @notice Whether the server has a mailbox it can send from.
 * @return {boolean} True when id, secret, and refresh token are all set.
 */
const canSend = () => Boolean(env.gmailClientId && env.gmailClientSecret && env.gmailRefreshToken);

/**
 * @notice Builds the RFC 5322 message Gmail expects, as base64url.
 * @param {object} message `{ to, subject, text }`.
 * @return {string} `raw` field for `users.messages.send`.
 */
const buildRaw = ({ to, subject, text }) => {
  const from = env.gmailSender ? `From: ${env.gmailSender}\r\n` : '';
  const mime = [
    from.trimEnd(),
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].filter((line, index) => !(index === 0 && line === '')).join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
};

/**
 * @notice Sends one plain-text message from the consented Gmail account.
 * @param {object} message `{ to, subject, text, refreshToken? }`.
 * @return {Promise<object>} Gmail's `{ id, threadId }` response.
 */
const send = async ({ to, subject, text, refreshToken }) => {
  const token = refreshToken || env.gmailRefreshToken;
  if (!env.gmailClientId || !env.gmailClientSecret || !token) {
    const error = new Error('Gmail is not configured');
    error.code = 'GMAIL_NOT_CONFIGURED';
    throw error;
  }
  const oauth = new OAuth2Client(env.gmailClientId, env.gmailClientSecret);
  oauth.setCredentials({ refresh_token: token });
  const access = await oauth.getAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${access.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: buildRaw({ to, subject, text }) }),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Gmail send failed (${response.status})`);
    error.detail = detail;
    throw error;
  }
  return response.json();
};

/**
 * @notice Sends when Gmail is configured and the address is a real mailbox.
 * @dev `@kosply.test` is the suite domain. Those messages are never handed to
 * @dev Gmail, so a test run cannot mail a stranger or burn the send quota.
 * @param {object} message `{ to, subject, text }`.
 * @return {Promise<boolean>} True when Gmail accepted the message.
 */
const deliver = async ({ to, subject, text }) => {
  if (!canSend() || String(to || '').toLowerCase().endsWith('@kosply.test')) return false;
  await send({ to, subject, text });
  return true;
};

module.exports = { SEND_SCOPE, canSend, buildRaw, send, deliver };
