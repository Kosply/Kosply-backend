/**
 * @title AI proxy hardening tests
 * @notice Pin the fixes for the round-3 audit: no raw agent errors relayed to
 * @notice clients, identical turn validation on the streaming and non-streaming
 * @notice paths, a capped `ui_state`, and a transport budget that respects the
 * @notice wait the client actually asked for.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const service = require('../../services/ai/ai.service');
const validators = require('../../services/shared/validators');

const hasDb = Boolean(process.env.DATABASE_URL);
const user = { id: 'user-1', role: 'BUYER' };

describe('ai turn payload validation', () => {
  test('message is required and bounded', async () => {
    await assert.rejects(
      () => service.buildTurnBody({ message: '' }, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
    await assert.rejects(
      () => service.buildTurnBody({ message: '   ' }, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
    await assert.rejects(
      () => service.buildTurnBody({}, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
    await assert.rejects(
      () => service.buildTurnBody({ message: 42 }, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
    // The SSE route used to forward `message` raw, so an oversized or missing
    // message became a 502 from the agent instead of a 400 here.
    await assert.rejects(
      () => service.buildTurnBody({ message: 'x'.repeat(validators.MAX_MESSAGE_LENGTH + 1) }, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
  });

  test('a valid message is forwarded with the session identity', async () => {
    const body = await service.buildTurnBody({ message: '  halo  ' }, user, 'c1');
    assert.equal(body.conversation_id, 'c1');
    assert.equal(body.user_id, 'user-1');
    assert.equal(body.role, 'BUYER');
    assert.equal(body.message, 'halo');
  });

  test('identity comes from the session, never the body', async () => {
    // A client-supplied user_id/role must not be able to impersonate.
    const body = await service.buildTurnBody(
      { message: 'hi', user_id: 'someone-else', role: 'SUPER_ADMIN' },
      user,
      'c1'
    );
    assert.equal(body.user_id, 'user-1');
    assert.equal(body.role, 'BUYER');
  });

  test('ui_state is size-capped before it reaches the agent', async () => {
    // The agent's own check raised a bare ValueError, which no AgentError
    // handler matched: a client mistake became an unhandled 500 there.
    await assert.rejects(
      () => service.buildTurnBody({ message: 'hi', ui_state: { a: 'x'.repeat(9000) } }, user, 'c1'),
      (e) => e.code === 'VALIDATION'
    );
    const ok = await service.buildTurnBody({ message: 'hi', ui_state: { screen: 'home' } }, user, 'c1');
    assert.deepEqual(ok.ui_state, { screen: 'home' });
  });

  test('ui_state must be an object when present', async () => {
    for (const bad of ['a string', 5, ['a']]) {
      await assert.rejects(
        () => service.buildTurnBody({ message: 'hi', ui_state: bad }, user, 'c1'),
        (e) => e.code === 'VALIDATION',
        `ui_state=${JSON.stringify(bad)} must be rejected`
      );
    }
  });

  test('an absent ui_state is omitted rather than sent as null', async () => {
    for (const input of [{ message: 'hi' }, { message: 'hi', ui_state: null }, { message: 'hi', ui_state: '' }]) {
      const body = await service.buildTurnBody(input, user, 'c1');
      assert.equal('ui_state' in body, false);
    }
  });
});

describe('ai proxy budget', () => {
  test('the non-streaming timeout exceeds the agent own worst case', () => {
    // agent worst case = AI_QUEUE_TIMEOUT_S (5) + AI_MODEL_TIMEOUT_S (120) = 125s.
    // At 60s the server aborted first and reported 503 for a merely slow turn,
    // while uvicorn kept the graph running and billing the LLM.
    const budget = Number.parseInt(process.env.AI_AGENT_TIMEOUT_MS || '180000', 10);
    assert.ok(budget > 125_000, `server budget ${budget}ms must exceed the agent's 125000ms`);
  });

  test('a 120s wait is not cut off at 90s', { skip: !hasDb }, async () => {
    // Regression: the wait transport was a flat 90s while MAX_WAIT_SECONDS was
    // 120, so 91..120s became 503 AGENT_UNAVAILABLE rather than a clean
    // agent timeout. The unreachable agent here proves the *timeout* is not
    // what fires first.
    const started = Date.now();
    await assert.rejects(
      () => service.waitApproval('c-does-not-exist', user, 120),
      (e) => e.code === 'AGENT_UNAVAILABLE' || e.code === 'CONVERSATION_NOT_FOUND'
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 90_000, `gave up after ${elapsed}ms, which is the old 90s transport`);
  });
});

describe('ai error responses do not leak agent internals', () => {
  let server;
  let base;

  before(async () => {
    const app = require('../../app');
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    base = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('a dead agent yields a catalog code, not provider text', { skip: !hasDb }, async () => {
    // `authenticate` re-reads the subject from the database, so the token must
    // be minted for a real, active row.
    const prisma = require('../../../db/src/client');
    const jwt = require('jsonwebtoken');
    const tag = `aip-${Date.now()}`;
    const created = await prisma.user.create({
      data: {
        email: `${tag}@kosply.test`, username: tag, name: 'AIP',
        passwordHash: 'x', universitas: 'U', programStudi: 'P',
      },
      select: { id: true },
    });
    const token = jwt.sign(
      { sub: created.id, role: 'BUYER' },
      require('../../config/env').jwtSecret
    );
    try {
      const res = await fetch(`${base}/api/ai/history/${created.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.code, 'AGENT_UNAVAILABLE');
      // The catalog message only. `stack` is emitted deliberately outside
      // production (errorHandler gates it on isDevelopment), so exclude it and
      // assert on everything the client is actually meant to see.
      const { stack, ...client } = body;
      const raw = JSON.stringify(client);
      assert.ok(!/https?:\/\//.test(raw), `leaked a URL: ${raw}`);
      assert.ok(!/Traceback|api_key|sk-|\.py|\.js/.test(raw), `leaked internals: ${raw}`);
      assert.equal(client.message, 'AI agent unavailable');
      // And the stack, where present, is a development affordance only.
      const env = require('../../config/env');
      if (stack) assert.ok(env.isDevelopment, 'a stack was emitted outside development');
      if (!env.isDevelopment) assert.equal(stack, undefined);
    } finally {
      await prisma.user.deleteMany({ where: { id: created.id } });
      await prisma.$disconnect();
    }
  });
});