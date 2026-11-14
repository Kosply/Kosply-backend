/**
 * @title Gmail message shape
 * @notice The payload Gmail receives contains the recipient and the code.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildRaw } = require('../../services/auth/gmail');

test('a reset message names the recipient and the code', () => {
  const raw = buildRaw({
    to: 'mahasiswa@kampus.ac.id',
    subject: 'Kode Kosply',
    text: 'Kode reset Kosply kamu: 1234',
  });
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(text, /To: mahasiswa@kampus.ac.id/);
  assert.match(text, /Subject: Kode Kosply/);
  assert.match(text, /1234/);
});
