/**
 * @title Internal routes (agent -> server)
 * @notice Machine API under `/api/internal`. Search first: `/products/search`
 * @notice must be registered before `/products/:id` or "search" matches `:id`.
 */
const express = require('express');
const {
  searchProducts,
  getProduct,
  getUser,
  createContactRequest,
  getConversationMessages,
  sendConversationMessage,
} = require('../../controllers/ai/internal.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.get('/products/search', asyncHandler(searchProducts));
router.get('/products/:id', asyncHandler(getProduct));
router.get('/users/:id', asyncHandler(getUser));
router.post('/contact-requests', asyncHandler(createContactRequest));
router.get('/conversations/:id/messages', asyncHandler(getConversationMessages));
router.post('/conversations/:id/messages', asyncHandler(sendConversationMessage));

module.exports = router;
