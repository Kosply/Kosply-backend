/**
 * @title Auth routes
 * @notice Public buyer register + login (email + password only), plus direct
 * @notice Google and Apple sign-in (no vendor). Social accounts complete
 * @notice campus data afterwards when `onboardingRequired` is true.
 */
const express = require('express');
const auth = require('../../controllers/auth/auth.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { rateLimit, byAccount } = require('../../middlewares/rateLimit');

const router = express.Router();

// These three were unlimited: 25 consecutive failed logins all came back 401
// with no throttling, so password guessing and account enumeration were free.
router.post('/register', rateLimit({ name: 'register', limit: 10, windowMs: 60 * 60_000 }), asyncHandler(auth.register));
// Keyed on IP *and* normalised email, so a botnet cannot grind one account by
// rotating addresses.
router.post('/login', rateLimit({ name: 'login', limit: 10, windowMs: 15 * 60_000, keyBy: byAccount }), asyncHandler(auth.login));
// Provider token exchange: a failure is never a user credential, so IP-keyed
// is right, but it must still be bounded.
router.post('/google', rateLimit({ name: 'google', limit: 20, windowMs: 60_000 }), asyncHandler(auth.google));
router.post('/apple', rateLimit({ name: 'apple', limit: 20, windowMs: 60_000 }), asyncHandler(auth.apple));

module.exports = router;
