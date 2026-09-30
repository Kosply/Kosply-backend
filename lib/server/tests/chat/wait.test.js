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

  test('stream emits history then done', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `ws${Date.now()}`;
    const tagB = `wt${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'ping' } },
        regA.body.token
      );
      roomId = opened.body.item.id;
      const res = await fetch(
        `${base}/api/conversations/${roomId}/stream?timeout=2`,
        { headers: { authorization: `Bearer ${regA.body.token}` } }
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      const text = await res.text();
      assert.ok(text.includes('event: message'));
      assert.ok(text.includes('ping'));
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
