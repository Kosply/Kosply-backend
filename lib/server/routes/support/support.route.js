/**
 * @title Support routes
 * @notice Users manage own tickets; admins see and answer everything.
 */
const express = require('express');
const support = require('../../controllers/support/support.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.post('/tickets', asyncHandler(support.open));
router.get('/tickets', asyncHandler(support.list));
router.get('/tickets/:id', asyncHandler(support.get));
router.post('/tickets/:id/messages', asyncHandler(support.reply));
router.post('/tickets/:id/close', asyncHandler(support.close));

module.exports = router;
