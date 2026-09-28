/**
 * @title AI model registry tests (selector source + admin CRUD)
 * @notice Public list hides disabled models; delete is refused when referenced.
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

describe('models live', () => {
  test('public hides disabled; admin CRUD with in-use guard', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const mid = `test-model-${Date.now()}`;
    const adminToken = require('jsonwebtoken').sign(
      { sub: 'admin', role: 'ADMIN' },
      require('../../config/env').jwtSecret
    );
    try {
      const created = await call(
        'POST',
        '/api/models',
        { modelId: mid, name: 'Test Model', inputPrice: 1, outputPrice: 2 },
        adminToken
      );
      assert.equal(created.status, 201);
      const modelId = created.body.item.id;

      const pub = await call('GET', '/api/models');
      assert.ok(pub.body.items.some((m) => m.modelId === mid));

      const disabled = await call('PATCH', `/api/models/${modelId}`, { isActive: false }, adminToken);
      assert.equal(disabled.status, 200);
      const pub2 = await call('GET', '/api/models');
      assert.ok(!pub2.body.items.some((m) => m.modelId === mid));

      const uid = `mu-${Date.now()}`;
      const cid = `mc-${Date.now()}`;
      await prisma.user.create({
        data: {
          id: uid, email: `${uid}@kosply.test`, username: uid, name: 'M', passwordHash: 'x',
          universitas: 'U', programStudi: 'P',
        },
      });
      await prisma.aiConversation.create({ data: { id: cid, userId: uid, title: 't' } });
      await prisma.aiMessage.create({
        data: { id: `mm-${Date.now()}`, conversationId: cid, role: 'USER', content: 'x', model: mid },
      });
      const blocked = await call('DELETE', `/api/models/${modelId}`, undefined, adminToken);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'MODEL_IN_USE');

      await prisma.aiMessage.deleteMany({ where: { conversationId: cid } });
      await prisma.aiConversation.deleteMany({ where: { id: cid } });
      await prisma.user.deleteMany({ where: { id: uid } });
      const gone = await call('DELETE', `/api/models/${modelId}`, undefined, adminToken);
      assert.equal(gone.status, 200);
    } finally {
      await prisma.aiMessage.deleteMany({ where: { model: mid } });
      await prisma.aiModel.deleteMany({ where: { modelId: mid } });
    }
  });
});
