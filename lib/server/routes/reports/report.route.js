/**
 * @title Report routes
 * @notice Any user files; listing and review need role ADMIN.
 */
const express = require('express');
const report = require('../../controllers/reports/report.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.post('/', asyncHandler(report.file));
router.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(report.list));
router.post('/:id/review', requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(report.review));

module.exports = router;
