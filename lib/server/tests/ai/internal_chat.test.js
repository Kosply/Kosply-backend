/**
 * @title Internal COD chat tests (AI negotiator machine API)
 * @notice History read + member-checked send; live parts skip without DATABASE_URL.
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

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

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

      const empty = await call('GET', `/api/internal/conversations/${roomId}/messages`);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body.items, []);

      const sent = await call('POST', `/api/internal/conversations/${roomId}/messages`, {
        senderId: a.id,
        message: { text: 'nego 100rb bisa?' },
      });
      assert.equal(sent.status, 201);

      const read = await call('GET', `/api/internal/conversations/${roomId}/messages`);
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
    } finally {
      if (roomId) await prisma.message.deleteMany({ where: { conversationId: roomId } });
      if (roomId) await prisma.conversation.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { id: { in: [tagA, tagB] } } });
    }
  });
});
