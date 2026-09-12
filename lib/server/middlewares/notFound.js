/**
 * @notice Catch-all 404 handler for unknown routes.
 * @dev Must be registered after all routes but before the error handler.
 * @param {import('express').Request} req Incoming HTTP request.
 * @param {import('express').Response} res Outgoing HTTP response.
 * @return {void} Sends `{ status: 'fail', message }` with status 404.
 */
const notFound = (req, res) => {
  res.status(404).json({
    status: 'fail',
    message: `Route ${req.originalUrl} not found`,
  });
};

module.exports = notFound;
