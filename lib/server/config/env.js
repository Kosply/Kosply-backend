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

/**
 * @notice Parse NODE_ENV against an explicit allow-list.
 * @dev A typo (`prod`, `Production`, `productionn`) used to fall through every
 * @dev `!== 'production'` guard, silently re-enabling stack traces, dev OTP
 * @dev responses and the verbose access-log format in production.
 * @param {string|undefined} raw Raw NODE_ENV value.
 * @return {string} One of development | test | staging | production.
 */
const NODE_ENVS = ['development', 'test', 'staging', 'production'];
const parseNodeEnv = (raw) => {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'development';
  if (!NODE_ENVS.includes(value)) {
    throw new Error(
      `Invalid NODE_ENV=${JSON.stringify(raw)} (want one of ${NODE_ENVS.join(', ')})`
    );
  }
  return value;
};

/**
 * @notice Parse a boolean flag from an explicit truthy/falsy set.
 * @dev `!== 'false'` used to mean `0`, `off`, `no`, `FALSE` and `'false '`
 * @dev all read as "enabled", which is the wrong way round for a security
 * @dev switch shipped disabled-by-default and enabled-by-omission.
 * @param {string|undefined} raw Raw value.
 * @param {boolean} fallback Used when the value is absent.
 * @return {boolean} Parsed flag.
 */
const parseBool = (raw, fallback) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
};

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);

/**
 * @notice True only for local dev/test, never for staging.
 * @dev Gates stack traces in error responses, the dev OTP echo, the verbose
 * @dev access-log format and the seed script. `staging` is a real deploy that
 * @dev holds real data, so it must be treated like production here.
 */
const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';

/** @notice Hard-coded placeholder that must never sign a real token. */
const DEV_JWT_SECRET = 'dev-only-secret';

const env = {
  /** @notice Runtime mode: development | test | staging | production. */
  nodeEnv,
  /** @notice True only for development/test — gates every "dev-only" affordance. */
  isDevelopment,
  /** @notice HTTP port the server listens on. */
  port: parsePort(process.env.PORT, 3000),
  /** @notice Number of trusted reverse-proxy hops (0 = app is directly exposed). */
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10) || 0,
  /** @notice Allowed CORS origin, or comma-separated list, or `*`. */
  corsOrigin: process.env.CORS_ORIGIN || '*',
  /** @notice Postgres connection string (lib/db). Undefined = DB not in use. */
  databaseUrl: process.env.DATABASE_URL || undefined,
  /** @notice JWT signing secret. Fails fast in production when unset/default. */
  jwtSecret: process.env.JWT_SECRET || DEV_JWT_SECRET,
  /** @notice JWT lifetime (e.g. 7d, 12h). */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  /** @notice Shared secret required by the AI agent on `/api/internal/*`. */
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  /** @notice Google OAuth client ids (comma-separated web/Android/iOS). */
  googleClientIds: process.env.GOOGLE_CLIENT_IDS || '',
  /** @notice Apple Services IDs / bundle ids (comma-separated). */
  appleClientIds: process.env.APPLE_CLIENT_IDS || '',
  /** @notice Social provider switches (both off unless explicitly enabled). */
  googleLoginEnabled: parseBool(process.env.GOOGLE_LOGIN_ENABLED, nodeEnv === 'development'),
  appleLoginEnabled: parseBool(process.env.APPLE_LOGIN_ENABLED, false),
  /** @notice Apple JWKS endpoint for identityToken verification. */
  appleJwksUrl: process.env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys',
  /** @notice AI agent base URL proxied by `/api/ai/*`. */
  aiAgentUrl: (process.env.AI_AGENT_URL || 'http://localhost:8000').replace(/\/$/, ''),
  /** @notice Max products summarised in one seller analytics response. */
  maxAnalyticsProducts: Number.parseInt(process.env.MAX_ANALYTICS_PRODUCTS ?? '500', 10) || 500,
};

// Fail fast rather than sign production tokens with a value published in the
// repository: an unset or default JWT_SECRET means total auth bypass.
if (nodeEnv === 'production' && (!process.env.JWT_SECRET || env.jwtSecret === DEV_JWT_SECRET)) {
  throw new Error(
    'JWT_SECRET must be set to a strong, unique value in production (the dev-only default is refused)'
  );
}

module.exports = env;
