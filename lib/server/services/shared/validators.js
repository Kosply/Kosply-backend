/**
 * @title Shared input validators
 * @notice Coercion + bounds helpers reused by every service, so a rule (an
 * @notice int4 range, a URL scheme, a text length) is enforced identically
 * @notice instead of being re-derived — and re-broken — per service.
 * @dev Every helper throws a catalog `VALIDATION` error on bad input, so
 * @dev callers stay one-liners and clients always get a 4xx, never a 500.
 */
const { throwError } = require('../../middlewares/errorCatalog');

/** @dev Postgres `integer` (int4) bounds — a value outside this 500s at the driver. */
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

/** @dev Upper bound for a rupiah listing price, for sanity rather than range. */
const MAX_PRICE_RP = 2_000_000_000;

/** @dev Allow-list of URL schemes that can be rendered safely in a client. */
const SAFE_URL_PROTOCOLS = ['http:', 'https:'];

/**
 * @dev Max length for a user-authored chat/support body. Bodies were previously
 * @dev unbounded, and `notify()` copies them into `notifications.body`, so one
 * @dev 500 KB message produced a single `GET /api/notifications` response of
 * @dev tens of megabytes.
 */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * @notice Coerce a value to a bounded integer.
 * @dev `Number()` on `null` / `""` / `true` / `[]` yields a *valid* number, so
 * @dev `price: null` silently became 0 (a free listing) and `price: true`
 * @dev became 1. Raw input is therefore type-checked before coercion.
 * @param {unknown} raw Raw value from the request body.
 * @param {string} field Field name, used in the error details.
 * @param {object} [opts] `{ min, max, allowNull }`.
 * @return {number|null} The integer, or null when nullish and allowed.
 */
const toInt = (raw, field, opts = {}) => {
  const { min = INT4_MIN, max = INT4_MAX, allowNull = false } = opts;
  // `Number('  ')` is 0, so a whitespace-only string used to slip through as a
  // valid zero — which for `price` publishes a free listing.
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    if (allowNull) return null;
    throwError('VALIDATION', { details: `${field} is required` });
  }
  if (typeof raw === 'boolean' || typeof raw === 'object') {
    throwError('VALIDATION', { details: `${field} must be a number` });
  }
  if (typeof raw === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) {
    throwError('VALIDATION', { details: `${field} must be a number` });
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throwError('VALIDATION', { details: `${field} must be an integer` });
  }
  if (value < min || value > max) {
    throwError('VALIDATION', { details: `${field} must be between ${min} and ${max}` });
  }
  return value;
};

/**
 * @notice Coerce a value to a bounded finite number (coordinates, prices).
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ min, max, allowNull }`.
 * @return {number|null} The number, or null when nullish and allowed.
 */
const toNumber = (raw, field, opts = {}) => {
  const { min = -Number.MAX_VALUE, max = Number.MAX_VALUE, allowNull = false } = opts;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    if (allowNull) return null;
    throwError('VALIDATION', { details: `${field} is required` });
  }
  if (typeof raw === 'boolean' || typeof raw === 'object') {
    throwError('VALIDATION', { details: `${field} must be a number` });
  }
  if (typeof raw === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) {
    throwError('VALIDATION', { details: `${field} must be a number` });
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throwError('VALIDATION', { details: `${field} must be a number` });
  if (value < min || value > max) {
    throwError('VALIDATION', { details: `${field} must be between ${min} and ${max}` });
  }
  return value;
};

/**
 * @notice Coerce a value to a bounded string.
 * @dev `String(null)` is the literal `"null"` and `String({})` is
 * @dev `"[object Object]"`, so non-strings are rejected before coercion
 * @dev rather than stored as garbage.
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ min, max, allowNull, trim }`.
 * @return {string|null} The string, or null when nullish and allowed.
 */
