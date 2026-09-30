/**
 * @title Admin routes (dashboard login + user segmentation)
 * @notice Only SUPER_ADMIN registers/manages admins; admins self-manage
 * @notice photo/name/username (password locked).
 */
const express = require('express');
const admin = require('../../controllers/admin/admin.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.post('/login', asyncHandler(admin.login));
router.post('/users', authenticate, requireRole('SUPER_ADMIN'), asyncHandler(admin.createAdmin));
router.patch('/users/me', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), asyncHandler(admin.updateMe));
router.patch('/users/:id', authenticate, requireRole('SUPER_ADMIN'), asyncHandler(admin.updateAdmin));

module.exports = router;
