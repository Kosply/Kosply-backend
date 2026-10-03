/**
 * @title Product routes
 * @notice Public reads; writes need a JWT, seller writes need role SELLER.
 */
const express = require('express');
const products = require('../../controllers/products/product.controller');
const asyncHandler = require('../../middlewares/asyncHandler');
const { authenticate, optionalAuthenticate, requireRole } = require('../../middlewares/auth/auth');

const router = express.Router();

// Optional auth: anonymous callers see the public view, while the owner and
// staff can still read their own SOLD/ARCHIVED listing. Without this the
// owner/staff bypass in the service was unreachable over HTTP.
router.get('/', optionalAuthenticate, asyncHandler(products.list));
router.get('/:id', optionalAuthenticate, asyncHandler(products.detail));
router.post('/', authenticate, requireRole('SELLER', 'ADMIN'), asyncHandler(products.create));
router.patch('/:id', authenticate, asyncHandler(products.update));
router.delete('/:id', authenticate, asyncHandler(products.archive));
router.patch('/:id/sold', authenticate, asyncHandler(products.markSold));

module.exports = router;
