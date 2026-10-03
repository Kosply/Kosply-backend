/**
 * @title Chat wait tests (long-poll + SSE stream)
 * @notice wait-until-reply (event-shaped) vs wait-with-timeout, plus the
 * @notice event stream. Live parts skip without DATABASE_URL.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const call = async (method, path, body, token) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json(), res };
};

const person = (tag) => ({
  email: `${tag}@kosply.test`,
  username: tag,
  name: 'Wait Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('wait live', () => {
  test('instant new, timeout waiting, stranger refused, bad cursor rejected', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `wa${Date.now()}`;
    const tagB = `wb${Date.now()}`;
    const tagC = `wc${Date.now()}`;
    let roomId;
    let firstId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      const regC = await call('POST', '/api/auth/register', person(tagC));
      const tokenA = regA.body.token;
      const tokenC = regC.body.token;
      await approveAsSeller(prisma, regB.body.user.id, tagB);
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'halo' } },
        tokenA
      );
      roomId = opened.body.item.id;
      firstId = opened.body.item.messages[0].id;

      const now = await call(
        'GET',
        `/api/conversations/${roomId}/wait?after=${firstId}&timeout=1`,
        undefined,
        tokenA
      );
      assert.equal(now.status, 200);
      assert.equal(now.body.outcome, 'waiting');
      assert.deepEqual(now.body.messages, []);

      await call(
        'POST',
        `/api/conversations/${roomId}/messages`,
        { text: 'masih!' },
        regB.body.token
      );
      const got = await call(
        'GET',
        `/api/conversations/${roomId}/wait?after=${firstId}&timeout=5`,
        undefined,
        tokenA
      );
      assert.equal(got.body.outcome, 'new');
      assert.equal(got.body.messages.length, 1);

      const stranger = await call(
        'GET',
        `/api/conversations/${roomId}/wait?timeout=1`,
        undefined,
        tokenC
      );
      assert.equal(stranger.status, 404);

      const badCursor = await call(
        'GET',
        `/api/conversations/${roomId}/wait?after=nope&timeout=1`,
        undefined,
        tokenA
      );
      assert.equal(badCursor.status, 400);
    } finally {
      if (roomId) await prisma.message.deleteMany({ where: { conversationId: roomId } });
      if (roomId) await prisma.conversation.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({
        where: { email: { in: [`${tagA}@kosply.test`, `${tagB}@kosply.test`, `${tagC}@kosply.test`] } },
      });
    }
  });

  test('stream delivers a message that arrives AFTER the connection', { skip: !hasDb }, async () => {
    // The bug this pins: the stream referenced an undefined poll interval and
    // raised a ReferenceError on its first poll, so it emitted history, an
    // error frame and `done` in under a second and never delivered a live
    // message. `node --check` cannot see that, and the old assertion only
    // looked for substrings the pre-crash first iteration had already written.
    const prisma = require('../../../db/src/client');
    const tagA = `wl${Date.now()}`;
    const tagB = `wm${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      await approveAsSeller(prisma, regB.body.user.id, tagB);
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'halo' } },
        regA.body.token
      );
      assert.equal(opened.status, 201, JSON.stringify(opened.body));
      roomId = opened.body.item.id;

      const started = Date.now();
      const res = await fetch(`${base}/api/conversations/${roomId}/stream?timeout=3`, {
        headers: { authorization: `Bearer ${regA.body.token}` },
      });
      // Sent after the headers are flushed, so it can only arrive by polling.
      setTimeout(() => {
        prisma.message
          .create({
            data: { conversationId: roomId, senderId: regB.body.user.id, type: 'TEXT', text: 'live-reply' },
          })
          .catch(() => {});
      }, 1000);
      const text = await res.text();
      const elapsed = Date.now() - started;

      assert.ok(text.includes('live-reply'), 'a message sent after connecting must be delivered');
      assert.ok(!text.includes('event: error'), `stream must not error: ${text.slice(0, 300)}`);
      assert.ok(text.includes('event: done'), 'every stream ends with a terminal event');
      assert.ok(elapsed > 1500, `stream must stay open, closed after ${elapsed}ms`);
    } finally {
      if (roomId) {
        await prisma.message.deleteMany({ where: { conversationId: roomId } });
        await prisma.conversation.deleteMany({ where: { id: roomId } });
      }
    }
  });

  test('a client with no cursor still receives the recent history', { skip: !hasDb }, async () => {
    // `fetchAfter(null)` used to answer "what is newer than the newest
    // message", which is always empty, so a client that never persisted a
    // cursor rendered an empty chat forever.
    const prisma = require('../../../db/src/client');
    const tagA = `wh${Date.now()}`;
    const tagB = `wn${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      await approveAsSeller(prisma, regB.body.user.id, tagB);
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'pertama' } },
        regA.body.token
      );
      roomId = opened.body.item.id;
      const res = await fetch(`${base}/api/conversations/${roomId}/stream?timeout=1`, {
        headers: { authorization: `Bearer ${regA.body.token}` },
      });
      const text = await res.text();
      assert.ok(text.includes('pertama'), 'history must be replayed before polling');
    } finally {
      if (roomId) {
        await prisma.message.deleteMany({ where: { conversationId: roomId } });
        await prisma.conversation.deleteMany({ where: { id: roomId } });
      }
    }
  });

  test('a long-poll with no cursor waits instead of echoing history', { skip: !hasDb }, async () => {
    // The original defect: `fetchAfter(null)` returned the OLDEST rows, so the
    // first loop iteration saw rows and the "long poll" returned immediately.
    const prisma = require('../../../db/src/client');
    const tagA = `wq${Date.now()}`;
    const tagB = `wr${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      await approveAsSeller(prisma, regB.body.user.id, tagB);
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'halo' } },
        regA.body.token
      );
      roomId = opened.body.item.id;
      const started = Date.now();
      const res = await call('GET', `/api/conversations/${roomId}/wait?timeout=2`, undefined, regA.body.token);
      const elapsed = Date.now() - started;
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.outcome, 'waiting', 'must not report existing history as new');
      assert.ok(elapsed > 1200, `must actually wait, returned after ${elapsed}ms`);
    } finally {
      if (roomId) {
        await prisma.message.deleteMany({ where: { conversationId: roomId } });
        await prisma.conversation.deleteMany({ where: { id: roomId } });
      }
    }
  });

  test('stream emits history then done', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `ws${Date.now()}`;
    const tagB = `wt${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      await approveAsSeller(prisma, regB.body.user.id, tagB);
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'ping' } },
        regA.body.token
      );
      roomId = opened.body.item.id;
      // With no cursor the stream correctly starts *after* the newest message
      // (it used to replay the oldest 50 rows and never observe anything new).
      // So: create the room, send a second message, THEN stream from the first
      // message's id — the second message must be delivered. Doing the send
      // before the stream opens keeps this deterministic; firing it
      // concurrently raced the 2s window.
      const firstId = opened.body.item.messages[0].id;
      const second = await call(
        'POST',
        `/api/conversations/${roomId}/messages`,
        { text: 'halo' },
        regA.body.token
      );
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const res = await fetch(
        `${base}/api/conversations/${roomId}/stream?after=${firstId}&timeout=2`,
        { headers: { authorization: `Bearer ${regA.body.token}` } }
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      const text = await res.text();
      assert.ok(text.includes('event: message'), 'the message after the cursor must be delivered');
      assert.ok(text.includes('halo'));
      assert.ok(text.includes('event: done'));
    } finally {
      if (roomId) await prisma.message.deleteMany({ where: { conversationId: roomId } });
      if (roomId) await prisma.conversation.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({
        where: { email: { in: [`${tagA}@kosply.test`, `${tagB}@kosply.test`] } },
      });
    }
  });
});

/**
 * @dev A general chat counterparty must be a real, approved seller: the id used
 * @dev to be accepted for any user id, including a plain BUYER. Promote the
 * @dev registered account the way `verification.review` would.
 * @param {object} prisma Prisma client.
 * @param {string} userId The registered user's id.
 * @param {string} tag Unique tag for the NIM.
 * @return {Promise<void>} Resolves once the seller is approved.
 */
const approveAsSeller = async (prisma, userId, tag) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'SELLER' } });
  await prisma.sellerVerification.upsert({
    where: { userId },
    update: { status: 'APPROVED', isActive: true },
    create: {
      userId,
      namaLengkap: 'Approved Seller',
      nim: `NIM-${tag}`,
      universitas: 'Univ Test',
      programStudi: 'Prodi Test',
      ktmImageUrl: 'https://cdn.test/ktm.png',
      status: 'APPROVED',
      isActive: true,
    },
  });
};
