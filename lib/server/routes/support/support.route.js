/**
 * @title Support routes
 * @notice Users manage own tickets; admins see and answer everything.
 */
const express = require('express');
const support = require('../../controllers/support/support.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

// Public on purpose: the FAQ is static content with nothing user-specific in
// it, so it stays readable (and cacheable) before a session exists. Registered
// before the authenticate gate below so "help-topics" can never be read as a
// ticket id by a later `/:id` route.
router.get('/help-topics', asyncHandler(support.helpTopics));

router.use(authenticate);
router.post('/tickets', asyncHandler(support.open));
router.get('/tickets', asyncHandler(support.list));
router.get('/tickets/:id', asyncHandler(support.get));
router.post('/tickets/:id/messages', asyncHandler(support.reply));
router.post('/tickets/:id/close', asyncHandler(support.close));

module.exports = router;
