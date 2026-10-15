/**
 * @title Migration runner
 * @notice Applies `schema/migrations/*.sql` in order, exactly once each.
 * @dev Replaces `prisma migrate deploy`. The migration files themselves did
 * @dev not change: they are already plain MariaDB DDL, which is the point of
 * @dev moving off an ORM — the tool that applies them is ours, the SQL is not
 * @dev ours to reinterpret.
 * @dev One folder per migration, named `<timestamp>_<slug>`, applied in name
 * @dev order. That ordering is the whole contract, so folder names must sort
 * @dev lexicographically by timestamp.
 * @dev **A migration is not atomic, and cannot be.** MariaDB implicitly commits
 * @dev before and after every DDL statement, so wrapping the file in
 * @dev `START TRANSACTION` does not make it roll back — a file that creates
 * @dev five tables and fails on the sixth leaves five tables behind. This was
 * @dev true of `prisma migrate deploy` on this engine too, so it is not a
 * @dev regression; it is a property of DDL in MariaDB.
 * @dev What the ledger *does* guarantee: a failed migration records no row, so
 * @dev the next run retries it rather than skipping it. The failure message
 * @dev names the tables the file would have created, so the operator can drop
 * @dev them before retrying — migrations must therefore be written to be safe
 * @dev to re-run (`CREATE TABLE IF NOT EXISTS`, or a corrective follow-up).
 * @dev Uses its own connection with `multipleStatements` enabled. The app's pool
 * @dev has that flag off on purpose — see `pool.js` — and must not inherit it,
 * @dev because stacked statements turn any injection point into a data leak.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createHash } = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'schema', 'migrations');
const CHECKS_FILE = path.join(__dirname, '..', 'docker', 'checks.sql');

/** @dev Bookkeeping table. Renamed from `_prisma_migrations` on purpose. */
const LEDGER = '_kosply_migrations';

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS \`${LEDGER}\` (
  \`name\` VARCHAR(191) NOT NULL,
  \`checksum\` CHAR(64) NOT NULL,
  \`appliedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`name\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

/**
 * @notice Open a one-shot administrative connection.
 * @dev `multipleStatements` is enabled here and only here.
 * @param {string} url Connection string.
 * @return {Promise<object>} A connected mysql2 connection.
 */
