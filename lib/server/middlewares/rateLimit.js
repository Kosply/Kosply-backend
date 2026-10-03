/**
 * @title Fixed-window rate limiter
 * @notice Bounds how often one caller may hit a route.
 * @dev The Express API had no rate limiting anywhere: 25 consecutive failed
 * @dev logins all returned 401 and none were throttled, so password guessing,
 * @dev account enumeration via register/forgot-password, and analytics-event
 * @dev flooding were all unlimited. The Python agent has its own limiter; this
 * @dev is the missing server-side half.
 *
 * @dev Deliberately dependency-free. `express-rate-limit` is not a dependency
 * @dev and the project should not need Redis for a campus deployment.
 *
 * @dev LIMITATION, stated plainly: counters are per-process and in memory. The
 * @dev server runs under PM2 with 4 instances, so the effective ceiling is
 * @dev roughly `limit x instances`, and a restart clears everything. A real
 * @dev multi-node deployment needs a shared store (Redis). The same caveat
 * @dev already applies to the analytics dedupe window.
 *
 * @dev Set `RATE_LIMIT=off` to disable throttling entirely. It exists for test
 * @dev suites, which drive many auth attempts in one process and would
 * @dev otherwise trip their own limits -- the suite that covers this middleware
 * @dev asserts the real behaviour explicitly instead of relying on ambient
 * @dev config.
 */
const { throwError } = require('./errorCatalog');

/**
 * @notice One fixed window per key. Not a sliding log: it is O(1) memory per
 * @notice key and cannot be defeated by spreading requests across the boundary
 * @notice by more than one window's worth.
 */
const buckets = new Map();

/** @dev Sweep expired buckets so a long-lived process cannot grow without bound. */
const SWEEP_INTERVAL_MS = 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS);
// Do not hold the event loop open just for the sweep.
if (typeof sweeper.unref === 'function') sweeper.unref();

/** @dev Hard ceiling on tracked keys, so a spoofed-IP flood cannot exhaust memory. */
const MAX_BUCKETS = 50_000;

/**
 * @notice Reset all counters (tests).
 * @return {void}
 */
const reset = () => buckets.clear();

/**
 * @notice Build a limiter for one route.
 * @param {object} opts Options.
 * @param {number} opts.limit Requests allowed per window.
 * @param {number} [opts.windowMs] Window length, default 60_000.
 * @param {string} [opts.name] Label used in the error details.
 * @param {(req: import('express').Request) => string} [opts.keyBy]
 * @dev Derive the counter key. Default is the client IP. For login, key on the
 * @dev normalised email *as well*, so one attacker rotating IPs cannot keep
 * @dev guessing a single account.
 * @return {import('express').RequestHandler} Express middleware.
 */
const rateLimit = ({ limit, windowMs = 60_000, name = 'requests', keyBy } = {}) => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('rateLimit requires a positive integer `limit`');
  }
  const resolveKey = keyBy || ((req) => req.ip || req.socket?.remoteAddress || 'unknown');
  const disabled = String(process.env.RATE_LIMIT || '').toLowerCase() === 'off';

  return (req, res, next) => {
    if (disabled) return next();
    const now = Date.now();
    const key = `${name}:${resolveKey(req)}`;

    if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
      // Refuse to track more keys rather than grow: at this point we are being
      // flooded, and a 429 is the correct answer anyway.
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return next(Object.assign(new Error('Too many requests'), {
        code: 'RATE_LIMITED',
        statusCode: 429,
        isPublic: true,
      }));
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      throwError('RATE_LIMITED', { details: { limit, windowMs, retryAfterS: Math.ceil((bucket.resetAt - now) / 1000) } });
    }
    return next();
  };
};

/**
 * @notice Key login throttling on the account, not just the socket.
 * @dev IP-only limiting does not stop credential stuffing from a botnet, which
 * @dev is the realistic attack against a campus login. The email is normalised
 * @dev so `User@x.com` and `user@x.com` share one bucket.
 * @param {import('express').Request} req Incoming request.
 * @return {string} Bucket key.
 */
const byAccount = (req) => {
  const email = String(req.body?.email || req.body?.username || '')
    .trim()
    .toLowerCase();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return email ? `${ip}|${email}` : ip;
};

module.exports = { rateLimit, byAccount, reset };