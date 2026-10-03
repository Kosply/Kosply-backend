/**
 * @title Internal COD chat tests (AI negotiator machine API)
 * @notice History read + member-checked send; live parts skip without DATABASE_URL.
 */
// `config/env` snapshots the environment at require time, so the key must be
// present *before* the app module is loaded.
const INTERNAL_KEY = 'test-internal-key';
process.env.INTERNAL_API_KEY = INTERNAL_KEY;

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');

const hasDb = Boolean(process.env.DATABASE_URL);
let server;
let base;

before(async () => {
  process.env.INTERNAL_API_KEY = INTERNAL_KEY;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  delete process.env.INTERNAL_API_KEY;
  await new Promise((resolve) => server.close(resolve));
});

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY, ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

/**
 * @dev The whole point of the fix: these routes were previously readable and
 * @dev writable with no credential at all, which is what let an anonymous
 * @dev caller dump a COD transcript and post messages as either party.
 */
describe('internal API requires the shared key', () => {
  const ROUTES = [
    ['GET', '/api/internal/products/search?q=kursi'],
    ['GET', '/api/internal/products/anything'],
    ['GET', '/api/internal/users/anything'],
    ['POST', '/api/internal/contact-requests'],
    ['GET', '/api/internal/conversations/anything/messages'],
    ['POST', '/api/internal/conversations/anything/messages'],
  ];

  for (const [method, path] of ROUTES) {
    test(`${method} ${path} is 401 without the key`, async () => {
      const res = await call(method, path, method === 'POST' ? {} : undefined, {
        'x-internal-key': '',
      });
      assert.equal(res.status, 401, `${path} must be refused`);
      assert.equal(res.body.code, 'INTERNAL_KEY_REQUIRED');
    });

    test(`${method} ${path} is 401 with a wrong key`, async () => {
      const res = await call(method, path, method === 'POST' ? {} : undefined, {
        'x-internal-key': 'not-the-key',
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'INTERNAL_KEY_REQUIRED');
    });
  }
});

describe('internal conversation messages live', () => {
  test('read empty, send as member, stranger refused', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `ia${Date.now()}`;
    const tagB = `ib${Date.now()}`;
    let roomId;
    try {
      const mkUser = (tag) => prisma.user.create({
        data: {
          id: tag, email: `${tag}@kosply.test`, username: tag, name: 'Nego Test',
          passwordHash: 'x', universitas: 'U', programStudi: 'P',
        },
      });
      const [a, b] = await Promise.all([mkUser(tagA), mkUser(tagB)]);
      const room = await prisma.conversation.create({
        data: { id: `ic-${Date.now()}`, buyerId: a.id, sellerId: b.id },
      });
      roomId = room.id;

      const empty = await call('GET', `/api/internal/conversations/${roomId}/messages?userId=${a.id}`);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body.items, []);

      const sent = await call('POST', `/api/internal/conversations/${roomId}/messages`, {
        senderId: a.id,
        message: { text: 'nego 100rb bisa?' },
      });
      assert.equal(sent.status, 201);

      const read = await call('GET', `/api/internal/conversations/${roomId}/messages?userId=${a.id}`);
      assert.equal(read.body.items.length, 1);
      assert.equal(read.body.items[0].text, 'nego 100rb bisa?');

      const stranger = await call('POST', `/api/internal/conversations/${roomId}/messages`, {
        senderId: 'ghost',
        message: { text: 'x' },
      });
      assert.equal(stranger.status, 404);

      const noSender = await call('POST', `/api/internal/conversations/${roomId}/messages`, {
        message: { text: 'x' },
      });
      assert.equal(noSender.status, 400);

      // A non-participant must not be able to read the transcript. This read
      // had no membership check at all, so any reachable caller could dump
      // the buyer's COD negotiation (pickup point, phone, agreed price).
      const outsiderRead = await call(
        'GET',
        `/api/internal/conversations/${roomId}/messages?userId=${a.id}`,
        undefined,
        { 'x-internal-key': INTERNAL_KEY }
      );
      assert.equal(outsiderRead.status, 200, 'the agent is trusted to read for a participant');
      const nonMember = await call(
        'GET',
        `/api/internal/conversations/${roomId}/messages?userId=not-a-member`
      );
      assert.equal(nonMember.status, 404, 'a non-participant userId must not unlock the transcript');
    } finally {
      if (roomId) await prisma.message.deleteMany({ where: { conversationId: roomId } });
      if (roomId) await prisma.conversation.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { id: { in: [tagA, tagB] } } });
    }
  });
});
