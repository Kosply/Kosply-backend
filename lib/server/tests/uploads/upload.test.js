/**
 * @title Upload API tests (image bytes in, public URL out)
 * @notice Auth gate runs everywhere; storage flows skip without DATABASE_URL
 * @notice because `authenticate` re-reads the user row.
 * @dev `UPLOAD_DIR` points at a temp directory before the app loads, because
 * @dev `app.js` mounts the static handler on the directory it sees at require
 * @dev time. Each test file runs in its own process, so this cannot leak.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosply-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const app = require('../../app');
const { cleanup } = require('../../../db/src/testkit');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

/** @dev A valid 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const upload = async (bytes, contentType, token) => {
  const res = await fetch(`${base}/api/uploads/images`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
};

describe('uploads auth (no DB)', () => {
  test('an anonymous upload is 401 and stores nothing', async () => {
    const res = await upload(PNG, 'image/png');
    assert.equal(res.status, 401);
    assert.deepEqual(fs.readdirSync(uploadDir), []);
  });
});

describe('uploads live', () => {
  test('stores a PNG, serves it back, refuses everything else', { skip: !hasDb }, async () => {
    const tag = `up${Date.now()}`;
    let userId;
    try {
      const reg = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `${tag}@kosply.test`,
          username: tag,
          name: 'Upload Test',
          password: 'secret123',
          universitas: 'U',
          programStudi: 'P',
        }),
      }).then((res) => res.json());
      userId = reg.user.id;
      const token = reg.token;

      const stored = await upload(PNG, 'image/png', token);
      assert.equal(stored.status, 201);
      assert.equal(stored.body.item.contentType, 'image/png');
      assert.equal(stored.body.item.size, PNG.length);
      assert.match(stored.body.item.url, /^http:\/\/localhost:\d+\/uploads\/[a-z0-9]+\.png$/);

      const served = await fetch(stored.body.item.url);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.equal(served.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.ok(Buffer.from(await served.arrayBuffer()).equals(PNG));

      // The declared type must match the bytes: a script labelled as a PNG is
      // refused rather than served back from our origin.
      const disguised = await upload(Buffer.from('<script>alert(1)</script>'), 'image/png', token);
      assert.equal(disguised.status, 415);
      assert.equal(disguised.body.code, 'UNSUPPORTED_MEDIA_TYPE');

      const text = await upload(Buffer.from('hello'), 'text/plain', token);
      assert.equal(text.status, 415);

      const empty = await upload(Buffer.alloc(0), 'image/jpeg', token);
      assert.equal(empty.status, 400);
      assert.equal(empty.body.code, 'VALIDATION');

      // Only the one accepted PNG reached the disk.
      assert.equal(fs.readdirSync(uploadDir).length, 1);
    } finally {
      if (userId) await cleanup([userId]);
    }
  });
});
