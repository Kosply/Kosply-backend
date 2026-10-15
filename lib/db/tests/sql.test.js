/**
 * @title SQL builder tests
 * @notice Pins the generated SQL so a precedence or injection slip is caught
 * @dev here rather than as wrong data on a live endpoint.
 * @dev No database and no driver: these assert the strings the builder emits.
 * @dev The cases below are all ones that once produced *valid SQL with the
 * @dev wrong meaning*, which is why they are worth asserting literally.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAggregate,
  buildCount,
  buildDelete,
  buildIncrement,
  buildInsert,
  buildSelect,
  buildUpdate,
} = require('../src/sql');

const FROM = new Date('2026-01-01T00:00:00.000Z');

describe('operator precedence', () => {
  test('an OR group is parenthesised when combined with other keys', () => {
    const { sql } = buildSelect('products', {
      where: {
        sellerId: 'seller-1',
        OR: [{ createdAt: { gte: FROM } }, { soldAt: { gte: FROM } }],
      },
    });
    // Without the parentheses this reads `(sellerId AND createdAt) OR soldAt`
    // and returns other sellers' listings.
    assert.match(sql, /`sellerId` = \? AND \(`createdAt` >= \? OR `soldAt` >= \?\)/);
  });

  test('an AND group is parenthesised when combined with other keys', () => {
    const { sql } = buildSelect('users', {
      where: { isActive: true, OR: [{ role: 'SELLER' }, { role: 'ADMIN' }] },
    });
    assert.match(sql, /`isActive` = \? AND \(`role` = \? OR `role` = \?\)/);
  });

  test('nested OR inside OR stays grouped', () => {
    const { sql } = buildSelect('users', {
      where: { OR: [{ id: 'a' }, { OR: [{ role: 'ADMIN' }, { role: 'SUPER_ADMIN' }] }] },
    });
    assert.match(sql, /\(`id` = \? OR \(`role` = \? OR `role` = \?\)\)/);
  });

  test('NOT negates only its own branch', () => {
    const { sql } = buildSelect('messages', {
      where: { conversationId: 'c1', NOT: [{ isRead: true }] },
    });
    assert.match(sql, /`conversationId` = \? AND NOT \(`isRead` = \?\)/);
  });

  test('several range operators on one column are ANDed', () => {
    const { sql } = buildSelect('messages', {
      where: { createdAt: { gte: FROM, lte: FROM } },
    });
    assert.match(sql, /\(`createdAt` >= \? AND `createdAt` <= \?\)/);
  });
});

describe('LIKE escaping', () => {
  test('wildcards in the needle are escaped, not honoured', () => {
    const { sql, params } = buildSelect('products', { where: { title: { contains: '100%' } } });
    assert.match(sql, /`title` LIKE \? ESCAPE/);
    assert.deepEqual(params, ['%100\\%%']);
  });

  test('underscores are escaped too', () => {
    const { params } = buildSelect('products', { where: { title: { contains: 'a_b' } } });
    assert.deepEqual(params, ['%a\\_b%']);
  });

  test('startsWith and endsWith build one-sided patterns', () => {
    assert.deepEqual(buildSelect('products', { where: { title: { startsWith: 'x' } } }).params, ['x%']);
    assert.deepEqual(buildSelect('products', { where: { title: { endsWith: 'x' } } }).params, ['%x']);
  });
});

describe('IN lists', () => {
  test('an empty IN selects nothing', () => {
    const { sql, params } = buildSelect('users', { where: { role: { in: [] } } });
    assert.match(sql, /1 = 0/);
    assert.deepEqual(params, []);
  });

  test('an empty NOT IN selects everything', () => {
    const { sql } = buildSelect('users', { where: { role: { notIn: [] } } });
    assert.match(sql, /1 = 1/);
  });

  test('values are bound, not interpolated', () => {
    const { sql, params } = buildSelect('users', { where: { id: { in: ["a' OR 1=1", 'b'] } } });
    assert.ok(!sql.includes('1=1'));
    assert.deepEqual(params, ["a' OR 1=1", 'b']);
  });
});

describe('null handling', () => {
  test('a null value becomes IS NULL', () => {
    assert.match(buildSelect('password_resets', { where: { consumedAt: null } }).sql, /`consumedAt` IS NULL/);
  });

  test('`not: null` becomes IS NOT NULL', () => {
    assert.match(
      buildSelect('tool_invocations', { where: { latencyMs: { not: null } } }).sql,
      /`latencyMs` IS NOT NULL/
    );
  });
});

describe('relation filters', () => {
  test('`some` becomes a correlated EXISTS, not a join', () => {
    const { sql } = buildSelect('products', { where: { events: { some: { type: 'CLICK' } } } });
    assert.match(sql, /EXISTS \(SELECT 1 FROM `product_events` WHERE `product_events`\.`productId` = `products`\.`id` AND `type` = \?\)/);
  });

  test('`none` negates the EXISTS', () => {
    const { sql } = buildSelect('products', { where: { events: { none: { type: 'CLICK' } } } });
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM `product_events`/);
  });

  test('a to-one relation filter is also an EXISTS', () => {
    const { sql } = buildSelect('messages', {
      where: { conversation: { productId: { in: ['p1'] } } },
    });
    assert.match(sql, /EXISTS \(SELECT 1 FROM `conversations` WHERE `conversations`\.`id` = `messages`\.`conversationId` AND `productId` IN \(\?\)\)/);
  });

  test('an unknown relation name is rejected rather than read as a column', () => {
    assert.throws(() => buildSelect('products', { where: { nope: { some: {} } } }), /Unknown column "nope"/);
  });
});

describe('column validation', () => {
  test('an unknown column throws before a query is sent', () => {
    assert.throws(() => buildSelect('users', { where: { emial: 'x' } }), /Unknown column "emial"/);
  });

  test('an unknown table throws', () => {
    assert.throws(() => buildSelect('user', {}), /Unknown table/);
  });

  test('ordering by an unknown column throws', () => {
    assert.throws(() => buildSelect('users', { orderBy: { nope: 'asc' } }), /Cannot order by unknown column/);
  });

  test('selecting an unknown column throws', () => {
    assert.throws(() => buildSelect('users', { columns: ['nope'] }), /Unknown column/);
  });
});

describe('writes', () => {
  test('insert generates a cuid2 for a missing id and stamps updatedAt', () => {
    const { sql, params, columns } = buildInsert('users', { email: 'a@b.c' });
    assert.match(sql, /INSERT INTO `users` \(/);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('updatedAt'));
    // updatedAt is a SQL expression, not a bound value.
    assert.match(sql, /CURRENT_TIMESTAMP\(3\)/);
    assert.equal(params.length, columns.length - 1);
  });

  test('insert does not overwrite a caller-supplied id', () => {
    const { params, columns } = buildInsert('users', { id: 'fixed', email: 'a@b.c' });
    assert.equal(columns[0], 'id');
    assert.equal(params[0], 'fixed');
  });

  test('insert skips undefined values instead of writing NULL', () => {
    const { columns } = buildInsert('users', { email: 'a@b.c', googleId: undefined });
    assert.ok(!columns.includes('googleId'));
  });

  test('update refreshes updatedAt automatically', () => {
    const { sql } = buildUpdate('users', { name: 'x' }, { where: { id: '1' } });
    assert.match(sql, /SET `name` = \?, `updatedAt` = CURRENT_TIMESTAMP\(3\)/);
  });

  test('an explicit updatedAt wins', () => {
    const stamp = new Date();
    const { sql, params } = buildUpdate('users', { updatedAt: stamp }, { where: { id: '1' } });
    assert.ok(!sql.includes('CURRENT_TIMESTAMP'));
    assert.ok(params.includes(stamp));
  });

  test('update on an empty payload is refused', () => {
    assert.throws(() => buildUpdate('users', {}, { where: { id: '1' } }), /no columns/);
  });

  test('increment is computed by the database', () => {
    const { sql } = buildIncrement('password_resets', { id: '1', attempts: 1 });
    assert.match(sql, /SET `attempts` = `attempts` \+ \?/);
  });

  test('increment refuses a non-integer column', () => {
    assert.throws(
      () => buildIncrement('products', { id: '1', title: 1 }),
      /not an integer column/
    );
  });

  test('increment lets extra conditions narrow the match', () => {
    const { sql } = buildIncrement('password_resets', { id: '1', attempts: 1 }, {
      where: { attempts: { lt: 5 } },
    });
    assert.match(sql, /WHERE `attempts` < \? AND `id` = \?/);
  });

  test('delete without a filter compiles, so callers are reviewed for it', () => {
    assert.equal(buildDelete('users', {}).sql, 'DELETE FROM `users`');
  });
});

describe('pagination and counts', () => {
  test('limit and offset are inlined as integers, never bound', () => {
    const { sql } = buildSelect('users', { limit: 10, offset: 20 });
    assert.match(sql, /LIMIT 10 OFFSET 20/);
  });

  test('a non-integer limit is ignored rather than interpolated', () => {
    const { sql } = buildSelect('users', { limit: '5; DROP TABLE users' });
    assert.ok(!sql.includes('DROP TABLE'));
  });

  test('orderBy accepts a composite list', () => {
    const { sql } = buildSelect('notifications', {
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    assert.match(sql, /ORDER BY `createdAt` DESC, `id` DESC/);
  });

  test('count emits a single aggregate', () => {
    assert.equal(
      buildCount('users', { where: { isActive: true } }).sql,
      'SELECT COUNT(*) AS count FROM `users` WHERE `isActive` = ?'
    );
  });
});

describe('aggregates', () => {
  test('groupBy with a count aggregates', () => {
    const { sql } = buildAggregate('product_events', {
      groupBy: ['productId', 'type'],
      where: { createdAt: { gte: FROM } },
      aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
    });
    assert.match(sql, /SELECT `productId`, `type`, COUNT\(\*\) AS `total` FROM `product_events`/);
    assert.match(sql, /GROUP BY `productId`, `type`/);
  });

  test('ordering addresses the output alias, not a base column', () => {
    const { sql } = buildAggregate('tool_invocations', {
      groupBy: ['tool'],
      aggregates: [{ fn: 'count', column: '*', alias: 'total' }],
      orderBy: [{ total: { dir: 'desc' } }],
      limit: 20,
    });
    assert.match(sql, /ORDER BY `total` DESC LIMIT 20/);
  });

  test('an unknown aggregate function is rejected', () => {
    assert.throws(
      () => buildAggregate('users', { aggregates: [{ fn: 'median', column: 'price' }] }),
      /Unsupported aggregate/
    );
  });

  test('an empty aggregate request is rejected', () => {
    assert.throws(() => buildAggregate('users', {}), /groupBy or an aggregate/);
  });
});

describe('row coercion', () => {
  const { castRow, fromDatabase, toDatabase } = require('../src/cast');

  test('BOOLEAN reads back as true/false, never 0/1', () => {
    // The single most damaging thing to get wrong: the API contract promises a
    // bool and the Flutter client types the field as one.
    assert.equal(fromDatabase('users', 'isActive', 1), true);
    assert.equal(fromDatabase('users', 'isActive', 0), false);
    assert.deepEqual(castRow('users', { id: 'x', isActive: 1 }).isActive, true);
  });

  test('BOOLEAN writes as 1/0', () => {
    assert.equal(toDatabase('users', 'isActive', true), 1);
    assert.equal(toDatabase('users', 'isActive', false), 0);
  });

  test('JSON columns parse, and a bad value does not take down the read', () => {
    assert.deepEqual(fromDatabase('products', 'imageUrls', '["a","b"]'), ['a', 'b']);
    assert.deepEqual(fromDatabase('products', 'imageUrls', '[]'), []);
    assert.equal(fromDatabase('products', 'imageUrls', 'not json'), 'not json');
  });

  test('JSON writes are stringified', () => {
    assert.equal(toDatabase('products', 'imageUrls', ['a']), '["a"]');
    assert.equal(toDatabase('products', 'imageUrls', { a: 1 }), '{"a":1}');
  });

  test('datetimes are read as UTC, not local time', () => {
    const value = fromDatabase('users', 'createdAt', '2026-01-02 03:04:05.123');
    assert.ok(value instanceof Date);
    assert.equal(value.toISOString(), '2026-01-02T03:04:05.123Z');
  });

  test('null survives every coercion', () => {
    for (const type of ['bool', 'date', 'int', 'float', 'json', 'str']) {
      assert.equal(fromDatabase('users', type === 'json' ? 'imageUrls' : type === 'str' ? 'name' : type, null), null);
    }
  });

  test('numbers come back as numbers', () => {
    assert.equal(fromDatabase('products', 'price', '50000'), 50000);
    assert.equal(fromDatabase('products', 'latitude', '0'), 0);
  });
});