#!/usr/bin/env node
/**
 * @title Drift check (migration history vs the column registry)
 * @notice Replays the migrations into a scratch database and compares the
 * @notice resulting columns against `lib/db/src/schema.js`.
 * @dev Answers two questions in both directions:
 * @dev  1. Does every column the application reads or writes exist in a
 * @dev     database built purely from the committed migrations? A "no" here is
 * @dev     the latent "column does not exist" that only surfaces the first time
 * @dev     that code path runs against production.
 * @dev  2. Does every column in that database appear in the registry? A "no"
 * @dev     means a table grew a column nobody declared — the same drift in the
 * @dev     other direction, and the one that later reads as "why is this null?".
 * @dev The scratch database is left in place on failure so it can be inspected
 * @dev rather than re-created blind.
 */
const mysql = require('mysql2/promise');
const { TABLES } = require('./schema');
const { compare } = require('./compare');
const migrate = require('./migrate');

/**
 * @notice Run the whole check.
 * @param {string} url Scratch database connection string.
 * @return {Promise<void>} Exits 0 with no drift, 2 with drift, 1 on error.
 */
const main = async (url) => {
  if (!url) throw new Error('SHADOW_DATABASE_URL (or DATABASE_URL) is required');

  await migrate.deploy(url, { skipChecks: true, quiet: true });

  const parsed = new URL(url);
  const connection = await mysql.createConnection({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  let problems;
  try {
    problems = await compare(connection, TABLES);
  } finally {
    await connection.end();
  }

  if (problems.length === 0) {
    console.log(`  no drift: ${Object.keys(TABLES).length} tables match the migration history`);
    return;
  }
  for (const problem of problems) console.error(`  drift: ${problem}`);
  console.error(`\n  ${problems.length} problem(s). The migrations and lib/db/src/schema.js disagree.`);
  process.exit(2);
};

main(process.argv[2]).catch((err) => {
  console.error(`drift check failed: ${err.message}`);
  process.exit(1);
});