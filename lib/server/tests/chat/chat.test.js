/**
 * @title COD chat API tests (rooms + messages)
 * @notice Member scoping and read-marking covered; live parts skip without DATABASE_URL.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { validateMessage } = require('../../services/chat/chat.service');

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
  return { status: res.status, body: await res.json() };
};

const person = (tag) => ({
  email: `${tag}@kosply.test`,
  username: tag,
  name: 'Chat Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('validateMessage (no DB)', () => {
  test('TEXT needs text, LOCATION needs coordinates', () => {
    try {
      validateMessage({ type: 'TEXT', text: '  ' });
      assert.fail('must throw');
    } catch (err) {
      assert.equal(err.code, 'VALIDATION');
    }
    const loc = validateMessage({ type: 'LOCATION', latitude: -6.2, longitude: 106.8 });
    assert.equal(loc.latitude, -6.2);
  });
});

describe('chat live', () => {
  test('open room -> send -> history marks read -> stranger gets 404', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `ca${Date.now()}`;
    const tagB = `cb${Date.now()}`;
    const tagC = `cc${Date.now()}`;
    let roomId;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      const regC = await call('POST', '/api/auth/register', person(tagC));
      const tokenA = regA.body.token;
      const tokenB = regB.body.token;
      const tokenC = regC.body.token;

      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: regB.body.user.id, message: { text: 'halo, masih ada?' } },
        tokenA
      );
      assert.equal(opened.status, 201);
      roomId = opened.body.item.id;
      assert.equal(opened.body.item.messages.length, 1);

      const sent = await call(
        'POST',
        `/api/conversations/${roomId}/messages`,
        { text: 'masih dong' },
        tokenB
      );
      assert.equal(sent.status, 201);

      const inbox = await call('GET', '/api/conversations', undefined, tokenA);
      assert.equal(inbox.status, 200);
      assert.ok(inbox.body.items.some((r) => r.id === roomId));

      const hist = await call('GET', `/api/conversations/${roomId}/messages`, undefined, tokenA);
      assert.equal(hist.status, 200);
      assert.equal(hist.body.items.length, 2);
      const unread = await prisma.message.count({ where: { conversationId: roomId, isRead: false } });
      assert.equal(unread, 1);

      const stranger = await call('GET', `/api/conversations/${roomId}/messages`, undefined, tokenC);
      assert.equal(stranger.status, 404);
      assert.equal(stranger.body.code, 'CONVERSATION_NOT_FOUND');
    } finally {
      if (roomId) await prisma.message.deleteMany({ where: { conversationId: roomId } });
      if (roomId) await prisma.conversation.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { email: { in: [`${tagA}@kosply.test`, `${tagB}@kosply.test`, `${tagC}@kosply.test`] } } });
    }
  });
});
