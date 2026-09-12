/**
 * @title API route aggregator
 * @notice Mounts every feature route under `/api`.
 * @dev Register new modules here (e.g. `/auth`), never in `app.js`,
 * @dev so `app.js` stays lean and module wiring stays in one place.
 */
const express = require('express');
const healthRoute = require('./health.route');

const router = express.Router();

router.use('/health', healthRoute);

// Example: router.use('/auth', require('./auth.route'));

module.exports = router;
