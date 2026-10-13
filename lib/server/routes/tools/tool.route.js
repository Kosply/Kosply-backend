/**
 * @title Tool benchmark routes
 * @notice Aggregated AI tool-invocation metrics for the ops dashboard.
 * @dev Staff-only: the numbers describe platform-wide tool usage, which is not
 * @dev a buyer's business. There is no rate limit because the endpoint is an
 * @dev authenticated aggregate read whose query count is fixed and bounded
 * @dev (see tool.service.js), not a per-row listing.
 */
const express = require('express');
const tools = require('../../controllers/tools/tool.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.get(
  '/stats',
  authenticate,
  requireRole('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(tools.stats)
);

module.exports = router;
