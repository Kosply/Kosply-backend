/**
 * @title AI proxy tests (server -> agent)
 * @notice Auth gating plus agent-down degradation (no live agent needed).
 * @dev Points AI_AGENT_URL at a closed port and restores it afterwards.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../../app');
const env = require('../../config/env');

const DEAD_AGENT = 'http://localhost:9';
let server;
let base;
let savedAgentUrl;

before(async () => {
  savedAgentUrl = process.env.AI_AGENT_URL;
  process.env.AI_AGENT_URL = DEAD_AGENT;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (savedAgentUrl === undefined) delete process.env.AI_AGENT_URL;
  else process.env.AI_AGENT_URL = savedAgentUrl;
  await new Promise((resolve) => server.close(resolve));
});

const hasDb = Boolean(process.env.DATABASE_URL);
const ghostToken = () => jwt.sign({ sub: 'u1', role: 'BUYER' }, env.jwtSecret);

/**
 * @dev `authenticate` re-reads the subject from the database, so a token for a
 * @dev user that does not exist is no longer honoured. The degradation suite
 * @dev therefore needs a real user; without a DB it falls back to the ghost
 * @dev token, which still reaches the route (degraded mode skips the lookup).
 */
let realToken = ghostToken();
let realUserId = null;
before(async () => {
  if (!hasDb) return;
  const prisma = require('../../../db/src/client');
  const email = `aideg${Date.now()}@kosply.test`;
  const user = await prisma.user.create({
    data: {
      email,
      username: `aideg${Date.now()}`,
      name: 'AI Degradation',
      passwordHash: 'x',
      universitas: 'U',
      programStudi: 'P',
    },
    select: { id: true },
  });
  realUserId = user.id;
  realToken = jwt.sign({ sub: user.id, role: 'BUYER' }, env.jwtSecret);
});

after(async () => {
  if (!realUserId) return;
  const prisma = require('../../../db/src/client');
  await prisma.user.delete({ where: { id: realUserId } }).catch(() => {});
});

const authHeader = () => ({ authorization: `Bearer ${realToken}` });

describe('ai proxy auth', () => {
  test('conversations without token is 401', async () => {
    const res = await fetch(`${base}/api/ai/conversations`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
  });

  test('chat without token is 401', async () => {
    const res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'halo' }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
  });

  test('stream without token is 401', async () => {
    const res = await fetch(`${base}/api/ai/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'halo' }),
    });
    assert.equal(res.status, 401);
  });

  test('a correctly signed token for a user that does not exist is refused', { skip: !hasDb }, async () => {
    // The subject is never re-read from the token alone: a token minted for a
    // deleted or never-existing account must not pass as a live identity.
    const res = await fetch(`${base}/api/ai/conversations`, {
      headers: { authorization: `Bearer ${ghostToken()}` },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'TOKEN_REVOKED');
  });

  test('a frozen user is refused even with a live token', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    await prisma.user.update({ where: { id: realUserId }, data: { isActive: false } });
    try {
      const res = await fetch(`${base}/api/ai/conversations`, { headers: authHeader() });
      assert.equal(res.status, 401, 'isActive=false must take effect immediately');
      assert.equal((await res.json()).code, 'TOKEN_REVOKED');
    } finally {
      await prisma.user.update({ where: { id: realUserId }, data: { isActive: true } });
    }
  });
});

describe('ai proxy degradation', () => {
  test('conversations without DB is 503 DB_UNAVAILABLE', { skip: Boolean(process.env.DATABASE_URL) }, async () => {
    const res = await fetch(`${base}/api/ai/conversations`, { headers: authHeader() });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'DB_UNAVAILABLE');
  });

  test('chat with dead agent is 503 AGENT_UNAVAILABLE', async () => {
    const res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ message: 'halo', ui_state: { screen: 'catalog' } }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'AGENT_UNAVAILABLE');
  });

  test('stream with dead agent is 503 AGENT_UNAVAILABLE', async () => {
    const res = await fetch(`${base}/api/ai/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ message: 'halo' }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'AGENT_UNAVAILABLE');
  });

  test('history with dead agent is 503 AGENT_UNAVAILABLE', async () => {
    const res = await fetch(`${base}/api/ai/history/c1`, { headers: authHeader() });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'AGENT_UNAVAILABLE');
  });

  test('wait without token is 401', async () => {
    const res = await fetch(`${base}/api/ai/wait/c1?timeout=1`);
    assert.equal(res.status, 401);
  });

  test('wait with dead agent is 503 AGENT_UNAVAILABLE', async () => {
    const res = await fetch(`${base}/api/ai/wait/c1?timeout=1`, { headers: authHeader() });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'AGENT_UNAVAILABLE');
  });
});

describe('conversations live', () => {
  test('lists own sessions newest-first, scoped per user', { skip: !process.env.DATABASE_URL }, async () => {
    const prisma = require('../../../db/src/client');
    const uid = `hist-${Date.now()}`;
    const other = `hist-other-${Date.now()}`;
    try {
      for (const [id, email] of [[uid, `${uid}@kosply.test`], [other, `${other}@kosply.test`]]) {
        await prisma.user.create({
          data: {
            id, email, username: id, name: 'Hist Test', passwordHash: 'test',
            universitas: 'U', programStudi: 'P',
          },
        });
      }
      await prisma.aiConversation.createMany({
        data: [
          { id: `${uid}-old`, userId: uid, title: 'old', lastMessageAt: new Date(Date.now() - 3600_000) },
          { id: `${uid}-new`, userId: uid, title: 'new', lastMessageAt: new Date() },
          { id: `${other}-x`, userId: other, title: 'stranger' },
        ],
      });
      await prisma.aiMessage.create({
        data: { id: `${uid}-m1`, conversationId: `${uid}-new`, role: 'USER', content: 'halo' },
      });
      const mine = jwt.sign({ sub: uid, role: 'BUYER' }, env.jwtSecret);
      const res = await fetch(`${base}/api/ai/conversations`, {
        headers: { authorization: `Bearer ${mine}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(
        body.items.map((i) => i.id),
        [`${uid}-new`, `${uid}-old`]
      );
    } finally {
      await prisma.aiMessage.deleteMany({ where: { conversationId: { startsWith: uid } } });
      await prisma.aiConversation.deleteMany({ where: { id: { startsWith: uid } } });
      await prisma.aiConversation.deleteMany({ where: { id: { startsWith: other } } });
      await prisma.user.deleteMany({ where: { id: { in: [uid, other] } } });
    }
  });
});
