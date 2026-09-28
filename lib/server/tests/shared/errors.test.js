/**
 * @title Error catalog tests
 * @notice Covers code-table integrity, ApiError behavior, and middleware output.
 * @dev Runs with the built-in runner: `npm test`. No dependencies, no database.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { CODES, ApiError, throwError } = require('../../middlewares/errorCatalog');
const errorHandler = require('../../middlewares/errorHandler');
const notFound = require('../../middlewares/notFound');

const makeRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return { json: (body) => {
      res.body = body;
    } };
  };
  return res;
};

describe('error catalog', () => {
  test('every code has a numeric status and a message', () => {
    for (const [code, entry] of Object.entries(CODES)) {
      assert.ok(Number.isInteger(entry.status), code);
      assert.ok(entry.message.length > 0, code);
    }
  });

  test('ApiError carries code, statusCode, and message', () => {
    const err = new ApiError('PRODUCT_NOT_FOUND');
    assert.equal(err.code, 'PRODUCT_NOT_FOUND');
    assert.equal(err.statusCode, 404);
    assert.equal(err.message, 'Product not found');
  });

  test('ApiError supports message and details overrides', () => {
    const err = new ApiError('VALIDATION', { message: 'custom', details: { f: 1 } });
    assert.equal(err.message, 'custom');
    assert.deepEqual(err.details, { f: 1 });
    assert.equal(err.statusCode, 400);
  });

  test('ApiError falls back to INTERNAL for unknown codes', () => {
    const err = new ApiError('NOPE');
    assert.equal(err.code, 'INTERNAL');
    assert.equal(err.statusCode, 500);
  });

  test('throwError always throws the catalog error', () => {
    assert.throws(() => throwError('USER_NOT_FOUND'), /User not found/);
  });
});

describe('errorHandler', () => {
  test('catalog errors render code and status', () => {
    const res = makeRes();
    errorHandler(new ApiError('DB_UNAVAILABLE'), {}, res, () => {});
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.status, 'error');
    assert.equal(res.body.code, 'DB_UNAVAILABLE');
  });

  test('plain errors render 500 INTERNAL', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL');
    assert.equal(res.body.message, 'boom');
  });
});

describe('notFound', () => {
  test('unknown routes render 404 ROUTE_NOT_FOUND', () => {
    const res = makeRes();
    notFound({ originalUrl: '/nope' }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'ROUTE_NOT_FOUND');
  });
});
