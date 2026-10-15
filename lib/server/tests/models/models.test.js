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
    const db = require('../../../db/src/db');
    const mid = `test-model-${Date.now()}`;
    // `authenticate` re-reads the subject from the database, so an admin token
    // must be minted for a real, active ADMIN row — a synthetic `sub` no
    // longer authorises anything.
    const tag = `mt${Date.now()}`;
    const admin = await db.insert('users', {
        email: `${tag}@kosply.test`,
        username: tag,
        name: 'Model Admin',
        passwordHash: 'x',
        universitas: 'U',
        programStudi: 'P',
        role: 'ADMIN',
      });
    const adminToken = require('jsonwebtoken').sign(
      { sub: admin.id, role: 'ADMIN' },
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
      await db.insert('users', {
          id: uid, email: `${uid}@kosply.test`, username: uid, name: 'M', passwordHash: 'x',
          universitas: 'U', programStudi: 'P',
        });
      await db.insert('ai_conversations', { id: cid, userId: uid, title: 't' });
      // The agent records its *provider-prefixed* model id (AI_MODEL is
      // "openai:gpt-4o-mini"), which is what actually lands in this column.
      // Writing the bare `mid` here is what let the in-use guard ship broken:
      // the guard compared against the bare id only, so it never matched a
      // real row and deletion always succeeded.
      await db.insert('ai_messages', {
          id: `mm-${Date.now()}`,
          conversationId: cid,
          role: 'USER',
          content: 'x',
          model: `openai:${mid}`,
        });
      const blocked = await call('DELETE', `/api/models/${modelId}`, undefined, adminToken);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'MODEL_IN_USE');

      await db.remove('ai_messages', { where: { conversationId: cid } });
      await db.remove('ai_conversations', { where: { id: cid } });
      await db.remove('users', { where: { id: uid } });
      const gone = await call('DELETE', `/api/models/${modelId}`, undefined, adminToken);
      assert.equal(gone.status, 200);
    } finally {
      await db.remove('ai_messages', { where: { model: { contains: mid } } });
      await db.remove('ai_models', { where: { modelId: mid } });
      await db.remove('users', { where: { id: admin.id } });
    }
  });
});
