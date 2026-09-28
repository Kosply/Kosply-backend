/**
 * @title Verification routes
 * @notice Students submit; admins list and review (approve promotes to SELLER).
 */
const express = require('express');
const verification = require('../../controllers/verifications/verification.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.post('/', asyncHandler(verification.submit));
router.get('/me', asyncHandler(verification.mine));
router.get('/', requireRole('ADMIN'), asyncHandler(verification.list));
router.post('/:id/review', requireRole('ADMIN'), asyncHandler(verification.review));

module.exports = router;
