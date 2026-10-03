/**
 * @title Password routes (4-digit email OTP reset, public by design)
 */
const express = require('express');
const password = require('../../controllers/auth/password.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { rateLimit, byAccount } = require('../../middlewares/rateLimit');

const router = express.Router();

// 4-digit codes are brute-forceable by construction (10^4), so the reset flow
// has to be the tightest thing in the API, not the loosest.
router.post('/forgot-password', rateLimit({ name: 'forgot', limit: 5, windowMs: 15 * 60_000, keyBy: byAccount }), asyncHandler(password.forgot));
router.post('/reset-password', rateLimit({ name: 'reset', limit: 10, windowMs: 15 * 60_000, keyBy: byAccount }), asyncHandler(password.reset));

module.exports = router;
