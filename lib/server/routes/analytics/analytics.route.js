/**
 * @title Analytics routes
 * @notice Event ingest is public (anonymous feed/detail surfaces), reads are
 * @notice authenticated and re-checked against product ownership in the service.
 * @dev Ownership is enforced in analytics.service, not here, mirroring how
 * @dev products/product.route.js guards writes.
 */
const express = require('express');
const analytics = require('../../controllers/analytics/analytics.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, optionalAuthenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.get('/seller', authenticate, asyncHandler(analytics.overview));
router.get('/products/:id', authenticate, asyncHandler(analytics.productStats));
router.post('/products/:id/event', optionalAuthenticate, asyncHandler(analytics.record));

module.exports = router;
