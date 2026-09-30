/**
 * @title Auth routes
 * @notice Public buyer register + login (email + password only), plus direct
 * @notice Google and Apple sign-in (no vendor). Social accounts complete
 * @notice campus data afterwards when `onboardingRequired` is true.
 */
const express = require('express');
const auth = require('../../controllers/auth/auth.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.post('/register', asyncHandler(auth.register));
router.post('/login', asyncHandler(auth.login));
router.post('/google', asyncHandler(auth.google));
router.post('/apple', asyncHandler(auth.apple));

module.exports = router;
