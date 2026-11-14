/**
 * @title Favorite routes
 * @notice Saved listings for the signed-in student.
 * @dev PUT, not POST: the save is identified by the URL alone (idempotent), so
 * @dev a retried request cannot create a second row or a different result.
 */
const express = require('express');
const favorites = require('../../controllers/favorites/favorite.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate } = require('../../middlewares/auth/auth');

const router = express.Router();

router.use(authenticate);
router.get('/', asyncHandler(favorites.list));
router.put('/:productId', asyncHandler(favorites.add));
router.delete('/:productId', asyncHandler(favorites.remove));

module.exports = router;
