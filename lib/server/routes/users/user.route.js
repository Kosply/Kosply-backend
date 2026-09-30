/**
 * @title User routes (public profiles + self-service)
 * @notice Register `/me` before `/:id` or "me" matches the id param.
 */
const express = require('express');
const users = require('../../controllers/users/user.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.get('/me', authenticate, asyncHandler(users.me));
router.patch('/me', authenticate, asyncHandler(users.updateMe));
router.get('/:id', asyncHandler(users.profile));

module.exports = router;
