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
});

/**
 * @notice Closes the HTTP server gracefully, then exits.
 * @dev Falls back to a forced exit after 10s if connections hang.
 * @dev Fatal errors (uncaughtException/unhandledRejection) also funnel
 * @dev here so PM2 restarts a clean process instead of running undefined state.
 * @param {string} signal The received signal or fatal reason.
 * @return {void}
 */
const shutdown = (signal) => {
  console.log(`Received ${signal}, closing server...`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // Force exit when hanging.
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
  shutdown('uncaughtException');
});
