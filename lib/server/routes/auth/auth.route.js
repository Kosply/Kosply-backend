/**
 * @title Auth routes
 * @notice Public buyer register + login (email + password only).
 */
const express = require('express');
const auth = require('../../controllers/auth/auth.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.post('/register', asyncHandler(auth.register));
router.post('/login', asyncHandler(auth.login));

module.exports = router;
