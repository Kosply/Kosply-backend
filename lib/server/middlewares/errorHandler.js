/**
 * @notice Central error handler. Catches errors forwarded via `next(err)`.
 * @dev Catalog errors (`ApiError`) render `{ status: 'error', code, message }`;
 * @dev unknown errors fall back to `INTERNAL`. Stack traces are exposed
 * @dev outside production only. Must be the last middleware on the app.
 * @param {Error} err The thrown error (supports `statusCode` / `status`).
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @param {import('express').NextFunction} next Express next function (unused).
 * @return {void} Sends the error payload.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  console.error(err);
  const env = require('../config/env');
  const { CODES } = require('./errorCatalog');
  const code = err.code && CODES[err.code] ? err.code : 'INTERNAL';
  const status = err.statusCode || err.status || CODES[code].status;
  const message = err.message || CODES[code].message;
  res.status(status).json({
    status: 'error',
    code,
    message,
    ...(err.details !== undefined && { details: err.details }),
    ...(env.nodeEnv !== 'production' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
