/**
 * @title AI routes (server proxy -> agent)
 * @notice Single backend for Flutter: JWT in, agent stream out.
 * @dev All routes need a JWT; identity is never taken from the body.
 */
const express = require('express');
const ai = require('../../controllers/ai/ai.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.post('/chat', asyncHandler(ai.chat));
router.post('/chat/stream', asyncHandler(ai.stream));
router.post('/chat/resume', asyncHandler(ai.resume));
router.get('/conversations', asyncHandler(ai.listConversations));
router.get('/history/:id', asyncHandler(ai.history));

module.exports = router;
