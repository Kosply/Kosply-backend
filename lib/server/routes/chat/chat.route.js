/**
 * @title COD chat routes
 * @notice Inbox, rooms, and messages. Every route needs a JWT; rooms are
 * @notice member-scoped (strangers get 404, never a leak).
 */
const express = require('express');
const chat = require('../../controllers/chat/chat.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.post('/', asyncHandler(chat.open));
router.get('/', asyncHandler(chat.inbox));
router.get('/:id', asyncHandler(chat.get));
router.post('/:id/messages', asyncHandler(chat.send));
router.get('/:id/messages', asyncHandler(chat.history));
router.get('/:id/wait', asyncHandler(chat.wait));
router.get('/:id/stream', asyncHandler(chat.stream));

module.exports = router;
