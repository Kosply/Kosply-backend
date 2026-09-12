/**
 * @title Kosply environment loader
 * @notice Loads runtime configuration from the process environment.
 * @dev Values are resolved in this order: PM2 env > `.env` file (dotenv)
 * @dev > hardcoded defaults. dotenv never overrides existing variables,
 * @dev so PM2 `env` blocks always win over the `.env` file.
 */
require('dotenv').config();

const env = {
  /** @notice Runtime mode: development | staging | production. */
  nodeEnv: process.env.NODE_ENV || 'development',
  /** @notice HTTP port the server listens on. */
  port: parseInt(process.env.PORT, 10) || 3000,
  /** @notice Allowed CORS origin, or comma-separated list, or `*`. */
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

module.exports = env;
