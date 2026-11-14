#!/usr/bin/env node
/**
 * @title Gmail consent
 * @notice One-time browser consent that stores a Gmail refresh token.
 * @dev Run from the repo root: `node scripts/gmail-auth.js`. Sign in as the
 * @dev mailbox that should send Kosply codes. The Android login client cannot
 * @dev do this.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));
const { OAuth2Client } = require('google-auth-library');
const env = require('../lib/server/config/env');
const gmail = require('../lib/server/services/auth/gmail');

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

const upsertEnv = (key, value) => {
  const file = path.join(process.cwd(), '.env');
  const line = `${key}="${String(value).replace(/"/g, '')}"`;
  const text = fs.readFileSync(file, 'utf8');
  const next = new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${text.replace(/\s*$/, '')}\n${line}\n`;
  fs.writeFileSync(file, next);
};

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${body}</p>`;

const main = async () => {
  if (!env.gmailClientId || !env.gmailClientSecret) {
    console.error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are missing from .env');
    process.exit(1);
  }
  const oauth = new OAuth2Client(env.gmailClientId, env.gmailClientSecret, REDIRECT);
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [gmail.SEND_SCOPE, 'openid', 'email'],
    redirect_uri: REDIRECT,
  });

  const server = http.createServer(async (req, res) => {
    const incoming = new URL(req.url, REDIRECT);
    if (incoming.pathname !== '/callback') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const oauthError = incoming.searchParams.get('error');
    const code = incoming.searchParams.get('code');
    if (oauthError || !code) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Gagal', 'Izin Gmail ditolak. Tab ini bisa ditutup.'));
      console.error(`CONSENT_FAILED ${oauthError || 'missing code'}`);
      server.close();
      process.exit(1);
    }
    try {
      const { tokens } = await oauth.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token');
      }
      oauth.setCredentials(tokens);
      const info = await oauth.request({ url: 'https://www.googleapis.com/oauth2/v3/userinfo' });
      const sender = info.data.email;
      upsertEnv('GMAIL_REFRESH_TOKEN', tokens.refresh_token);
      if (sender) upsertEnv('GMAIL_SENDER', sender);
      const sent = await gmail.send({
        to: sender,
        subject: 'Tes kode Kosply',
        text: 'Ini tes pengiriman Kosply. Kode contoh: 4821.\n\nAbaikan pesan ini. Kode ini tidak mengubah sandi.',
        refreshToken: tokens.refresh_token,
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Berhasil', `Izin diterima. Email tes dikirim ke ${sender}. Tab ini bisa ditutup.`));
      console.log(`SENT ${sender} ${sent.id}`);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Gagal', 'Izin masuk, tetapi email tes gagal dikirim. Tab ini bisa ditutup.'));
      console.error(`SEND_FAILED ${err.message}`);
      if (err.detail) console.error(err.detail.slice(0, 500));
    } finally {
      server.close();
      process.exit(0);
    }
  });

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`OPEN ${url}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
