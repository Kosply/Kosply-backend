/**
 * @title Schema validation tests
 * @notice `prisma validate` must pass (structure only, no connection).
 * @dev Skips when the Prisma CLI is missing (root-only CI) or DATABASE_URL
 * @dev is unset — the CLI requires the env var to exist even for validation.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cli = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const canRun = fs.existsSync(cli);

describe('prisma schema', () => {
  test('validate passes', { skip: !canRun }, () => {
    const out = execFileSync(cli, ['validate'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/validate-only' },
      encoding: 'utf-8',
    });
    assert.match(out, /valid/i);
  });
});
