/**
 * @title Schema comparison
 * @notice Compares a live database against the column registry.
 * @dev Shared by the drift gate and by migration adoption, so both answer
 * @dev "does this database match what the app expects?" with identical rules.
 * @dev Every problem is reported in both directions. A column the app reads but
 * @dev the database lacks is a runtime failure waiting for its first call; a
 * @dev column the database has but the registry does not is drift that later
 * @dev reads as an unexplained null.
 */

/** @dev Table holding LangGraph's checkpoint state, owned by the agent. */
const NON_APP_TABLES = new Set(['checkpoint_blobs', 'checkpoint_migrations', 'checkpoint_writes', 'checkpoints']);

/**
 * @notice Read the columns of a database.
 * @dev Bookkeeping and agent-owned tables are excluded: they are not part of the
 * @dev marketplace schema and would otherwise read as drift on every run.
 * @param {object} connection A connected mysql2 connection.
 * @return {Promise<Map<string, Set<string>>>} Table name to column names.
 */
const readColumns = async (connection) => {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const columns = new Map();
  for (const row of rows) {
    const table = row.t;
    if (table.startsWith('_') || NON_APP_TABLES.has(table)) continue;
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(row.c);
  }
  return columns;
};

/**
 * @notice Diff a database against the column registry.
 * @param {object} connection A connected mysql2 connection.
 * @param {object} registry Table definitions from `schema.js`.
 * @return {Promise<Array<string>>} Problems; empty means the two agree.
 */
const compare = async (connection, registry) => {
  const actual = await readColumns(connection);
  const problems = [];

  for (const [table, columns] of Object.entries(registry)) {
    if (!actual.has(table)) {
      problems.push(`${table}: declared in the registry but the database has no such table`);
      continue;
    }
    const present = actual.get(table);
    for (const column of Object.keys(columns)) {
      if (column === '__primaryKey') continue;
      if (!present.has(column)) {
        problems.push(`${table}.${column}: the app reads it, the database does not have it`);
      }
    }
  }

  for (const [table, present] of actual) {
    if (!registry[table]) {
      problems.push(`${table}: the database has it, the registry does not`);
      continue;
    }
    for (const column of present) {
      if (!(column in registry[table])) {
        problems.push(`${table}.${column}: the database has it, the registry does not`);
      }
    }
  }

  return problems;
};

module.exports = { NON_APP_TABLES, compare, readColumns };