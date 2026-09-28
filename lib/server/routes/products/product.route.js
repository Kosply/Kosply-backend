/**
 * @title Product routes
 * @notice Public reads; writes need a JWT, seller writes need role SELLER.
 */
const express = require('express');
const products = require('../../controllers/products/product.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

router.get('/', asyncHandler(products.list));
router.get('/:id', asyncHandler(products.detail));
router.post('/', authenticate, requireRole('SELLER', 'ADMIN'), asyncHandler(products.create));
router.patch('/:id', authenticate, asyncHandler(products.update));
router.delete('/:id', authenticate, asyncHandler(products.archive));

module.exports = router;
