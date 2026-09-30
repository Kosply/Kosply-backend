/**
 * @title Kosply environment loader
 * @notice Loads runtime configuration from the process environment.
 * @dev Values are resolved in this order: PM2 env > `.env` file (dotenv)
 * @dev > hardcoded defaults. dotenv never overrides existing variables,
 * @dev so PM2 `env` blocks always win over the `.env` file.
 */
require('dotenv').config();

/**
 * @notice Parses PORT strictly: only plain integers 1-65535 are accepted.
 * @dev Rejects values like `3000abc` that `parseInt` would silently truncate.
 * @param {string|undefined} raw Raw PORT value.
 * @param {number} fallback Port used when raw is missing.
 * @return {number} Validated port.
 */
const parsePort = (raw, fallback) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw).trim())) return fallback;
  const port = Number(String(raw).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
};

const env = {
  /** @notice Runtime mode: development | staging | production. */
  nodeEnv: process.env.NODE_ENV || 'development',
  /** @notice HTTP port the server listens on. */
  port: parsePort(process.env.PORT, 3000),
  /** @notice Allowed CORS origin, or comma-separated list, or `*`. */
  corsOrigin: process.env.CORS_ORIGIN || '*',
  /** @notice Postgres connection string (lib/db). Undefined = DB not in use. */
  databaseUrl: process.env.DATABASE_URL || undefined,
  /** @notice JWT signing secret. Set a strong value outside local dev. */
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  /** @notice JWT lifetime (e.g. 7d, 12h). */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  /** @notice Google OAuth client ids (comma-separated web/Android/iOS). */
  googleClientIds: process.env.GOOGLE_CLIENT_IDS || '',
  /** @notice Apple Services IDs / bundle ids (comma-separated). */
  appleClientIds: process.env.APPLE_CLIENT_IDS || '',
  /** @notice Social provider switches (Apple off until iOS ships). */
  googleLoginEnabled: process.env.GOOGLE_LOGIN_ENABLED !== 'false',
  appleLoginEnabled: process.env.APPLE_LOGIN_ENABLED === 'true',
  /** @notice Apple JWKS endpoint for identityToken verification. */
  appleJwksUrl: process.env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys',
  /** @notice AI agent base URL proxied by `/api/ai/*`. */
  aiAgentUrl: (process.env.AI_AGENT_URL || 'http://localhost:8000').replace(/\/$/, ''),
};

module.exports = env;
