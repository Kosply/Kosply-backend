/**
 * @title Kosply HTTP entrypoint
 * @notice Binds the Express app to a port and handles process signals.
 * @dev PM2 sends SIGTERM/SIGINT on restart/stop, so graceful shutdown
 * @dev keeps in-flight requests from being dropped in cluster mode.
 */
const app = require('./app');
const env = require('./config/env');

const server = app.listen(env.port, () => {
  console.log(`[kosply-backend] listening on :${env.port} [${env.nodeEnv}]`);
  // PM2 marks a process `online` at spawn. With `wait_ready: true` in the
  // ecosystem file it waits for this signal instead, so nothing routes to a
  // worker that has not finished `listen`.
  if (typeof process.send === 'function') process.send('ready');
});

// A bind failure (EADDRINUSE, EACCES) raises `error`, not `uncaughtException`
// with a non-zero exit. Without this the process used to exit 0, so PM2's
// `autorestart` loop never surfaced as `errored` and health checks stayed green.
server.on('error', (err) => {
  console.error(`[kosply-backend] HTTP server error: ${err.message}`);
  process.exit(1);
});

// Long approval waits (up to 25 min) must survive, but only on a bounded
// budget: `0` meant a Slowloris client could hold a socket forever at almost
// no CPU cost. 30 minutes covers the documented 25-minute AI wait with margin.
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 5 * 1000;

const SHUTDOWN_GRACE_MS = 10000;
let shuttingDown = false;

/**
 * @notice Close the HTTP server, drain the DB, then exit.
 * @dev Re-entrancy guarded: a late `unhandledRejection` after SIGTERM used to
 * @dev call `server.close()` again and arm a second force-exit timer.
 * @dev Sets `exitCode` and lets the loop drain rather than calling
 * @dev `process.exit()`, which under PM2 (piped stdout) truncated up to 70%
 * @dev of the log output written just before a restart.
 * @param {string} signal The received signal or fatal reason.
 * @param {number} [exitCode] Process exit code.
 * @return {void}
 */
const shutdown = (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, closing server...`);
  process.exitCode = exitCode;

  const forceTimer = setTimeout(() => {
    console.error(`[kosply-backend] forcing exit after ${SHUTDOWN_GRACE_MS}ms`);
    process.exit(exitCode || 1);
  }, SHUTDOWN_GRACE_MS);
  forceTimer.unref();

  // Destroy keep-alive sockets so `close()` can actually complete; otherwise a
  // single idle keep-alive connection keeps the callback pending forever.
  server.closeIdleConnections?.();

  server.close(async () => {
    clearTimeout(forceTimer);
    try {
      const { getPrisma } = require('./config/db');
      const prisma = getPrisma();
      if (prisma?.$disconnect) await prisma.$disconnect();
      console.log('HTTP server closed, database disconnected');
    } catch (err) {
      console.error('[kosply-backend] error while disconnecting the database:', err.message);
    }
    // Let stdout flush naturally now that exitCode is set.
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));

// A rejected promise is a bug, not a reason to keep serving: exit non-zero so
// PM2 restarts a clean process instead of running on in undefined state.
process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
  // An uncaughtException leaves the process state undefined; do not drain.
  process.exit(1);
});
