/**
 * @notice Central error handler. Catches errors forwarded via `next(err)`.
 * @dev Stack traces are exposed outside production only. Must be the
 * @dev last middleware registered on the app.
 * @param {Error} err The thrown error (supports `statusCode` / `status`).
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @param {import('express').NextFunction} next Express next function (unused).
 * @return {void} Sends `{ status: 'error', message[, stack] }`.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  console.error(err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
