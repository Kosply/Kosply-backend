/**
 * @title Category routes
 * @notice Public catalog. The add-product dropdown calls this before a
 * session is required, same idea as the Help desk FAQ.
 */
const express = require('express');
const categories = require('../../controllers/categories/category.controller');
const asyncHandler = require('../../middlewares/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(categories.list));

module.exports = router;
