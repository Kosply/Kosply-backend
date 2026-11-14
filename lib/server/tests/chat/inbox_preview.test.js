/**
 * @title Inbox preview tests (members, last bubble, unread count)
 * @notice What the Flutter inbox row renders without opening the thread.
 * @dev Live only. The seller is a fixture; the buyer registers through the API
 * @dev so both sides hold real tokens.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../app');
const { cleanup, createApprovedSeller, createProduct } = require('../../../db/src/testkit');

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

describe('inbox preview live', () => {
  test('rows carry both members, the newest bubble and a per-viewer unread count', { skip: !hasDb }, async () => {
    const seller = await createApprovedSeller({ photo: 'https://cdn.test/seller.png' });
    const tag = `ib${Date.now()}`;
    let buyerId;
    try {
      const product = await createProduct(seller.id, {
        description: 'Untuk pengujian.',
        price: 10_000,
        stock: 1,
      });
      const reg = await call('POST', '/api/auth/register', {
        email: `${tag}@kosply.test`,
        username: tag,
        name: 'Inbox Buyer',
        password: 'secret123',
        universitas: 'U',
        programStudi: 'P',
      });
      buyerId = reg.body.user.id;
      const token = reg.body.token;

      const opened = await call('POST', '/api/conversations', { productId: product.id, message: { text: 'halo' } }, token);
      assert.equal(opened.status, 201);
      const room = opened.body.item;
      assert.equal(room.seller.id, seller.id, 'an opened room names the seller');
      assert.equal(room.buyer.id, buyerId);

      const second = await call(
        'POST',
        `/api/conversations/${room.id}/messages`,
        { type: 'TEXT', text: 'masih ada?' },
        token
      );
      assert.equal(second.status, 201);

      const inbox = await call('GET', '/api/conversations', undefined, token);
      const row = inbox.body.items.find((item) => item.id === room.id);
      assert.ok(row, 'the room is listed');
      assert.equal(row.seller.id, seller.id);
      assert.equal(row.seller.photo, 'https://cdn.test/seller.png');
      assert.equal(row.buyer.id, buyerId);
      assert.equal(row.seller.email, undefined);
      assert.equal(row.lastMessage.text, 'masih ada?');
      assert.equal(row.unreadCount, 0, 'the buyer owes no read receipt for their own bubbles');
      assert.equal(row._count.messages, 2);
    } finally {
      await cleanup([seller.id, buyerId].filter(Boolean));
    }
  });
});
