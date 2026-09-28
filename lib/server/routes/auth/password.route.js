/**
 * @title Password routes (4-digit email OTP reset, public by design)
 */
const express = require('express');
const password = require('../../controllers/auth/password.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.post('/forgot-password', asyncHandler(password.forgot));
router.post('/reset-password', asyncHandler(password.reset));

module.exports = router;