const connect = async (url) => {
  const parsed = new URL(url);
  return mysql.createConnection({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
};

/**
 * @notice List the migration files in application order.
 * @dev Sorted by folder name, which begins with the timestamp.
 * @return {Promise<Array<{name: string, file: string, sql: string, checksum: string}>>} Migrations.
 */
const readMigrations = async () => {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const migrations = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(MIGRATIONS_DIR, entry.name, 'migration.sql');
    const sql = await fs.readFile(file, 'utf8');
    migrations.push({
      name: entry.name,
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
};

/**
 * @notice List the application tables already present in the target database.
 * @dev Bookkeeping tables (`_…`) and the agent's LangGraph checkpoint tables
 * @dev are excluded, so an agent database that has only agent state still counts
 * @dev as empty and gets migrated normally.
 * @param {object} connection A connected mysql2 connection.
 * @return {Promise<Array<string>>} Table names.
 */
const existingAppTables = async (connection) => {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  const { NON_APP_TABLES } = require('./compare');
  return rows
    .map((row) => row.t)
    .filter((name) => !name.startsWith('_') && !NON_APP_TABLES.has(name));
};

/**
 * @notice Find the table names a migration file creates.
 * @dev Purely for the error message. A migration that fails part-way leaves
 * @dev those tables in place (DDL is implicitly committed), so the operator
 * @dev needs to be told exactly what to drop before retrying — otherwise the
 * @dev retry fails on `CREATE TABLE` for a table that already exists.
 * @param {string} sql Migration body.
 * @return {Array<string>} Table names, in the order they appear.
 */
const createdTables = (sql) => {
  const names = [];
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  let match = pattern.exec(sql);
  while (match) {
    names.push(match[1]);
    match = pattern.exec(sql);
  }
  return [...new Set(names)];
};

/**
 * @notice Apply every migration that has not run yet.
 * @dev Also re-applies `checks.sql` after the DDL, because those CHECK
 * @dev constraints cannot live in a migration: they need the tables to exist
 * @dev first, and `checks.sql` is written to be idempotent, so re-running it on
 * @dev every deploy is the intended behaviour.
 * @dev Adopts an already-migrated database instead of failing on it. When this
 * @dev project moved off an ORM it stopped maintaining its own bookkeeping
 * @dev table, so the first run against staging, main, or any container volume
 * @dev created before the move, found a fully-built schema and an empty ledger
 * @dev — and tried to `CREATE TABLE` on top of tables that already existed.
 * @dev Adoption only happens when the existing schema *agrees* with the column
 * @dev registry, column for column in both directions. A database that does not
 * @dev agree is reported and left alone: guessing would be how a staging
 * @dev environment silently loses data.
 * @dev Set `ADOPT=0` to disable it and fail on an untracked database instead.
 * @param {string} url Connection string.
 * @param {object} [opts] Options.
 * @param {boolean} [opts.skipChecks] Apply DDL only.
 * @param {boolean} [opts.quiet] Suppress progress output.
 * @return {Promise<{applied: string[], alreadyApplied: number, adopted: boolean}>} Summary.
 */
const deploy = async (url, opts = {}) => {
  const connection = await connect(url);
  const log = opts.quiet ? () => {} : (...args) => console.log(...args);
  try {
    await connection.query(LEDGER_DDL);
    const [rows] = await connection.query(`SELECT name, checksum FROM \`${LEDGER}\``);
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));

    const migrations = await readMigrations();
    let adopted = false;

    if (applied.size === 0) {
      const tables = await existingAppTables(connection);
      if (tables.length > 0) {
        if (String(process.env.ADOPT || '1') === '0') {
          throw new Error(
            `This database already holds ${tables.length} table(s) but has no migration ledger.\n` +
            '  Either the migrations were applied by another tool, or this is the wrong\n' +
            '  database. Re-run with ADOPT=1 to adopt it after checking the schema.'
          );
        }
        const { compare } = require('./compare');
        const problems = await compare(connection, require('./schema').TABLES);
        if (problems.length) {
          throw new Error(
            `Refusing to adopt this database: its schema does not match the column registry.\n` +
            problems.map((p) => `  ${p}`).join('\n') +
            '\n  Nothing was changed. Reconcile the difference before deploying.'
          );
        }
        for (const migration of migrations) {
          await connection.query('INSERT INTO `' + LEDGER + '` (`name`, `checksum`) VALUES (?, ?)', [
            migration.name,
            migration.checksum,
          ]);
        }
        adopted = true;
        log(`  adopted ${migrations.length} existing migration(s): the schema already matched`);
      }
    }

    const fresh = [];

    for (const migration of migrations) {
      const known = applied.get(migration.name);
      if (known === undefined && !adopted) {
        fresh.push(migration.name);
        continue;
      }
      // An edited migration that already ran on a live database means the
      // recorded schema and the file disagree. Re-applying is not safe and
      // ignoring it silently is how environments drift apart, so say so loudly.
      if (known !== undefined && known !== migration.checksum) {
        log(`  ! ${migration.name} was modified after it was applied — the ledger checksum differs`);
      }
    }

    for (const migration of migrations) {
      if (!fresh.includes(migration.name)) continue;
      try {
        await connection.query(migration.sql);
        await connection.query('INSERT INTO `' + LEDGER + '` (`name`, `checksum`) VALUES (?, ?)', [
          migration.name,
          migration.checksum,
        ]);
        log(`  applied ${migration.name}`);
      } catch (err) {
        // The ledger row is deliberately absent after a failure, so the next run
        // retries this migration instead of treating it as done. DDL cannot be
        // rolled back, so anything the file already created is still there.
        const tables = createdTables(migration.sql);
        const cleanup = tables.length
          ? ` Tables it creates: ${tables.join(', ')} — drop them before retrying:\n` +
            `    DROP TABLE ${tables.map((t) => `\`${t}\``).join(', ')};`
          : '';
        throw new Error(
          `${migration.name} failed at statement ${err.sql?.split(';')[0]?.slice(0, 120) || '(unknown)'}:\n` +
          `  ${err.message}\n` +
          '  MariaDB commits DDL implicitly, so this migration was NOT rolled back and was NOT recorded.\n' +
          '  Fix the file, clean up, then re-run.' +
          cleanup
        );
      }
    }

    if (!opts.skipChecks) {
      log('  applying docker/checks.sql');
      await connection.query(await fs.readFile(CHECKS_FILE, 'utf8'));
    }

    return { applied: fresh, alreadyApplied: migrations.length - fresh.length, adopted };
  } finally {
    await connection.end();
  }
};

/**
 * @notice Report which migrations have been applied.
 * @param {string} url Connection string.
 * @return {Promise<Array<{name: string, applied: boolean, appliedAt: string|null}>>} Per-migration state.
 */
const status = async (url) => {
  const connection = await connect(url);
  try {
    await connection.query(LEDGER_DDL);
    const [rows] = await connection.query(
      `SELECT name, appliedAt FROM \`${LEDGER}\` ORDER BY name`
    );
    const appliedAt = new Map(rows.map((row) => [row.name, row.appliedAt]));
    const migrations = await readMigrations();
    return migrations.map((migration) => ({
      name: migration.name,
      applied: appliedAt.has(migration.name),
      appliedAt: appliedAt.get(migration.name) || null,
    }));
  } finally {
    await connection.end();
  }
};

/**
 * @notice Drop every table in the current database, then re-apply everything.
 * @dev Destructive by design and guarded by an explicit database-name
 * @dev allowlist, the same guard the seed script uses. Foreign-key checks are
 * @dev disabled for the drop: the tables reference each other, so MariaDB
 * @dev refuses to drop them one at a time otherwise.
 * @param {string} url Connection string.
 * @param {string[]} allowedDatabases Database names this may run against.
 * @return {Promise<string[]>} Applied migrations after the reset.
 */
const reset = async (url, allowedDatabases = ['kosply_dev', 'kosply_test', 'test']) => {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  if (!allowedDatabases.includes(database)) {
    throw new Error(`Refusing to reset "${database}": expected one of ${allowedDatabases.join(', ')}`);
  }
  const connection = await connect(url);
  try {
    const [tables] = await connection.query(
      'SELECT table_name AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE"',
      [database]
    );
    const names = tables.map((row) => `\`${row.t}\``);
    if (names.length) {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query(`DROP TABLE ${names.join(', ')}`);
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  } finally {
    await connection.end();
  }
  const result = await deploy(url);
  return result.applied;
};

module.exports = { LEDGER, MIGRATIONS_DIR, deploy, readMigrations, reset, status };