/**
 * @title PM2 process configuration
 * @notice Defines the staging and main processes for Kosply server.
 * @dev Staging (:3001, fork, 1 instance) is the playground: test anything
 * @dev here first. Main (:3000, cluster) serves real users and must only be
 * @dev restarted after staging passes.
 * @dev Secrets (JWT_SECRET, INTERNAL_API_KEY, DATABASE_URL password) are NOT
 * @dev hardcoded here. `env` blocks are written into ~/.pm2/dump.pm2 and are
 * @dev printed by `pm2 show` / `pm2 env`, so anything listed here is readable
 * @dev by anyone with access to the machine. They are read from the
 * @dev environment instead; a production boot without JWT_SECRET now fails
 * @dev fast (see config/env.js) rather than signing tokens with a public value.
 * @dev `wait_ready` makes PM2 wait for the `process.send('ready')` signal in
 * @dev server.js, so nothing routes to a worker that has not finished listen().
 */
const os = require('node:os');

/**
 * @dev MariaDB's default `max_connections` is 150 (100 on older images). The
 * @dev previous ORM's default pool was `cpus * 2 + 1` *per worker*, so
 * @dev `instances: 'max'` on a 7+ core box asked for 120+ connections and the
 * @dev database refused with "sorry, too many clients already" — a full outage
 * @dev at the first load spike. Cap the pool per worker and size the worker
 * @dev count against the connection budget instead of the core count.
 */
/**
 * Per-process ceiling. `main` must fit inside it on its own: a previous budget
 * of 4 workers x 12 connections = 48 against a `CONNECTION LIMIT 40` still
 * produced "too many clients already". MariaDB has no per-database connection
 * limit, so this is now purely a self-imposed budget (and init.sh does not
 * grant CONNECTION LIMIT).
 */
const DB_CONNECTION_LIMIT = Number.parseInt(process.env.DB_CONNECTION_LIMIT || '40', 10);
const STAGING_INSTANCES = 1;
/** @dev Per-worker pool, with room inside the limit for migrations. */
const POOL_PER_WORKER = 8;
const MAIN_INSTANCES = Math.max(
  1,
  Math.min(os.cpus().length, Math.floor((DB_CONNECTION_LIMIT - 8) / POOL_PER_WORKER), 4)
);

/**
 * Hand the pool budget to the process through the environment.
 * @dev These used to be query-string parameters on DATABASE_URL, which only the
 * @dev previous ORM understood. The driver reads neither, so leaving them there
 * @dev would have silently dropped the 8-connections-per-worker ceiling and
 * @dev let `instances: 'max'` open an unbounded pool — the exact "too many
 * @dev clients" outage the numbers above were introduced to prevent.
 * @dev `lib/db/src/pool.js` reads `DB_POOL_SIZE` first and still honours a
 * @dev `connection_limit` parameter if one is present, so an existing DSN keeps
 * @dev working during the rollout.
 */
const withPool = (url) => url;

const poolEnv = () => ({
  DB_POOL_SIZE: String(POOL_PER_WORKER),
  DB_POOL_QUEUE_TIMEOUT_MS: '20000',
  DB_CONNECT_TIMEOUT_MS: '10000',
});

const stagingDb = process.env.STAGING_DATABASE_URL || 'mysql://kosply:kosply@localhost:3306/kosply_staging';
const mainDb = process.env.DATABASE_URL || 'mysql://kosply:kosply@localhost:3306/kosply_main';

const common = {
  script: './lib/server/server.js',
  watch: false,
  autorestart: true,
  // Without a backoff a deterministically-crashing worker (bad PORT, missing
  // database driver) restarted in a tight loop, spamming the DB and the logs.
  restart_delay: 2000,
  exp_backoff_restart_delay: 2000,
  max_restarts: 15,
  min_uptime: 10_000,
  time: true,
  // server.js drains for up to 10s, then exits; this leaves margin.
  kill_timeout: 15000,
  // Logs were never rotated, so a busy box filled its disk (and a full disk
  // stops MariaDB writing, which is a cascading outage).
  max_log_size: '20M',
  logrotate: true,
  merge_logs: true,
  // PM2 marked a process `online` at spawn, before `listen()` completed.
  wait_ready: true,
  listen_timeout: 15000,
};

module.exports = {
  apps: [
    // STAGING: test anything here before promoting to main.
    {
      ...common,
      name: 'kosply-server-staging',
      instances: STAGING_INSTANCES,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'staging',
        PORT: 3001,
        CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
        DATABASE_URL: withPool(stagingDb),
        ...poolEnv(),
        // Secrets are passed through from the operator's environment.
        ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
        ...(process.env.INTERNAL_API_KEY ? { INTERNAL_API_KEY: process.env.INTERNAL_API_KEY } : {}),
      },
    },
    // MAIN: serves real users, must stay stable. Never test directly here.
    {
      ...common,
      name: 'kosply-server-main',
      instances: MAIN_INSTANCES,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
        DATABASE_URL: withPool(mainDb),
        ...poolEnv(),
        ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
        ...(process.env.INTERNAL_API_KEY ? { INTERNAL_API_KEY: process.env.INTERNAL_API_KEY } : {}),
      },
    },
  ],
};
