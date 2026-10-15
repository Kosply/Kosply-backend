#!/usr/bin/env node
/**
 * @title Database CLI (deploy / status / reset / validate)
 * @notice Thin wrapper over `lib/db/src/migrate.js` and `lib/db/src/schema.js`.
 * @dev Exists so `scripts/db/db.sh` and CI call one stable entry point instead
 * @dev of embedding `node -e` snippets, which cannot be linted, cannot report a
 * @dev useful error, and grow unreadable the moment they need a second line.
 * @dev Reads DATABASE_URL from the environment, as everything else does.
 */
const { RELATIONS, TABLES } = require('./schema');
const migrate = require('./migrate');

/**
 * @notice Check the column registry for internal inconsistencies.
 * @dev Pure and offline: it cannot tell you a column is missing from the
 * @dev database, only that the registry disagrees with itself or names a table
 * @dev or relation that does not exist. `schema-diff.sh check` covers the rest.
 * @return {Array<string>} Problems found; empty means the registry is coherent.
 */
const validateRegistry = () => {
  const problems = [];
  // Table names are snake_case, columns are camelCase. Both are restricted to
  // identifier characters so a name can never need anything beyond backticks.
  const isTableIdent = /^[a-z][a-zA-Z0-9_]*$/;
  const isColumnIdent = /^[a-z][a-zA-Z0-9]*$/;

  for (const [table, columns] of Object.entries(TABLES)) {
    if (!isTableIdent.test(table)) problems.push(`table name "${table}" is not a plain identifier`);
    const names = Object.keys(columns).filter((name) => name !== '__primaryKey');
    if (names.length === 0) problems.push(`${table} declares no columns`);
    for (const column of names) {
      if (!isColumnIdent.test(column)) problems.push(`${table}.${column}: not a plain identifier`);
    }
    const primaryKey = columns.__primaryKey || ['id'];
    for (const column of primaryKey) {
      if (!names.includes(column)) problems.push(`${table}.__primaryKey names unknown column "${column}"`);
    }
    if (primaryKey.length === 1 && !names.includes('id') && !columns.__primaryKey) {
      problems.push(`${table} has no "id" and declares no __primaryKey`);
    }
    if (names.length !== new Set(names).size) problems.push(`${table} declares a column twice`);
  }

  for (const [table, edges] of Object.entries(RELATIONS)) {
    if (!TABLES[table]) {
      problems.push(`relations for "${table}", which is not a table`);
      continue;
    }
    for (const [name, edge] of Object.entries(edges)) {
      if (!TABLES[edge.table]) {
        problems.push(`${table}.${name} points at unknown table "${edge.table}"`);
        continue;
      }
      if (!(edge.from in TABLES[table])) {
        problems.push(`${table}.${name}.from ("${edge.from}") is not a column of ${table}`);
      }
      if (!(edge.to in TABLES[edge.table])) {
        problems.push(`${table}.${name}.to ("${edge.to}") is not a column of ${edge.table}`);
      }
    }
  }

  return problems;
};

/**
 * @notice Apply pending migrations.
 * @return {Promise<void>} Resolves on success.
 */
const deploy = async () => {
  const { applied, alreadyApplied } = await migrate.deploy(process.env.DATABASE_URL);
  if (applied.length) {
    for (const name of applied) console.log(`  applied ${name}`);
    console.log(`  ${alreadyApplied} migration(s) were already applied`);
  } else {
    console.log(`  nothing to apply (${alreadyApplied} migration(s) up to date)`);
  }
};

/**
 * @notice Print the applied/pending state of every migration.
 * @return {Promise<void>} Resolves on success.
 */
const status = async () => {
  const rows = await migrate.status(process.env.DATABASE_URL);
  for (const row of rows) {
    const when = row.applied ? `  ${new Date(row.appliedAt).toISOString()}` : '';
    console.log(`  ${row.applied ? 'applied' : 'PENDING'}  ${row.name}${when}`);
  }
  const pending = rows.filter((r) => !r.applied).length;
  console.log(`  ${rows.length - pending}/${rows.length} applied`);
};

/**
 * @notice Drop every table and re-apply all migrations.
 * @dev Refuses anything outside the dev/test allowlist, in `migrate.reset`.
 * @return {Promise<void>} Resolves on success.
 */
const reset = async () => {
  const applied = await migrate.reset(process.env.DATABASE_URL);
  for (const name of applied) console.log(`  applied ${name}`);
  console.log('  data-integrity constraints reapplied');
};

/**
 * @notice Entry point.
 * @return {Promise<void>} Resolves on success, exits 1 on failure.
 */
const main = async () => {
  const command = process.argv[2];
  switch (command) {
    case 'deploy':
      return deploy();
    case 'status':
      return status();
    case 'reset':
      return reset();
    case 'validate': {
      const problems = validateRegistry();
      if (problems.length) {
        for (const problem of problems) console.error(`  ${problem}`);
        process.exitCode = 1;
        return;
      }
      const relationCount = Object.values(RELATIONS).reduce((n, edges) => n + Object.keys(edges).length, 0);
      console.log(`  ${Object.keys(TABLES).length} tables, ${relationCount} relations: consistent`);
      return;
    }
    default:
      console.error('usage: node src/cli.js <deploy|status|reset|validate>');
      process.exitCode = 1;
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { validateRegistry };