/**
 * @title Central error handler. Catches errors forwarded via `next(err)`.
 * @notice Catalog errors (`ApiError`) render `{ status: 'error', code, message }`.
 * @dev Two rules this file exists to enforce:
 * @dev  1. A client never receives a raw driver/library message. Only an
 * @dev     `ApiError` message is echoed; everything else gets the generic
 * @dev     catalog text, so Prisma table/column/constraint/host detail and
 * @dev     file paths cannot leak.
 * @dev  2. The HTTP status comes from the catalog, never from the thrown
 * @dev     object. A library that happens to set `err.status` must not be
 * @dev     able to choose the response status.
 * @dev Must be the last middleware on the app.
 * @param {Error} err The thrown error.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @param {import('express').NextFunction} next Express next function.
 * @return {void} Sends the error payload.
 */
const { CODES, ApiError } = require('./errorCatalog');

/**
 * @notice Translate a Prisma error code into a catalog key.
 * @dev Without this a uniqueness/FK/not-found race surfaces as a 500-class
 * @dev `INTERNAL`, which clients cannot distinguish from a server fault.
 * @param {string} prismaCode e.g. `P2002`.
 * @return {string|null} Catalog key, or null when unmapped.
 */
const mapPrismaCode = (prismaCode) => {
  switch (prismaCode) {
    case 'P2002':
      return 'CONFLICT_UNIQUE';
    case 'P2003':
      return 'VALIDATION';
    case 'P2025':
      return 'NOT_FOUND';
    case 'P1001':
    case 'P1002':
    case 'P1008':
    case 'P1017':
    case 'P2024':
      return 'DB_UNAVAILABLE';
    default:
      return null;
  }
};

/**
 * @notice Translate a body-parser / Node core HTTP error into a catalog key.
 * @param {string} type `err.type`, e.g. `entity.parse.failed`.
 * @param {number} status The status body-parser already computed.
 * @return {string|null} Catalog key, or null when unmapped.
 */
const mapHttpError = (type, status) => {
  if (type === 'entity.parse.failed' || type === 'request.aborted') return 'MALFORMED_REQUEST';
  if (type === 'entity.too.large') return 'PAYLOAD_TOO_LARGE';
  if (type === 'parameters.too.large') return 'PAYLOAD_TOO_LARGE';
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return 'UNSUPPORTED_MEDIA_TYPE';
  }
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 400) return 'MALFORMED_REQUEST';
  return null;
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const env = require('../config/env');

  // Log first, always. A response already in flight cannot be rewritten, so we
  // hand the error back to Express — but returning before the log meant every
  // post-flush failure was recorded nowhere.
  if (res.headersSent) {
    console.error(`[error] unhandled after response started on ${req.method} ${req.originalUrl}:`, err);
    return next(err);
  }
  const isApiError = err instanceof ApiError;

  let code = isApiError ? err.code : null;
  if (!code) code = mapPrismaCode(err.code) || mapHttpError(err.type, err.status || err.statusCode) || null;
  if (!code || !CODES[code]) code = 'INTERNAL';
  const { status, message: safeMessage } = CODES[code];

  // Only ApiError messages are client-safe. Everything else — driver errors,
  // body-parser rejections (whose `err.message` embeds the request body), Node
  // core HTTP errors — gets the generic catalog text. The status and `code`
  // carry all the signal a client needs.
  const isClientSafe = isApiError;
  if (status >= 500) {
    console.error(`[error] ${code} on ${req.method} ${req.originalUrl}:`, err);
  } else {
    console.warn(`[warn] ${code} on ${req.method} ${req.originalUrl}: ${err.message}`);
  }

  res.status(status).json({
    status: 'error',
    code,
    message: isClientSafe ? err.message || safeMessage : safeMessage,
    ...(isApiError && err.details !== undefined && { details: err.details }),
    ...(env.isDevelopment && { stack: err.stack }),
  });
};

module.exports = errorHandler;
module.exports.mapPrismaCode = mapPrismaCode;
module.exports.mapHttpError = mapHttpError;
