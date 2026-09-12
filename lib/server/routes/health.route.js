/**
 * @title Health routes
 * @notice Exposes `GET /api/health` for monitoring and orchestration.
 */
const express = require('express');
const { getHealth } = require('../controllers/health.controller');

const router = express.Router();

router.get('/', getHealth);

module.exports = router;
