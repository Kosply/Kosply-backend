/**
 * @title Safe-select tests (leak prevention)
 * @notice Fails if any public select exposes a sensitive column.
 * @dev Runs with the built-in runner: `npm test`. No dependencies, no database.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  PUBLIC_SELLER_SELECT,
  PUBLIC_PRODUCT_LIST_SELECT,
  PUBLIC_PRODUCT_DETAIL_SELECT,
  PUBLIC_USER_SELECT,
  SELLER_ANALYTICS_PRODUCT_SELECT,
} = require('../src/selects');

/**
 * @dev Kept in sync with schema.prisma: anything that can identify a person,
 * @dev authenticate them, or hand out a private artefact must never appear in
 * @dev a select that feeds an HTTP response. Extend this list when a new
 * @dev sensitive column is added, not when a leak is found.
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

const keysDeep = (obj, out = []) => {
  for (const [key, value] of Object.entries(obj)) {
    out.push(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) keysDeep(value, out);
  }
  return out;
};

describe('public selects', () => {
  for (const [name, select] of Object.entries({
    PUBLIC_SELLER_SELECT,
    PUBLIC_PRODUCT_LIST_SELECT,
    PUBLIC_PRODUCT_DETAIL_SELECT,
    PUBLIC_USER_SELECT,
    SELLER_ANALYTICS_PRODUCT_SELECT,
  })) {
    test(`${name} exposes no sensitive column`, () => {
      const keys = keysDeep(select);
      for (const bad of FORBIDDEN) {
        assert.ok(!keys.includes(bad), `${name} leaks ${bad}`);
      }
    });
  }

  test('every exported select is covered by this guard', () => {
    const guards = new Set(Object.keys(require('../src/selects')));
    const covered = new Set([
      'PUBLIC_SELLER_SELECT',
      'PUBLIC_PRODUCT_LIST_SELECT',
      'PUBLIC_PRODUCT_DETAIL_SELECT',
      'PUBLIC_USER_SELECT',
      'SELLER_ANALYTICS_PRODUCT_SELECT',
    ]);
    const missing = [...guards].filter((key) => !covered.has(key));
    assert.deepEqual(missing, [], `unguarded select(s) added: ${missing.join(', ')}`);
  });

  test('detail select is a superset of the list select', () => {
    for (const key of Object.keys(PUBLIC_PRODUCT_LIST_SELECT)) {
      assert.ok(key in PUBLIC_PRODUCT_DETAIL_SELECT, `detail misses ${key}`);
    }
    assert.ok('description' in PUBLIC_PRODUCT_DETAIL_SELECT);
  });

  test('user select carries the role (agent persona needs it)', () => {
    assert.ok(PUBLIC_USER_SELECT.role);
  });
});
