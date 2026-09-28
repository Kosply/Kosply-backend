/**
 * @title Prisma client tests
 * @notice The singleton holds under repeated requires (PM2 cluster safety).
 * @dev Skips when `@prisma/client` is not installed (e.g. root-only CI).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const generated = path.join(__dirname, '..', 'node_modules', '@prisma', 'client');

describe('prisma client', () => {
  test('same instance across requires', { skip: !fs.existsSync(generated) }, () => {
    const first = require('../src/client');
    delete require.cache[require.resolve('../src/client')];
    const second = require('../src/client');
    assert.equal(first, second, 'globalThis cache must survive module reloads');
  });
});
