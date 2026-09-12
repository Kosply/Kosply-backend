/**
 * @title Async handler wrapper
 * @notice Wraps async route handlers so rejections reach `errorHandler`.
 * @dev Express 4 does not catch rejected promises; without this wrapper
 * @dev an async `throw` hangs the request instead of returning 500.
 * @param {Function} fn Async route handler `(req, res, next) => Promise`.
 * @return {Function} Express middleware forwarding rejections to `next(err)`.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
