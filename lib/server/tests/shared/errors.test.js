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

  test('plain errors render 500 INTERNAL without leaking the message', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), { method: 'GET', originalUrl: '/x' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL');
    // A raw library/driver message must never reach the client: it can carry
    // table names, constraint names, DSN hosts and absolute file paths.
    // (`stack` is a separate, dev-only affordance — see the staging test.)
    assert.equal(res.body.message, 'Internal Server Error');
  });

  test('an untrusted err.status cannot choose the response status', () => {
    const res = makeRes();
    const err = new Error('nope');
    err.status = 418;
    err.statusCode = 418;
    errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
    assert.equal(res.statusCode, 500, 'status must come from the catalog, not the error');
  });

  test('Prisma unique/FK/not-found codes map to catalog codes, not 500', () => {
    const cases = [
      ['P2002', 'CONFLICT_UNIQUE', 409],
      ['P2003', 'VALIDATION', 400],
      ['P2025', 'NOT_FOUND', 404],
      ['P1001', 'DB_UNAVAILABLE', 503],
    ];
    for (const [prismaCode, expectedCode, expectedStatus] of cases) {
      const res = makeRes();
      const err = new Error('driver detail that must not leak');
      err.code = prismaCode;
      errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
      assert.equal(res.body.code, expectedCode, `${prismaCode} -> ${expectedCode}`);
      assert.equal(res.statusCode, expectedStatus);
      assert.ok(!res.body.message.includes('driver detail'));
    }
  });

  test('body-parser rejections keep their 4xx status and get a 4xx code', () => {
    const cases = [
      ['entity.parse.failed', 400, 'MALFORMED_REQUEST'],
      ['entity.too.large', 413, 'PAYLOAD_TOO_LARGE'],
      ['parameters.too.large', 413, 'PAYLOAD_TOO_LARGE'],
      ['charset.unsupported', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ];
    for (const [type, expectedStatus, expectedCode] of cases) {
      const res = makeRes();
      const err = new Error('{"password":"hunter2","a":}');
      err.type = type;
      err.status = expectedStatus;
      errorHandler(err, { method: 'POST', originalUrl: '/x' }, res, () => {});
      assert.equal(res.statusCode, expectedStatus, type);
      assert.equal(res.body.code, expectedCode, type);
      assert.ok(!res.body.message.includes('hunter2'), 'request body must not be echoed');
    }
  });

  test('a response already in flight is handed back to express', () => {
    const res = makeRes();
    res.headersSent = true;
    let forwarded = null;
    errorHandler(new Error('late'), {}, res, (err) => {
      forwarded = err;
    });
    assert.equal(forwarded.message, 'late', 'must call next(err) instead of res.status()');
    assert.equal(res.body, undefined, 'must not write a second response');
  });

  test('staging is treated like production: no stack, no driver or body detail', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging';
    delete require.cache[require.resolve('../../config/env')];
    try {
      const env = require('../../config/env');
      assert.equal(env.isDevelopment, false, 'staging is a real deploy holding real data');

      const plain = makeRes();
      errorHandler(new Error('driver said: relation "users" does not exist'), { method: 'GET', originalUrl: '/x' }, plain, () => {});
      assert.equal(plain.body.stack, undefined, 'no stack outside development');

      // A malformed-JSON error carries the request body on `err.message`;
      // staging must not reflect it back to the caller.
      const parse = makeRes();
      const err = new Error('Unexpected token } in JSON at position 40 ... {"password":"hunter2"}');
      err.type = 'entity.parse.failed';
      err.status = 400;
      errorHandler(err, { method: 'POST', originalUrl: '/x' }, parse, () => {});
      assert.equal(parse.body.code, 'MALFORMED_REQUEST');
      assert.ok(!JSON.stringify(parse.body).includes('hunter2'), 'body must not be echoed');
    } finally {
      process.env.NODE_ENV = previous;
      delete require.cache[require.resolve('../../config/env')];
    }
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
