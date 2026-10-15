/**
 * @title Safe-column tests (leak prevention)
 * @notice Fails if any public column list exposes a sensitive column.
 * @dev Runs with the built-in runner: `npm test`. No dependencies, no database.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  PUBLIC_SELLER_COLUMNS,
  PUBLIC_PRODUCT_LIST_COLUMNS,
  PUBLIC_PRODUCT_DETAIL_COLUMNS,
  PUBLIC_USER_COLUMNS,
  SELLER_ANALYTICS_PRODUCT_COLUMNS,
} = require('../src/selects');
const { TABLES } = require('../src/schema');

/**
 * @dev Anything that can identify a person, authenticate them, or hand out a
 * @dev private artefact must never appear in a column list that feeds an HTTP
 * @dev response. Extend this list when a new sensitive column is added, not
 * @dev when a leak is found.
 */
const FORBIDDEN = [
  'email',
  'passwordHash',
  'googleId',
  'appleId',
  'nim',
  'ktmImageUrl',
  'ticketNo',
  'reportNo',
  'namaLengkap',
  'codeHash',
  'isActive',
  'bio',
  'data',
  'reportedUserId',
  'reviewedBy',
];

const LISTS = {
  PUBLIC_SELLER_COLUMNS,
  PUBLIC_PRODUCT_LIST_COLUMNS,
  PUBLIC_PRODUCT_DETAIL_COLUMNS,
  PUBLIC_USER_COLUMNS,
  SELLER_ANALYTICS_PRODUCT_COLUMNS,
};

describe('public column lists', () => {
  for (const [name, columns] of Object.entries(LISTS)) {
    test(`${name} exposes no sensitive column`, () => {
      for (const column of columns) {
        assert.ok(!FORBIDDEN.includes(column), `${name} leaks ${column}`);
      }
    });
  }

  test('every exported list is covered by this guard', () => {
    const guards = new Set(Object.keys(require('../src/selects')));
    const missing = [...guards].filter((key) => !LISTS[key]);
    assert.deepEqual(missing, [], `unguarded list(s) added: ${missing.join(', ')}`);
  });

  test('detail list is a superset of the list list', () => {
    for (const column of PUBLIC_PRODUCT_LIST_COLUMNS) {
      assert.ok(PUBLIC_PRODUCT_DETAIL_COLUMNS.includes(column), `detail misses ${column}`);
    }
    assert.ok(PUBLIC_PRODUCT_DETAIL_COLUMNS.includes('description'));
  });

  test('user list carries the role (agent persona needs it)', () => {
    assert.ok(PUBLIC_USER_COLUMNS.includes('role'));
  });

  test('every listed column exists on its table', () => {
    // The registry is the single source of truth for column names, so a stale
    // list would otherwise only fail at request time, in production.
    const pairs = [
      [PUBLIC_SELLER_COLUMNS, 'users'],
      [PUBLIC_PRODUCT_LIST_COLUMNS, 'products'],
      [PUBLIC_PRODUCT_DETAIL_COLUMNS, 'products'],
      [PUBLIC_USER_COLUMNS, 'users'],
      [SELLER_ANALYTICS_PRODUCT_COLUMNS, 'products'],
    ];
    for (const [columns, table] of pairs) {
      for (const column of columns) {
        assert.ok(column in TABLES[table], `${table}.${column} is not in the registry`);
      }
    }
  });

  test('no list duplicates a column', () => {
    for (const [name, columns] of Object.entries(LISTS)) {
      assert.equal(new Set(columns).size, columns.length, `${name} repeats a column`);
    }
  });
});