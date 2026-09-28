/**
 * @title Support API tests (tickets + replies + internal notes)
 * @notice Internal notes stay hidden from reporters; live parts skip without DATABASE_URL.
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
  name: 'Support Test',
  password: 'secret123',
  universitas: 'U',
  programStudi: 'P',
});

describe('support live', () => {
  test('open -> reply -> internal hidden -> close', { skip: !hasDb }, async () => {
    const prisma = require('../../../db/src/client');
    const tag = `s${Date.now()}`;
    const adminTag = `sa${Date.now()}`;
    let ticketId;
    try {
      const reg = await call('POST', '/api/auth/register', person(tag));
      const token = reg.body.token;
      await call('POST', '/api/auth/register', person(adminTag));
      await prisma.user.update({ where: { email: `${adminTag}@kosply.test` }, data: { role: 'ADMIN' } });
      const adminLogin = await call('POST', '/api/auth/login', {
        email: `${adminTag}@kosply.test`,
        password: 'secret123',
      });
      const adminToken = adminLogin.body.token;

      const opened = await call(
        'POST',
        '/api/support/tickets',
        { category: 'AKUN', subject: 'login gagal', description: 'tidak bisa masuk' },
        token
      );
      assert.equal(opened.status, 201);
      assert.match(opened.body.item.ticketNo, /^KSP-/);
      ticketId = opened.body.item.id;

      await call('POST', `/api/support/tickets/${ticketId}/messages`, { text: 'tolong!' }, token);
      await call(
        'POST',
        `/api/support/tickets/${ticketId}/messages`,
        { text: 'cek dulu', isInternal: true },
        adminToken
      );
      await call(
        'POST',
        `/api/support/tickets/${ticketId}/messages`,
        { text: 'coba reset password ya' },
        adminToken
      );

      const asUser = await call('GET', `/api/support/tickets/${ticketId}`, undefined, token);
      assert.equal(asUser.status, 200);
      assert.equal(asUser.body.item.messages.length, 2);
      assert.ok(asUser.body.item.messages.every((m) => !m.isInternal));

      const asAdmin = await call('GET', `/api/support/tickets/${ticketId}`, undefined, adminToken);
      assert.equal(asAdmin.body.item.messages.length, 3);

      const closed = await call('POST', `/api/support/tickets/${ticketId}/close`, {}, token);
      assert.equal(closed.status, 200);
      assert.equal(closed.body.item.status, 'CLOSED');
    } finally {
      if (ticketId) await prisma.supportMessage.deleteMany({ where: { ticketId } });
      if (ticketId) await prisma.supportTicket.deleteMany({ where: { id: ticketId } });
      await prisma.user.deleteMany({ where: { email: { in: [`${tag}@kosply.test`, `${adminTag}@kosply.test`] } } });
    }
  });
});
