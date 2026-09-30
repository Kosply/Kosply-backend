/**
 * @title Notification API tests (inbox + free toggles + emission)
 * @notice Preferences default on; disabling a key stops its rows.
 * @dev Live parts skip without DATABASE_URL; fixtures are cleaned up.
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
  return { status: res.status, body: await res.json() };
};

const person = (tag) => ({
  email: `${tag}@kosply.test`,
  username: tag,
  name: 'Notif Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('notifications live', () => {
  test('defaults on; toggle off stops chat rows; read flows work', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tagA = `na${Date.now()}`;
    const tagB = `nb${Date.now()}`;
    try {
      const regA = await call('POST', '/api/auth/register', person(tagA));
      const regB = await call('POST', '/api/auth/register', person(tagB));
      const tokenA = regA.body.token;
      const tokenB = regB.body.token;
      const idB = regB.body.user.id;

      const prefs = await call('GET', '/api/notifications/preferences', undefined, tokenB);
      assert.equal(prefs.status, 200);
      assert.ok(prefs.body.items.every((p) => p.enabled === true));

      const badKey = await call('PATCH', '/api/notifications/preferences', { key: 'nope', enabled: false }, tokenB);
      assert.equal(badKey.status, 400);

      await call('PATCH', '/api/notifications/preferences', { key: 'chat', enabled: false }, tokenB);

      const opened = await call(
        'POST',
        '/api/conversations',
        { sellerId: idB, message: { text: 'halo' } },
        tokenA
      );
      assert.equal(opened.status, 201);

      const empty = await call('GET', '/api/notifications', undefined, tokenB);
      assert.equal(empty.status, 200);
      assert.equal(empty.body.items.length, 0);

      await call('PATCH', '/api/notifications/preferences', { key: 'chat', enabled: true }, tokenB);
      await call(
        'POST',
        `/api/conversations/${opened.body.item.id}/messages`,
        { text: 'halo lagi' },
        tokenA
      );
      const full = await call('GET', '/api/notifications?unreadOnly=true', undefined, tokenB);
      assert.equal(full.body.items.length, 1);
      assert.equal(full.body.items[0].type, 'chat');

      const read = await call('POST', `/api/notifications/${full.body.items[0].id}/read`, {}, tokenB);
      assert.equal(read.status, 200);
      assert.equal(read.body.item.isRead, true);

      const clear = await call('POST', '/api/notifications/read-all', {}, tokenB);
      assert.equal(clear.status, 200);
    } finally {
      const ids = await prisma.user.findMany({
        where: { email: { in: [`${tagA}@kosply.test`, `${tagB}@kosply.test`] } },
        select: { id: true },
      });
      const userIds = ids.map((u) => u.id);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.message.deleteMany({ where: { senderId: { in: userIds } } });
      await prisma.conversation.deleteMany({
        where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