const toText = (raw, field, opts = {}) => {
  const { min = 0, max = 10000, allowNull = false, trim = true } = opts;
  if (raw === null || raw === undefined) {
    if (allowNull) return null;
    throwError('VALIDATION', { details: `${field} is required` });
  }
  if (typeof raw !== 'string') throwError('VALIDATION', { details: `${field} must be a string` });
  const value = trim ? raw.trim() : raw;
  if (value.length < min) throwError('VALIDATION', { details: `${field} is too short` });
  if (value.length > max) throwError('VALIDATION', { details: `${field} is too long` });
  return value;
};

/**
 * @notice Validate a user-supplied URL and return it unchanged.
 * @dev Prevents `javascript:`, `data:` and `file:` from being stored and later
 * @dev rendered by a client (stored XSS / phishing), and caps the length.
 * @dev Absolute `http(s)` only. A private-storage URL is still absolute.
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ allowNull, maxLength }`.
 * @return {string|null} The validated URL.
 */
const assertSafeUrl = (raw, field, opts = {}) => {
  const { allowNull = false, maxLength = 2048 } = opts;
  const value = toText(raw, field, { min: 1, max: maxLength, allowNull });
  if (value === null) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throwError('VALIDATION', { details: `${field} must be a valid URL` });
  }
  if (!SAFE_URL_PROTOCOLS.includes(parsed.protocol)) {
    throwError('VALIDATION', { details: `${field} must be an http or https URL` });
  }
  return value;
};

/**
 * @notice Validate a bounded array of URLs.
 * @dev Postgres scalar lists are unindexable and were previously accepted at
 * @dev any length, so a single 1 MB body could be amplified into every
 * @dev catalog page.
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ maxItems }`.
 * @return {string[]} Validated URLs.
 */
const toUrlList = (raw, field, opts = {}) => {
  const { maxItems = 8 } = opts;
  if (!Array.isArray(raw)) throwError('VALIDATION', { details: `${field} must be an array` });
  if (raw.length > maxItems) {
    throwError('VALIDATION', { details: `${field} allows at most ${maxItems} entries` });
  }
  return raw.map((url) => assertSafeUrl(url, field));
};

/**
 * @notice Validate a cuid-ish resource id taken from a path or query.
 * @dev Express 4's query parser turns `?after=a&after=b` into an array and
 * @dev `?after[a]=b` into an object; both used to reach Prisma unvalidated and
 * @dev produce a 500 with the driver message. A NUL byte likewise reached
 * @dev Postgres and surfaced as `invalid byte sequence for encoding "UTF8"`.
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ allowNull, maxLength }`.
 * @return {string|null} The validated id.
 */
const toId = (raw, field, opts = {}) => {
  const { allowNull = false, maxLength = 64 } = opts;
  if (raw === null || raw === undefined || raw === '') {
    if (allowNull) return null;
    throwError('VALIDATION', { details: `${field} is required` });
  }
  if (typeof raw !== 'string') throwError('VALIDATION', { details: `${field} must be a string` });
  if (raw.length > maxLength) throwError('VALIDATION', { details: `${field} is too long` });
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throwError('VALIDATION', { details: `${field} contains invalid characters` });
  }
  return raw;
};

/**
 * @notice Parse a bounded positive integer from a query value.
 * @dev `Number.parseInt` accepted `'7abc'`, `['1','2']` and `['1']`, so a
 * @dev malformed query silently produced a different window than intended.
 * @param {unknown} raw Raw value.
 * @param {string} field Field name.
 * @param {object} [opts] `{ min, max, fallback }`.
 * @return {number} The parsed integer, or the fallback.
 */
const toQueryInt = (raw, field, opts = {}) => {
  const { min = 1, max = INT4_MAX, fallback = null } = opts;
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throwError('VALIDATION', { details: `${field} must be a positive integer` });
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throwError('VALIDATION', { details: `${field} must be between ${min} and ${max}` });
  }
  return value;
};

module.exports = {
  INT4_MIN,
  INT4_MAX,
  MAX_PRICE_RP,
  SAFE_URL_PROTOCOLS,
  MAX_MESSAGE_LENGTH,
  toInt,
  toNumber,
  toText,
  assertSafeUrl,
  toUrlList,
  toId,
  toQueryInt,
};
