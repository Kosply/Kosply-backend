/**
 * @title Notification routes (personal inbox + free toggles)
 * @notice Everything is owner-scoped by JWT; toggles are opt-out (default on).
 */
const express = require('express');
const notifications = require('../../controllers/notifications/notification.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.get('/', asyncHandler(notifications.list));
router.post('/read-all', asyncHandler(notifications.markAllRead));
router.get('/preferences', asyncHandler(notifications.preferences));
router.patch('/preferences', asyncHandler(notifications.setPreference));
router.post('/:id/read', asyncHandler(notifications.markRead));

module.exports = router;
